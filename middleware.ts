import { NextResponse, type NextRequest } from "next/server";
import { csrfProblem } from "@/lib/csrf";
import { NEXT_PATH_HEADER, PAGE_PATH_HEADER, nextPathOf } from "@/lib/session-path";
import { legacyRedirect } from "@/lib/page-access";

// 1) API 변경 요청: Origin(없으면 Referer)이 같은 호스트인지 확인 (CSRF 방어)
// 2) 화면: 세션 쿠키가 없으면 로그인으로. 서명 검증·권한 확인은 서버(lib/access.ts)에서 수행.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    const problem = csrfProblem({
      method: req.method,
      pathname,
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      allowedHosts: [
        req.headers.get("host"),
        // 리버스 프록시가 Host를 바꿔 전달하는 경우 (TRUST_PROXY=1일 때만 신뢰)
        process.env.TRUST_PROXY === "1" ? req.headers.get("x-forwarded-host") : null,
      ],
    });
    if (problem) return NextResponse.json({ error: problem }, { status: 403 });
    return NextResponse.next();
  }

  if (pathname.startsWith("/login")) return NextResponse.next();

  // 합친 화면의 예전 주소 (월별 현황 → 현황의 지출 내역) — 쿼리(ym·check·edit·scope…)는 그대로
  const moved = legacyRedirect(pathname, req.nextUrl.search);
  if (moved) return NextResponse.redirect(new URL(moved, req.url));

  // 로그인 후 원래 화면으로 돌아가도록 (로그인 화면에서 같은 사이트 경로만 허용)
  const back = nextPathOf(pathname, req.nextUrl.search);
  if (!req.cookies.get("opex_session")) {
    const url = req.nextUrl.clone();
    // 접근 토큰(1시간)만 만료된 경우: 리프레시 쿠키로 조용히 재발급하고 원래 화면으로 (서명 검증은 그 라우트에서)
    url.pathname = req.cookies.get("opex_refresh") ? "/api/auth/refresh" : "/login";
    url.search = "";
    if (back) url.searchParams.set("next", back);
    return NextResponse.redirect(url);
  }
  // 쿠키는 있지만 세션이 만료·무효인 경우 서버(requireUser)가 같은 경로로 돌려보낼 수 있게 전달 (클라이언트가 보낸 값은 덮어씀)
  const headers = new Headers(req.headers);
  if (back) headers.set(NEXT_PATH_HEADER, back);
  else headers.delete(NEXT_PATH_HEADER);
  headers.set(PAGE_PATH_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|apple-touch-icon|icon.png|icons/|manifest.webmanifest|sw.js).*)"],
};
