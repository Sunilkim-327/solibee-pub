// 프로젝트 생애주기·연차(연속 사업) — 순수함수
// 진행 → 종료 대기(기간 종료 후 늦은 입력·마감) → 종료(재무 승인 담당이 종료 처리, 조회 전용) → 보관(목록에서 숨김)
// 근거: PMBOK 프로젝트 종료(기록 보관·변경 차단), 국세기본법 제85조의3(장부·증빙 5년 보존) → 삭제하지 않는다.
import { addMonths, pad2, projectMonths, seoulTodayDate, ymKo } from "./format";

export type ProjectPhase = "UPCOMING" | "ACTIVE" | "WRAPUP" | "CLOSED" | "ARCHIVED";

export const PHASE_LABEL: Record<ProjectPhase, string> = {
  UPCOMING: "시작 전",
  ACTIVE: "진행",
  WRAPUP: "종료 대기",
  CLOSED: "종료",
  ARCHIVED: "보관",
};

/** 종료 후 팀원이 늦은 지출을 입력할 수 있는 기간 (종료일 다음 달 말일까지) */
export const MEMBER_GRACE_MONTHS = 1;
/** 종료 처리 후 이 기간이 지나면 자동으로 보관 (선택 목록에서 숨김) */
const ARCHIVE_AFTER_DAYS = 365;

type Dated = { startDate: Date; endDate: Date; closedAt?: Date | null; archivedAt?: Date | null };

const ymOf = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** now 기본값: 한국 시간 오늘의 UTC 자정 (저장 일자와 같은 기준) */
export function projectPhase(p: Dated, now: Date = seoulTodayDate()): ProjectPhase {
  if (p.archivedAt) return "ARCHIVED";
  if (p.closedAt) return now.getTime() - p.closedAt.getTime() > ARCHIVE_AFTER_DAYS * 86400000 ? "ARCHIVED" : "CLOSED";
  const today = dayOf(now);
  if (today < dayOf(p.startDate)) return "UPCOMING";
  if (today <= dayOf(p.endDate)) return "ACTIVE";
  return "WRAPUP";
}

/** 팀원 입력 가능 여부 — 종료 대기 중에는 종료월 다음 달까지만 */
export function memberInputOpen(p: Dated, now: Date = seoulTodayDate()): boolean {
  const phase = projectPhase(p, now);
  if (phase === "UPCOMING" || phase === "ACTIVE") return true;
  if (phase !== "WRAPUP") return false;
  return ymOf(now) <= addMonths(ymOf(p.endDate), MEMBER_GRACE_MONTHS);
}

/** 변경 가능한 상태인지 (종료·보관이면 조회 전용) */
export const isWritablePhase = (phase: ProjectPhase) => phase !== "CLOSED" && phase !== "ARCHIVED";

/** 종료를 막는 사유 하나 — 처리할 달이 있으면 그 달 화면(마감·상신 / 출입증 정산)으로 */
export type CloseBlocker = { label: string; months: string[]; page: "/closing" | "/pass" | null };

/**
 * 종료 처리 가능 여부: 지출이 있는 월은 모두 승인, 진행 중인 마감·상신(마감·상신·반려)이 없고, 출입증은 모두 월 확정.
 * @returns 막는 사유 목록 (비어 있으면 종료 가능)
 */
export function closeBlockerItems(
  p: Dated,
  closings: { yearMonth: string; status: string }[],
  monthsWithExpenses: string[],
  now: Date = seoulTodayDate(),
  /** 확정되지 않은 출입증 내역 월 (종료하면 조회 전용이 되어 처리할 수 없음) */
  openPassMonths: string[] = [],
): CloseBlocker[] {
  const out: CloseBlocker[] = [];
  const phase = projectPhase(p, now);
  if (phase === "UPCOMING" || phase === "ACTIVE") out.push({ label: "프로젝트 기간이 아직 끝나지 않았습니다", months: [], page: null });
  const statusOf = new Map(closings.map((c) => [c.yearMonth, c.status]));
  const notApproved = projectMonths(p.startDate, p.endDate).filter((m) => monthsWithExpenses.includes(m) && statusOf.get(m) !== "APPROVED");
  if (notApproved.length) out.push({ label: "승인되지 않은 월이 있습니다", months: notApproved, page: "/closing" });
  const pending = closings.filter((c) => c.status !== "APPROVED" && c.status !== "DRAFT" && !notApproved.includes(c.yearMonth)).map((c) => c.yearMonth).sort();
  if (pending.length) out.push({ label: "마감·상신이 진행 중인 월이 있습니다", months: pending, page: "/closing" });
  if (openPassMonths.length) out.push({ label: "확정되지 않은 출입증 내역이 있습니다", months: [...openPassMonths].sort(), page: "/pass" });
  return out;
}

