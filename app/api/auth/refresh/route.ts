import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HttpError, audit, loadSessionUser, route } from "@/lib/access";
import { sqlExec } from "@/lib/db";
import { rotateRefreshToken } from "@/lib/refresh-store";
import { REFRESH_COOKIE, clearSessionCookies, issueSessionCookies, readRefreshToken, refreshExpiry } from "@/lib/session";
import { loginUrl, safeNextPath } from "@/lib/session-path";

/**
 * 접근 토큰 재발급 — 리프레시 쿠키(14일, 쓸 때마다 새로 발급)로 새 접근 토큰 + 새 리프레시 토큰.
 * 최초 로그인 시각(iat)은 유지 → 30일 절대 만료. 로그아웃·비밀번호 변경 등으로 sessionVersion이 바뀐 토큰은 거부.
 * 리프레시 토큰은 1회용(회전): 서버 기록과 대조해 이미 쓴 토큰이 유예(30초) 뒤 다시 오면 복사된 것으로 보고 전부 로그아웃.
 */
async function renew(res: NextResponse, now = Date.now()) {
  const rt = readRefreshToken((await cookies()).get(REFRESH_COOKIE)?.value, now);
  const user = rt && (await loadSessionUser(rt.uid, rt.v));
  if (!rt || !user) return false;
  const exp = refreshExpiry(rt.iat, now);
  // 기록 도입(10-14) 전에 발급된 jti 없는 토큰은 받지 않는다 — 재사용 탐지가 안 되므로 다시 로그인
  if (!rt.jti) return false;
  const r = await rotateRefreshToken(user.id, rt.jti, exp, now);
  if (r.status === "reuse") {
    // 옛 토큰 재사용 = 쿠키가 복사됐을 가능성 → 이 사용자의 모든 세션(정상 사용자 포함)을 끊고 기록
    await sqlExec(`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE "id" = ?`, [user.id]);
    await audit(user, { entity: "Auth", entityId: user.id, action: "refresh-reuse" });
    return false;
  }
  if (r.status !== "ok") return false;
  issueSessionCookies(res, user.id, rt.v, r.jti, rt.iat, now);
  return true;
}

/** API·SessionKeeper용: 성공 { ok: true }, 실패 401 (다시 로그인) */
export const POST = route(async () => {
  const res = NextResponse.json({ ok: true });
  if (!(await renew(res))) throw new HttpError(401, "로그인이 만료되었습니다. 다시 로그인하세요.");
  return res;
});

/** 화면 요청용 (미들웨어·requireUser가 보냄): 재발급 뒤 원래 화면(next)으로, 실패하면 쿠키를 지우고 로그인으로 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  // 같은 사이트 경로만 (//·역슬래시로 시작하는 외부 주소 금지) — 파서가 다르게 읽어도 origin이 바뀌면 홈으로
  const safe = safeNextPath(u.searchParams.get("next"));
  const target = new URL(safe, req.url);
  if (target.origin !== u.origin) target.href = new URL("/", req.url).href;
  const res = NextResponse.redirect(target);
  res.headers.set("Cache-Control", "no-store, private");
  if (await renew(res)) return res;
  const login = new URL(loginUrl(safe === "/" ? null : safe), req.url);
  login.searchParams.set("expired", "1");
  const fail = NextResponse.redirect(login);
  clearSessionCookies(fail);
  return fail;
}
