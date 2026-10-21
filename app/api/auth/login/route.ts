import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HttpError, SMALL_JSON_MAX_BYTES, audit, clientIp, readJson, route } from "@/lib/access";
import { loginBlocked, maskLoginInput } from "@/lib/auth-policy";
import { LOGIN_LIMITS, throttleMessage } from "@/lib/auth-throttle";
import { checkThrottle, clearFailures } from "@/lib/auth-throttle-server";
import { sqlExec } from "@/lib/db";
import { sqlCurrentMemberships, sqlLoginUser } from "@/lib/sql-loaders";
import { seoulTodayDate } from "@/lib/format";
import { toLoginId } from "@/lib/loginid";
import { verifyDummyPassword, verifyPassword } from "@/lib/password";
import { startRefreshFamily } from "@/lib/refresh-store";
import { PROJECT_COOKIE, issueSessionCookies, refreshExpiry } from "@/lib/session";

// 없는 계정·틀린 비밀번호·잠김·비활성은 비밀번호가 맞기 전까지 같은 문구 (계정 존재 여부 노출 방지)
const INVALID = "아이디(이메일)·사번 또는 비밀번호가 올바르지 않습니다. 실패가 반복되면 15분 동안 로그인이 제한됩니다.";

/**
 * 로그인: 아이디(이메일 주소) 또는 사번 + 비밀번호.
 * 시도 제한은 DB에 남긴 실패 기록으로 (lib/auth-throttle.ts): IP당 15분 20회, 같은 IP에서 같은 계정 5회 → 그 IP·계정만 막음,
 * 계정당 여러 IP 합계는 점진 지연(50회면 차단), 전체 급증 시 지연. 계정 전체 잠금 대신 IP 기준이라 잠금 악용(DoS)을 줄인다
 */
export const POST = route(async (req) => {
  const body = await readJson<{ loginId?: string; email?: string; password?: string }>(req, SMALL_JSON_MAX_BYTES);
  const rawId = body.loginId ?? body.email;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!id || !password) throw new HttpError(400, "아이디와 비밀번호를 입력하세요.");
  if (id.length > 200 || password.length > 200) throw new HttpError(401, INVALID);

  const ip = await clientIp();
  const idKey = toLoginId(id);
  // 직접 SQL (Prisma findFirst와 같은 조건) — 로그인은 대개 쉬었다 오는 첫 요청이라 Prisma 준비 비용을 피한다
  const user = await sqlLoginUser(idKey, id);
  // 시도 제한 (IP를 모르면 계정 기준). 키는 계정을 찾으면 계정 id — 이메일·사번 어느 쪽으로 넣어도 한 계정의 시도로 세어
  // 두 아이디로 번갈아 대입해 한도를 2배로 쓰지 못하게. 없는 계정은 입력값 기준 (응답은 같아서 존재 여부는 드러나지 않음)
  const subject = user?.id ?? idKey;
  const block = await checkThrottle("login", ip, subject, LOGIN_LIMITS);
  if (block) {
    await audit({ id: "anonymous" }, { entity: "Auth", entityId: maskLoginInput(id), action: "login-fail", data: { reason: `rate-limited:${block}` } });
    return NextResponse.json({ error: throttleMessage(block) }, { status: 429, headers: { "Retry-After": "900" } });
  }

  if (!user) {
    verifyDummyPassword(password); // 응답 시간으로 계정 존재 여부가 드러나지 않게 (시도는 checkThrottle에서 이미 기록)
    await audit({ id: "anonymous" }, { entity: "Auth", entityId: maskLoginInput(id), action: "login-fail", data: { reason: "unknown-user" } });
    throw new HttpError(401, INVALID);
  }

  const ok = user.authProvider === "local" ? verifyPassword(password, user.passwordHash) : verifyDummyPassword(password);
  const blocked = loginBlocked(user);
  if (blocked) {
    await audit(user, { entity: "Auth", entityId: user.id, action: "login-blocked" });
    // 잠김 상태에서는 비밀번호가 맞아도 같은 문구 (잠금 중 비밀번호 대입으로 정답 확인 불가)
    if (!user.active && ok) throw new HttpError(403, blocked);
    throw new HttpError(401, INVALID);
  }
  if (user.authProvider !== "local") throw new HttpError(401, INVALID);

  if (!ok) {
    // 실패는 checkThrottle에서 이미 기록됨 (IP·계정별 제한). 계정 전체를 잠그지 않는다 — 시스템 관리자가 건 잠금(lockedUntil)만 위에서 확인
    await audit(user, { entity: "Auth", entityId: user.id, action: "login-fail" });
    throw new HttpError(401, INVALID);
  }
  if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
    throw new HttpError(403, "임시 비밀번호가 만료되었습니다(24시간). PM이나 시스템 관리자에게 다시 발급을 요청하세요.");
  }

  await sqlExec(`UPDATE "User" SET "failedLogins" = 0, "lockedUntil" = NULL, "lastLoginAt" = ? WHERE "id" = ?`, [new Date(), user.id]);
  await clearFailures("login", ip, subject);
  await audit(user, { entity: "Auth", entityId: user.id, action: "login" });
  const res = NextResponse.json({ ok: true, role: user.role, mustChangePassword: user.mustChangePassword });
  const now = Date.now();
  issueSessionCookies(res, user.id, user.sessionVersion, await startRefreshFamily(user.id, refreshExpiry(now, now), now), now, now);
  // 지난번에 고른 프로젝트가 내 프로젝트(직접 팀원)가 아니면 지운다 — 상위 PM·조직장으로 조회만 하던 하위 프로젝트나
  // 같은 브라우저의 다른 사람 선택으로 로그인하지 않게. 그러면 내 프로젝트(진행 중 PM 우선)로 연다 (재무 승인·시스템 관리자는 그대로)
  const picked = (await cookies()).get(PROJECT_COOKIE)?.value;
  if (picked && user.role !== "HQ" && user.role !== "ADMIN") {
    const mine = await sqlCurrentMemberships(user.id, seoulTodayDate());
    if (!mine.some((m) => m.projectId === picked)) res.cookies.delete(PROJECT_COOKIE);
  }
  return res;
});
