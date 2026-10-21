// 교차 사이트 요청 위조(CSRF) 방어 — 미들웨어에서 사용하는 순수 함수 (Edge 런타임 호환: node 모듈 사용 금지)

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Origin·Referer 검사에서 제외하는 경로 (다른 사이트에서 호출되며 자체 토큰으로 인증) */
export const CSRF_EXEMPT = ["/api/directory/push"];

function hostOf(url: string | null): string | null {
  if (!url || url === "null") return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 변경 요청(POST·PUT·PATCH·DELETE)이 같은 출처에서 왔는지 확인. 문제가 있으면 사유, 없으면 null
 * @param allowedHosts 요청 Host (프록시 신뢰 시 X-Forwarded-Host 포함)
 */
export function csrfProblem(req: {
  method: string;
  pathname: string;
  origin: string | null;
  referer: string | null;
  allowedHosts: (string | null | undefined)[];
}): string | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;
  if (!req.pathname.startsWith("/api/")) return null;
  if (CSRF_EXEMPT.some((p) => req.pathname === p || req.pathname.startsWith(p + "/"))) return null;
  const source = req.origin !== null ? hostOf(req.origin) : hostOf(req.referer);
  if (!source) return "요청 출처를 확인할 수 없습니다.";
  const allowed = req.allowedHosts.filter((h): h is string => !!h).map((h) => h.split(",")[0].trim().toLowerCase());
  return allowed.includes(source) ? null : "다른 사이트에서 보낸 요청은 처리할 수 없습니다.";
}
