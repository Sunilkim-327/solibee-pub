// 화면 맥락(보던 달·범위) 유지 — 순수함수 (설계 검토(2026-10-14) P1-6)
// 월 단위 화면은 ?ym= 으로 달을, 현황은 ?scope=all(하위 포함)·?part=프로젝트 id(구분)로 범위를 정한다.
// 메뉴·카드·돌아가기 링크가 이 값을 넘겨 화면을 옮겨도 보던 달·범위가 풀리지 않게 한다.

export type CtxKey = "ym" | "scope" | "part";
export type PageCtx = Partial<Record<CtxKey, string | null | undefined>>;

/** 화면별로 넘길 쿼리 키 — 월 단위 화면만 (여기 없는 화면에는 아무것도 붙이지 않는다) */
export const CTX_BY_PATH: Record<string, readonly CtxKey[]> = {
  "/dashboard": ["ym", "scope", "part"],
  // 예전 내 정산 주소 — 현황의 정산 구역으로 보낸다 (app/(dashboard)/settlement)
  "/settlement": ["ym"],
  "/closing": ["ym"],
  "/pass": ["ym"],
  "/budget": ["ym"],
};

const YM_RE = /^\d{4}-\d{2}$/;

/** 값이 그 키에 맞는 꼴인지 (ym: YYYY-MM · scope: all · part: 비어 있지 않은 id) */
export function validCtxValue(key: CtxKey, v: string | null | undefined): v is string {
  if (!v) return false;
  if (key === "ym") return YM_RE.test(v);
  if (key === "scope") return v === "all";
  return v.length > 0 && v.length <= 64;
}

/** 지금 주소의 검색값에서 맥락만 (꼴이 맞는 값만) */
export function ctxOf(params: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined): PageCtx {
  if (!params) return {};
  const get = (k: CtxKey) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return typeof v === "string" ? v : null;
  };
  const out: PageCtx = {};
  for (const k of ["ym", "scope", "part"] as const) {
    const v = get(k);
    if (validCtxValue(k, v)) out[k] = v;
  }
  return out;
}

/** 경로의 맥락 키 (하위 경로 포함, 쿼리·해시 무시) */
export function ctxKeysFor(href: string): readonly CtxKey[] {
  const path = href.split(/[?#]/)[0];
  for (const [base, keys] of Object.entries(CTX_BY_PATH)) if (path === base || path.startsWith(`${base}/`)) return keys;
  return [];
}

/**
 * 링크에 보던 달·범위를 붙인다 — 그 화면이 쓰는 키만, 링크에 이미 있는 키는 그대로 둔다.
 * withCtx("/closing", { ym: "2026-09", scope: "all" }) → "/closing?ym=2026-09" (마감은 scope를 쓰지 않음)
 * withCtx("/dashboard#settle", { ym }) → "/dashboard?ym=…#settle"
 */
export function withCtx(href: string, ctx: PageCtx, keys: readonly CtxKey[] = ctxKeysFor(href)): string {
  if (!keys.length) return href;
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const base = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = base.indexOf("?");
  const path = qAt >= 0 ? base.slice(0, qAt) : base;
  const q = new URLSearchParams(qAt >= 0 ? base.slice(qAt + 1) : "");
  let changed = false;
  for (const k of keys) {
    const v = ctx[k];
    if (q.has(k) || !validCtxValue(k, v)) continue;
    q.set(k, v);
    changed = true;
  }
  if (!changed) return href;
  return `${path}?${q}${hash}`;
}

// ── 마지막 본 달 쿠키 ─────────────────────────────────────────
/** 월 화면이 ?ym= 없이 열리면 이 달로 (프로젝트 기간 밖이면 무시). 클라이언트(MonthNav)가 쓴다 */
export const LAST_YM_COOKIE = "last-ym";
/** 1년 */
export const LAST_YM_MAX_AGE = 60 * 60 * 24 * 365;

/** 쿠키의 달이 쓸 수 있는 값인지 — 꼴이 맞고 그 프로젝트 기간(months) 안일 때만 */
export function lastYm(raw: string | null | undefined, months: readonly string[]): string | null {
  return raw && YM_RE.test(raw) && months.includes(raw) ? raw : null;
}

/** 화면이 열 달: ?ym= (기간 안이면) → 쿠키의 달 (기간 안이면) → 없음 (화면이 이번 달 등 기본값으로) */
export function requestedYm(param: string | string[] | undefined, cookie: string | null | undefined, months: readonly string[]): string | undefined {
  if (typeof param === "string" && lastYm(param, months)) return param;
  return lastYm(cookie, months) ?? undefined;
}

/** document.cookie 에 쓸 문자열 (꼴이 안 맞으면 null — 쓰지 않는다) */
export function lastYmCookieString(ym: string): string | null {
  if (!YM_RE.test(ym)) return null;
  return `${LAST_YM_COOKIE}=${ym}; path=/; max-age=${LAST_YM_MAX_AGE}; SameSite=Lax`;
}

// ── 돌아가기 (?from=) ─────────────────────────────────────────
/** 다른 화면의 확인 항목에서 넘어왔을 때(?from=…) 돌아갈 곳 — 화면마다 다른 문구를 두지 않고 이 표 하나 */
export const BACK_FROM = {
  closing: { href: "/closing", label: "마감 · 상신으로 돌아가기" },
  // 예전 내 정산 화면 — 지금은 내 지출 내역(현황)에 합쳐져 그 화면으로 돌아간다
  settlement: { href: "/dashboard", label: "내 지출 내역으로 돌아가기" },
} as const;
export type BackFrom = keyof typeof BACK_FROM;

/** ?from= 값으로 돌아가기 링크 (보던 달을 함께). 모르는 값이면 null */
export function backTo(from: string | string[] | undefined, ctx: PageCtx = {}): { href: string; label: string } | null {
  if (typeof from !== "string" || !Object.prototype.hasOwnProperty.call(BACK_FROM, from)) return null;
  const b = BACK_FROM[from as BackFrom];
  return { href: withCtx(b.href, ctx), label: b.label };
}
