import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HttpError, SMALL_JSON_MAX_BYTES, audit, clientIp, getCurrentUser, readJson, route } from "@/lib/access";
import { passwordProblem } from "@/lib/auth-policy";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { PASSWORD_LIMITS, throttleMessage } from "@/lib/auth-throttle";
import { checkThrottle, clearFailures } from "@/lib/auth-throttle-server";
import { startRefreshFamily } from "@/lib/refresh-store";
import { SESSION_COOKIE, issueSessionCookies, readSessionToken, refreshExpiry } from "@/lib/session";

/** 본인 비밀번호 변경 (임시 비밀번호 상태에서도 호출 가능). 다른 기기의 세션은 모두 끊고 현재 세션만 새로 발급 */
export const POST = route(async (req) => {
  const me = await getCurrentUser();
  const session = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!me || !session) throw new HttpError(401, "로그인이 필요합니다.");
  const { current, next } = await readJson<{ current?: string; next?: string }>(req, SMALL_JSON_MAX_BYTES);

  // 현재 비밀번호 대입 방지: 사용자당 15분 5회 실패, IP당 15분 20회 (DB 기록 — 서버 인스턴스 간 공유)
  const ip = await clientIp();
  const block = await checkThrottle("password", ip, me.id, PASSWORD_LIMITS);
  if (block) return NextResponse.json({ error: throttleMessage(block === "pair" ? "subject" : block) }, { status: 429, headers: { "Retry-After": "900" } });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (typeof current !== "string" || !verifyPassword(current, user.passwordHash)) {
    // 시도는 checkThrottle에서 이미 기록됨
    await audit(me, { entity: "User", entityId: me.id, action: "password-fail" });
    throw new HttpError(400, "현재 비밀번호가 올바르지 않습니다.");
  }
  await clearFailures("password", ip, me.id);
  const problem = passwordProblem(typeof next === "string" ? next : "", user);
  if (problem) throw new HttpError(400, problem);
  if (next === current) throw new HttpError(400, "현재 비밀번호와 다른 비밀번호를 사용하세요.");
  const updated = await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash: hashPassword(next!), mustChangePassword: false, tempPasswordExpiresAt: null, sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  await audit(me, { entity: "User", entityId: me.id, action: "password" });
  const res = NextResponse.json({ ok: true });
  // 새 버전으로 두 토큰 재발급 — 이 브라우저만 로그인이 유지되고 다른 기기는 모두 풀린다
  const now = Date.now();
  issueSessionCookies(res, me.id, updated.sessionVersion, await startRefreshFamily(me.id, refreshExpiry(session.iat, now), now), session.iat, now);
  return res;
});
