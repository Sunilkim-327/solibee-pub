// 화면별 접근 역할과 역할별 첫 화면 — 순수함수 (레이아웃이 페이지 그리기 전에 바로 307로 보내는 데 쓴다)
// 페이지도 같은 표로 다시 확인한다 (pageContext·requireUser).
import type { Role } from "./types";

/** project = 현재 프로젝트에서의 역할 기준, global = 회사 권한(세션 사용자) 기준 */
export type PageRule = {
  scope: "project" | "global";
  roles: Role[];
  /** 조회 전용(상위 PM 조회·종료된 프로젝트·시스템 관리자)이면 보낼 화면 — 변경 전용 화면 */
  readOnlyTo?: string;
};

const PM_HQ: Role[] = ["MANAGER", "HQ", "ADMIN"];
const HQ_LIKE: Role[] = ["HQ", "ADMIN"];

/**
 * 역할 제한이 있는 화면 (없는 화면은 로그인한 누구나) — 현황(/dashboard)은 모든 역할 (팀원에게는 내 지출 내역).
 * 메뉴(components/Nav NAV의 roles)와 같은 기준이어야 한다 — PM 설정은 이 프로젝트 PM만
 */
export const PAGE_RULES: Record<string, PageRule> = {
  "/budget": { scope: "project", roles: PM_HQ },
  "/closing": { scope: "project", roles: PM_HQ },
  "/pass": { scope: "project", roles: PM_HQ },
  "/settings": { scope: "project", roles: ["MANAGER"], readOnlyTo: "/dashboard" },
  "/projects": { scope: "global", roles: HQ_LIKE },
  "/master": { scope: "global", roles: HQ_LIKE },
  "/eps": { scope: "global", roles: HQ_LIKE },
  "/org": { scope: "global", roles: HQ_LIKE },
  "/audit": { scope: "global", roles: ["ADMIN"] },
};

/** 경로의 접근 규칙 (하위 경로 포함, 쿼리 무시) */
export function pageRule(path: string): PageRule | null {
  const pathname = path.split("?")[0];
  for (const [base, rule] of Object.entries(PAGE_RULES)) {
    if (pathname === base || pathname.startsWith(`${base}/`)) return rule;
  }
  return null;
}

/** 규칙을 통과하는지 — projectRole: 현재 프로젝트에서의 역할 (프로젝트가 없으면 null) */
export function pageAllowed(rule: PageRule, globalRole: Role, projectRole: Role | null): boolean {
  if (rule.scope === "global") return rule.roles.includes(globalRole);
  // 프로젝트가 없으면 여기서 판단하지 않는다 (페이지가 안내 화면으로 보냄)
  return projectRole === null || rule.roles.includes(projectRole);
}

// ── 돌려보낼 때 안내 (?notice=) ─────────────────────────────────
/** 권한 없음·조회 전용으로 다른 화면에 보낼 때 붙이는 쿼리 — 도착 화면이 토스트를 한 번 보여 주고 주소에서 지운다 (components/RedirectNotice) */
export const NOTICE_KEY = "notice";
/** readonly: 조회 전용 프로젝트라 변경 화면 대신 · role: 그 역할이 볼 수 없는 화면 */
export type RedirectNotice = "readonly" | "role";

