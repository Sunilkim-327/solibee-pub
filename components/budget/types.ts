// 프로젝트 운영비(예산) 화면 공용 타입

export type BudgetItem = {
  id: string; name: string; code: string | null; categoryId: string;
  perPersonLimit: number | null; hardBudget: boolean; active: boolean;
  /** 카드 사용분 참석자·대상인원 필수 (공용 지출 항목은 끈다) */
  needsAttendees: boolean;
  /** 출입증 항목: 연결 예산 항목 */
  linkedItemId?: string | null;
};
/** 출입증 회사 부담 (확정된 달 합계·월별, 확정 전 합계) — 연결 예산 항목이 있으면 확정분은 그 항목의 집행에 포함 */
export type PassCompany = { confirmed: number; pending: number; months: Record<string, number> };
export type BudgetLineInit = { itemId: string; detail: string; unitPrice: number; periods: number; changeId: string | null; bundleItemIds: string[] };
/** 화면 편집용 예산 행 (key: 화면 전용 식별자) */
export type Line = { key: string; itemId: string; detail: string; unitPrice: number; periods: number; changeId: string; bundle: string[] };
export type Template = { id: string; name: string; code: string | null; categoryId: string; perPersonLimit: number | null };
/** 항목 설정 (자동 저장 대기 중인 값) */
export type Settings = Pick<BudgetItem, "name" | "categoryId" | "perPersonLimit" | "hardBudget" | "needsAttendees" | "active">;
export type CategoryRef = { id: string; name: string };
export type MonthRef = { ym: string; label: string };
/** 변경계약 (from: 효력 시작 "YYYY-MM" — 펼침 패널 계획 누적의 계단) */
export type ChangeRef = { id: string; label: string; from?: string | null };
export type PricePatch = { unitPrice?: number; periods?: number };
/** 예산 항목에 연결된 출입증 회사 부담 합계 — confirmed는 집행에 포함된 몫, pending은 확정 전(집행 미포함) */
export type PassLinked = { confirmed: number; pending: number; names: string[] };
