// 미들웨어(엣지) ↔ 서버 공통 — 세션 만료로 로그인 화면에 보낼 때 돌아올 경로를 전달하는 요청 헤더
export const NEXT_PATH_HEADER = "x-next-path";
/** 미들웨어 → 레이아웃: 요청한 화면 경로 (쿼리 제외, 권한 없는 화면을 그리기 전에 돌려보내는 데 사용) */
export const PAGE_PATH_HEADER = "x-page-path";

/** 로그인 후 돌아올 경로 (같은 사이트 경로만, 홈·RSC 내부 파라미터 제외). 없으면 null */
export function nextPathOf(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  params.delete("_rsc");
  const q = params.toString();
  const back = pathname + (q ? `?${q}` : "");
  return back !== "/" && back.startsWith("/") && !back.startsWith("//") ? back : null;
}

/**
 * 돌아올 경로로 써도 되는지 — 같은 사이트의 상대 경로만.
 * "//"는 프로토콜 상대 주소, "/\\"도 브라우저·URL 파서가 "//"로 취급해 외부 주소가 되므로 역슬래시·제어문자는 모두 거부.
 * 로그인 화면으로 다시 가는 것도 제외. 안 되면 "/".
 */
export function safeNextPath(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(v) || v.startsWith("/login")) return "/";
  return v;
}

/** 로그인 화면 주소 (돌아올 경로가 있으면 next로) */
export function loginUrl(next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe !== "/" ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
