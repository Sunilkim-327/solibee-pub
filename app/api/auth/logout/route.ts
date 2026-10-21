import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { audit } from "@/lib/access";
import { sqlExec } from "@/lib/db";
import { REFRESH_COOKIE, SESSION_COOKIE, clearSessionCookies, readRefreshToken, readSessionToken } from "@/lib/session";

/** 로그아웃: 쿠키 삭제 + sessionVersion 증가로 이 사용자의 기존 세션(복사된 쿠키 포함) 모두 무효 */
export async function POST() {
  const store = await cookies();
  // 접근 토큰(1시간)이 이미 만료된 탭에서 로그아웃해도 리프레시 토큰(14일)까지 무효화되도록
  const session = readSessionToken(store.get(SESSION_COOKIE)?.value) ?? readRefreshToken(store.get(REFRESH_COOKIE)?.value);
  if (session) {
    try {
      // 이미 무효화된(버전이 다른) 세션으로는 다른 기기 세션을 끊지 않는다
      // 직접 SQL (Prisma updateMany와 같은 조건 — 로그아웃 요청에서 Prisma를 준비하지 않게)
      const count = await sqlExec(`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE "id" = ? AND "sessionVersion" = ?`, [session.uid, session.v]);
      if (count) await audit({ id: session.uid }, { entity: "Auth", entityId: session.uid, action: "logout" });
    } catch (err) {
      console.error(err);
    }
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
