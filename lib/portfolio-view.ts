// 재무 승인 전체 프로젝트 — 월별 마감 현황 보기 (순수함수)
import type { ClosingStatus } from "./types";
import { MONTH_PHASE_LABEL, monthPhase } from "./month-phase";

/** 안 끝난 곳 먼저: 작성중(미마감) → 반려 → 마감(상신 전) → 상신(승인 대기) → 승인 */
export const BOARD_ORDER: ClosingStatus[] = ["DRAFT", "REJECTED", "CLOSED", "SUBMITTED", "APPROVED"];
export const BOARD_LABEL: Record<ClosingStatus, string> = { DRAFT: "작성중", REJECTED: "반려", CLOSED: "마감", SUBMITTED: "상신", APPROVED: "승인" };

/** 보드 상태 라벨 — 작성중은 선택 달·오늘 기준으로 '작성중 / 마감 대기 / 예정' (lib/month-phase), 나머지는 BOARD_LABEL */
export const boardLabel = (status: ClosingStatus, ym: string, today: string) => (status === "DRAFT" ? MONTH_PHASE_LABEL[monthPhase(ym, status, today)] : BOARD_LABEL[status]);

/**
 * 월별 마감 현황의 기본 달 — 승인 대기(상신)가 있으면 그중 가장 오래된 달(재무 승인 담당이 지금 처리할 달), 없으면 이번 달.
 * 상신 달이 이번 달이 아닐 때만 `moved`가 참이라 화면에서 "승인 대기가 있는 달"로 알린다.
 */
export function defaultBoardYm(rows: { submitted: string[] }[], now: string) {
  const oldest = rows.flatMap((r) => r.submitted).sort()[0];
  const ym = oldest ?? now;
  return { ym, moved: ym !== now };
}

/**
 * 선택 월의 프로젝트별 마감 상태 — 기간 안인 프로젝트만, 안 끝난 곳 먼저 정렬, 상태별 건수.
 * @param filter 상태 하나만 보기 (없으면 전체)
 */
export function monthBoard<T extends { name: string; months: string[]; statuses: Record<string, ClosingStatus> }>(rows: T[], ym: string, filter?: ClosingStatus | null) {
  const inPeriod = rows.filter((r) => r.months.includes(ym)).map((r) => ({ ...r, monthStatus: r.statuses[ym] ?? ("DRAFT" as ClosingStatus) }));
  const counts = Object.fromEntries(BOARD_ORDER.map((s) => [s, inPeriod.filter((r) => r.monthStatus === s).length])) as Record<ClosingStatus, number>;
  const list = inPeriod
    .filter((r) => !filter || r.monthStatus === filter)
    .sort((a, b) => BOARD_ORDER.indexOf(a.monthStatus) - BOARD_ORDER.indexOf(b.monthStatus) || a.name.localeCompare(b.name, "ko"));
  return { list, counts, outside: rows.length - inPeriod.length };
}
