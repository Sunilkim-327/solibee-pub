// 월 단계 — 저장된 마감 상태(작성중·마감·상신·승인·반려)에 "달력 시점"을 더해 화면·입력 차단이 함께 쓰는 순수함수.
// 2026-10-15 결정: 팀원 입력 기한 = 다음 달 3일. 기한이 지나고 아직 마감 전인 달은 '마감 대기'(PM이 마감할 차례)이고 팀원은 입력·수정·삭제할 수 없다(PM 대신 입력만).
// 저장 상태는 바꾸지 않는다 — 마감 기록이 없는 달은 그대로 DRAFT이고, 이 모듈이 읽을 때 단계를 정한다.
import { addMonths, pad2 } from "./format";
import type { ClosingStatus } from "./types";

/** 팀원 입력 기한: 다음 달 N일까지 (0이면 그 달 말일까지) */
export const INPUT_DEADLINE_DAY = 3;

export type MonthPhase = "FUTURE" | "DRAFT" | "PENDING_CLOSE" | "CLOSED" | "SUBMITTED" | "APPROVED" | "REJECTED";

/** 화면 라벨 — 마감 상태 라벨(CLOSING_LABEL)과 같은 말을 쓰고 '마감 대기'·'예정'만 더한다 */
export const MONTH_PHASE_LABEL: Record<MonthPhase, string> = {
  FUTURE: "예정", DRAFT: "작성중", PENDING_CLOSE: "마감 대기", CLOSED: "마감", SUBMITTED: "상신", APPROVED: "승인", REJECTED: "반려",
};

const lastDayOf = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/** 그 달 입력 기한 날짜 "YYYY-MM-DD" — 다음 달 N일 (N이 그 달 길이보다 크면 말일), N=0이면 그 달 말일 */
export function inputDeadline(ym: string, deadlineDay = INPUT_DEADLINE_DAY): string {
  if (deadlineDay <= 0) return `${ym}-${pad2(lastDayOf(ym))}`;
  const next = addMonths(ym, 1);
  return `${next}-${pad2(Math.min(deadlineDay, lastDayOf(next)))}`;
}

/** 기한 표기: "10월 3일" (안내문용) */
export function inputDeadlineLabel(ym: string, deadlineDay = INPUT_DEADLINE_DAY): string {
  const d = inputDeadline(ym, deadlineDay);
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
}

/** 기한까지 남은 날 (오늘 포함 안 함; 지났으면 음수) */
export function daysToDeadline(ym: string, today: string, deadlineDay = INPUT_DEADLINE_DAY): number {
  const d = inputDeadline(ym, deadlineDay);
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** 팀원이 그 달에 입력할 수 있는 시점인지 — 미래 달이 아니고 기한이 지나지 않았을 때 (마감 상태는 따로 본다: isLocked) */
export function inputOpen(ym: string, today: string, deadlineDay = INPUT_DEADLINE_DAY): boolean {
  return ym <= today.slice(0, 7) && today <= inputDeadline(ym, deadlineDay);
}

/**
 * 월 단계: 마감 상태가 있으면 그대로, 작성중(기록 없음 포함)인 달은 오늘 기준으로 작성중 / 마감 대기 / 예정으로 나눈다.
 * 반려(REJECTED)는 PM이 고치는 중이라 기한과 무관하게 '반려'.
 */
export function monthPhase(ym: string, status: ClosingStatus | string | null | undefined, today: string, deadlineDay = INPUT_DEADLINE_DAY): MonthPhase {
  if (status === "CLOSED" || status === "SUBMITTED" || status === "APPROVED" || status === "REJECTED") return status;
  if (ym > today.slice(0, 7)) return "FUTURE";
  return inputOpen(ym, today, deadlineDay) ? "DRAFT" : "PENDING_CLOSE";
}

/**
 * 팀원 입력·수정·삭제가 기한 때문에 막히면 그 문구, 아니면 null — API 403과 화면 안내가 같은 문장을 쓴다.
 * (마감 때문에 막히는 경우는 기존 passLockedProblem/isLocked 문구를 먼저 쓴다)
 */
export function inputDeadlineProblem(ym: string, today: string, deadlineDay = INPUT_DEADLINE_DAY): string | null {
  if (ym > today.slice(0, 7)) return "아직 오지 않은 달이에요.";
  if (inputOpen(ym, today, deadlineDay)) return null;
  return `${Number(ym.slice(5, 7))}월 입력 기한(${inputDeadlineLabel(ym, deadlineDay)})이 지났어요. 추가·수정할 건은 PM에게 요청하세요.`;
}
