// 지출 입력 화면의 항목별 가용 예산 (순수함수 — tests/input-budget.test.ts)
// 매월 항목(예산 행 기간 ≥ 프로젝트 개월수): 이번 달 가용 = 월 예산(계획 ÷ 개월수) − 이번 달 사용
// 그 외(비정기): 기존 잔액(bundleRemaining)만 쓴다. 묶음 예산은 묶음 단위로 합산한다.
import { bundleBudgets, budgetItemIds, type BudgetPlanLine } from "./budget-bundle";

export type PeriodPlanLine = BudgetPlanLine & { periods: number };

/** 항목별 이번 달 예산·사용 (매월 항목만 키가 있다) */
export type MonthBudget = Record<string, { budget: number; spent: number }>;

/**
 * @param lines 프로젝트 예산 행 (periods = 기간·회)
 * @param monthSpentByItem 이번 달 항목별 지출
 * @param monthCount 프로젝트 개월수
 */
export function monthBudgets(lines: PeriodPlanLine[], monthSpentByItem: Record<string, number>, monthCount: number): MonthBudget {
  const out: MonthBudget = {};
  if (monthCount <= 0) return out;
  const budgetOf = bundleBudgets(lines);
  for (const id of budgetItemIds(lines)) {
    const b = budgetOf(id);
    if (b.planned === null) continue;
    // 대표 항목의 예산 행이 모두 프로젝트 기간을 덮어야 매월 항목 (대시보드 regular 판정과 같은 기준)
    const own = lines.filter((l) => l.itemId === b.key);
    if (!own.length || own.some((l) => l.periods < monthCount)) continue;
    out[id] = {
      budget: Math.round(b.planned / monthCount),
      spent: b.group.reduce((a, g) => a + (monthSpentByItem[g] ?? 0), 0),
    };
  }
  return out;
}

/**
 * 프로젝트 기간의 달마다 monthBudgets — 지출 입력에서 사용일이 지난달이면 그 달 기준 가용을 보이기 위해.
 * @param sums 항목·월별 지출 합계
 * @param months 프로젝트 기간의 달 (YYYY-MM)
 */
export function monthBudgetsByYm(lines: PeriodPlanLine[], sums: { itemId: string; yearMonth: string; amount: number }[], months: string[]): Record<string, MonthBudget> {
  const byYm: Record<string, Record<string, number>> = {};
  for (const g of sums) {
    const m = (byYm[g.yearMonth] ??= {});
    m[g.itemId] = (m[g.itemId] ?? 0) + g.amount;
  }
  return Object.fromEntries(months.map((ym) => [ym, monthBudgets(lines, byYm[ym] ?? {}, months.length)]));
}

/**
 * 입력 폼 표시용: 선택한 항목의 가용액과 이 금액을 등록한 뒤 남는 금액.
 * - monthly가 있으면(매월 항목, 사용일이 이번 달) 이번 달 가용 기준
 * - 수정 중이면 원래 금액(같은 예산·같은 달일 때)을 되돌려 더한 값을 넘긴다(refund)
 */
export function availableAfter(x: {
  remaining?: number;
  monthly?: { budget: number; spent: number };
  amount: number;
  /** 수정 중 원래 금액을 잔액에 되돌릴 몫 */
  refundTotal?: number;
  refundMonth?: number;
}) {
  const total = x.remaining !== undefined ? x.remaining + (x.refundTotal ?? 0) : undefined;
  const month = x.monthly ? x.monthly.budget - x.monthly.spent + (x.refundMonth ?? 0) : undefined;
  return {
    /** 총 잔액 (예산 없으면 undefined) */
    total,
    totalAfter: total !== undefined ? total - x.amount : undefined,
    /** 이번 달 가용 (매월 항목만) */
    month,
    monthAfter: month !== undefined ? month - x.amount : undefined,
  };
}