/** 종료를 막는 사유 (글자) — 오류 응답·도움말용. 달은 화면 표기("2026년 11월") */
export function closeBlockers(...args: Parameters<typeof closeBlockerItems>): string[] {
  return closeBlockerItems(...args).map((b) => (b.months.length ? `${b.label}: ${b.months.map(ymKo).join(", ")}` : b.label));
}

// ── 연차(연속 사업) ──

/**
 * 다음 연차 기간: 종료일 다음 날부터 같은 길이 (12개월 사업 → 다음 12개월).
 * 시작일이 없는 달(예: 31일 → 2월)이면 그 달 말일로 맞춘다.
 */
export function nextRoundPeriod(startDate: Date, endDate: Date) {
  const start = new Date(dayOf(endDate) + 86400000);
  const span = (start.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (start.getUTCMonth() - startDate.getUTCMonth());
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + span;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay)) - 86400000);
  return { startDate: start, endDate: end };
}

/** 연차 이름: "○○ 1차" → "○○ 2차", 차수 없으면 "○○ 2차" */
export function nextRoundName(name: string, round: number | null) {
  const base = name.replace(/\s*\(?\d+\s*차(년도)?\)?\s*$/, "").trim();
  return `${base} ${(round ?? 1) + 1}차`;
}
export const seriesBaseName = (name: string) => name.replace(/\s*\(?\d+\s*차(년도)?\)?\s*$/, "").trim() || name;

// ── 서브 프로젝트의 월별 귀속 ──

export type SeriesNode = { id: string; parentId: string | null; seriesId: string | null; startDate: Date; endDate: Date };

const overlaps = (a: { startDate: Date; endDate: Date }, b: { startDate: Date; endDate: Date }) =>
  dayOf(a.startDate) <= dayOf(b.endDate) && dayOf(b.startDate) <= dayOf(a.endDate);

/**
 * 상위 프로젝트에서 취합·조회하는 하위 프로젝트 (자기 자신 제외).
 * 직접 하위 + 같은 연속 사업의 다른 연차에 연결된 하위 중 기간이 겹치는 것.
 * 예) 서브(26.08~27.03)가 1차(25.12~26.11)에 연결돼 있어도 2차(26.12~27.11)에서 함께 취합된다.
 */
export function rollupChildren(nodes: SeriesNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const self = byId.get(id);
  if (!self) return [];
  const siblingsInSeries = self.seriesId ? nodes.filter((n) => n.seriesId === self.seriesId).map((n) => n.id) : [id];
  const direct = nodes.filter((n) => n.id !== id && n.parentId && siblingsInSeries.includes(n.parentId) && (n.parentId === id || overlaps(n, self)));
  const out: string[] = [];
  const queue = direct.map((n) => n.id);
  while (queue.length) {
    const cur = queue.shift()!;
    if (out.includes(cur) || cur === id) continue;
    out.push(cur);
    for (const n of nodes) if (n.parentId === cur) queue.push(n.id);
  }
  return out;
}

/** 하위 프로젝트 월 중 상위 기간에 귀속되는 월 */
export function attributedMonths(child: { startDate: Date; endDate: Date }, parent: { startDate: Date; endDate: Date }) {
  const parentMonths = new Set(projectMonths(parent.startDate, parent.endDate));
  return projectMonths(child.startDate, child.endDate).filter((m) => parentMonths.has(m));
}

/** 서브 기간 중 연속 사업의 어느 연차에도 속하지 않는 월 (다음 연차가 아직 없을 때 등) */
export function uncoveredMonths(child: { startDate: Date; endDate: Date }, rounds: { startDate: Date; endDate: Date }[]) {
  const covered = new Set(rounds.flatMap((r) => projectMonths(r.startDate, r.endDate)));
  return projectMonths(child.startDate, child.endDate).filter((m) => !covered.has(m));
}

/**
 * 하위 프로젝트 금액(예산 계획)을 상위 기간에 귀속되는 월 비율로 나눈다.
 * 누적 반올림(앞쪽 월까지 비율의 차)이라 연차별로 나눈 금액을 모두 더하면 원래 금액과 같다 (끝전은 마지막 몫에).
 */
export function proRate(amount: number, child: { startDate: Date; endDate: Date }, parent: { startDate: Date; endDate: Date }): number {
  const all = projectMonths(child.startDate, child.endDate);
  if (!all.length) return 0;
  const inParent = new Set(projectMonths(parent.startDate, parent.endDate));
  const idx = all.map((m, i) => (inParent.has(m) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return 0;
  const upTo = (n: number) => Math.round((amount * n) / all.length);
  // 귀속 월은 연속 구간 (두 기간의 교집합)
  return upTo(idx[idx.length - 1] + 1) - upTo(idx[0]);
}