export function withNotice(path: string, code: RedirectNotice): string {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}${NOTICE_KEY}=${code}${hash ? `#${hash}` : ""}`;
}

/** 토스트 문구 — screen: 도착한 화면의 메뉴 이름 (없으면 '첫 화면'). 모르는 코드면 null */
export function redirectNoticeText(code: string | null | undefined, screen: string | null | undefined): string | null {
  const to = `${screen || "첫"} 화면으로 이동했어요`;
  if (code === "readonly") return `조회 전용 프로젝트라 ${to}`;
  if (code === "role") return `권한이 없는 화면이라 ${to}`;
  return null;
}

/** 요청 화면에서 돌려보낼 곳 (그대로 보여 주면 null) — 첫 화면(/)·권한 없음·조회 전용 제한 (뒤 둘은 ?notice= 안내를 붙인다) */
export function pageRedirect(path: string, x: { globalRole: Role; hasProject: boolean; role: Role; readOnly?: boolean }): string | null {
  const pathname = path.split("?")[0];
  if (pathname === "/") return homeFor(x);
  const rule = pageRule(pathname);
  if (!rule) return null;
  if (!pageAllowed(rule, x.globalRole, x.hasProject ? x.role : null)) return withNotice(homeFor(x), "role");
  if (rule.readOnlyTo && x.hasProject && x.readOnly) return withNotice(rule.readOnlyTo, "readonly");
  return null;
}

/**
 * 역할별 첫 화면 — 재무 승인·시스템 관리자: 전체 프로젝트, 프로젝트 없음: 안내,
 * 팀원·PM(조회 전용 아님): 지출 입력, 그 외(조회 전용·종료 프로젝트): 현황
 */
export function homeFor(x: { globalRole: Role; hasProject: boolean; role: Role; readOnly?: boolean }): string {
  if (x.globalRole === "HQ" || x.globalRole === "ADMIN") return "/projects";
  if (!x.hasProject) return "/no-project";
  // 팀원·PM 모두 첫 화면은 지출 입력 (가장 자주 하는 일). 조회 전용·종료 프로젝트는 입력이 없으므로 현황 (팀원에게는 내 지출 내역)
  if (!x.readOnly && (x.role === "MEMBER" || x.role === "MANAGER")) return "/expenses/new";
  return HOME_PATH;
}

// ── 현황 (구 팀 현황 + 월별 현황) ─────────────────────────────
/** 월 요약·할 일·팀원별 정산·지출 내역을 한 화면에 — 팀원에게는 '내 지출 내역' */
export const HOME_PATH = "/dashboard";
/** 현황 화면 안 지출 내역 구역 (components/list/LedgerFilter LEDGER_ID와 같은 값) */
export const LEDGER_HASH = "#ledger";

const withQuery = (p: URLSearchParams) => {
  const q = p.toString();
  return `${HOME_PATH}${q ? `?${q}` : ""}${LEDGER_HASH}`;
};

/** 현황의 지출 내역으로 가는 주소 — check: 규정 점검 탭(flag·unexplained), edit: 열 지출 id, from: 들어온 화면 */
export function ledgerHref(ym?: string, opt: { check?: string; edit?: string; from?: "settlement" | "closing" } = {}): string {
  const p = new URLSearchParams();
  if (ym) p.set("ym", ym);
  if (opt.check) p.set("check", opt.check);
  if (opt.edit) p.set("edit", opt.edit);
  // 마감에서 들어오면 위에 돌아가기 링크 (from=closing: 마감·상신으로). from=settlement는 예전 내 정산 화면용 — 지금은 내 지출 내역과 같은 화면이라 쓰지 않는다
  if (opt.from) p.set("from", opt.from);
  return withQuery(p);
}

/** 현황 안 정산 구역 — 팀원: 내 지출 내역 아래 월별 정산(받을 돈·본인 부담 공제), PM·재무: 팀원별 정산 */
export const SETTLE_HASH = "#settle";

/**
 * 예전 내 정산 주소(/settlement?ym=&scope=) → 현황의 정산 구역. 팀원은 내 지출 내역(#settle, 달만),
 * PM·재무·관리자는 팀원별 정산(#settle, 달·범위 유지). 꼴이 안 맞는 달은 버린다 (화면이 마지막 본 달로)
 */
export function settlementRedirect(role: Role, q: { ym?: string; scope?: string } = {}): string {
  const p = new URLSearchParams();
  if (q.ym && /^\d{4}-\d{2}$/.test(q.ym)) p.set("ym", q.ym);
  if (role !== "MEMBER" && q.scope) p.set("scope", q.scope);
  const s = p.toString();
  return `${HOME_PATH}${s ? `?${s}` : ""}${SETTLE_HASH}`;
}

/** 내 지출 내역의 출입증 탭 (팀원: 업체 내역의 내 사용분 확인·업무 사용 표시). ym = 내역 월 */
export const PASS_TAB = "pass";
export function passCheckHref(ym?: string): string {
  const p = new URLSearchParams({ tab: PASS_TAB });
  if (ym) p.set("ym", ym);
  return `${HOME_PATH}?${p}`;
}

/**
 * 합친 예전 주소 → 새 주소 (해당 없으면 null). 미들웨어가 쓴다 (엣지에서 도는 순수함수).
 * /monthly?…(ym·check·edit·scope 등 쿼리 그대로) → /dashboard?…#ledger
 * /expenses/new?mode=pass(&ym=) (예전 지출 입력의 출입증 탭) → /dashboard?tab=pass(&ym=) — PM은 현황이 출입증 정산(/pass)으로 보낸다
 */
export function legacyRedirect(pathname: string, search: string): string | null {
  if (pathname === "/expenses/new") {
    const p = new URLSearchParams(search);
    if (p.get("mode") !== "pass") return null;
    const ym = p.get("ym");
    return passCheckHref(ym && /^\d{4}-\d{2}$/.test(ym) ? ym : undefined);
  }
  if (pathname !== "/monthly" && !pathname.startsWith("/monthly/")) return null;
  const p = new URLSearchParams(search);
  p.delete("_rsc");
  return withQuery(p);
}
