// 클라이언트 fetch 헬퍼: 실패 시 서버 에러 메시지로 throw.
// 접근 토큰(1시간)이 만료돼 401이면 리프레시 쿠키로 한 번 재발급한 뒤 같은 요청을 다시 보낸다 (오래 열어 둔 화면에서 저장이 끊기지 않게)
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }, retried = false): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && !retried && !url.startsWith("/api/auth/")) {
    const ok = await fetch("/api/auth/refresh", { method: "POST" }).then((r) => r.ok).catch(() => false);
    if (ok) return api<T>(url, init, true);
    if (typeof window !== "undefined") window.location.href = "/login?expired=1";
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `요청을 처리하지 못했습니다 (오류 ${res.status}). 잠시 후 다시 시도하세요.`, res.status, data);
  return data as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}
