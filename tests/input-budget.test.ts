import { describe, expect, it } from "vitest";
import { availableAfter, monthBudgets, monthBudgetsByYm } from "@/lib/input-budget";

describe("입력 화면 이번 달 가용 예산", () => {
  const lines = [
    // 매월 항목 (12개월 프로젝트, 12회) — 야근식대 + 간식비 묶음
    { itemId: "night", bundleItemIds: ["snack"], planned: 300_000 * 12, periods: 12 },
    // 비정기 항목 (2회)
    { itemId: "workshop", bundleItemIds: [], planned: 500_000 * 2, periods: 2 },
    { itemId: "office", bundleItemIds: [], planned: 100_000 * 12, periods: 12 },
  ];

  it("매월 항목: 월 예산 = 계획 ÷ 개월수, 이번 달 사용은 묶음 전체 합계 (묶인 항목도 같은 값)", () => {
    const m = monthBudgets(lines, { night: 120_000, snack: 30_000, office: 10_000 }, 12);
    expect(m.night).toEqual({ budget: 300_000, spent: 150_000 });
    expect(m.snack).toEqual({ budget: 300_000, spent: 150_000 });
    expect(m.office).toEqual({ budget: 100_000, spent: 10_000 });
  });

  it("기간이 프로젝트 개월수보다 짧은 비정기 항목은 월 가용을 만들지 않는다", () => {
    expect(monthBudgets(lines, {}, 12).workshop).toBeUndefined();
  });

  it("달별 가용: 프로젝트 기간의 달마다 그 달 사용으로 계산 (지난달 사용일 입력용)", () => {
    const by = monthBudgetsByYm(lines, [
      { itemId: "night", yearMonth: "2026-09", amount: 100_000 }, { itemId: "snack", yearMonth: "2026-09", amount: 20_000 },
      { itemId: "night", yearMonth: "2026-10", amount: 50_000 },
    ], Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`));
    expect(by["2026-09"].night).toEqual({ budget: 300_000, spent: 120_000 });
    expect(by["2026-10"].snack).toEqual({ budget: 300_000, spent: 50_000 });
    expect(by["2026-08"].night).toEqual({ budget: 300_000, spent: 0 });
    expect(by["2026-09"].workshop).toBeUndefined();
  });

  it("개월수가 0이면 빈 결과", () => {
    expect(monthBudgets(lines, {}, 0)).toEqual({});
  });

  it("등록 후 남는 금액: 이번 달 가용과 총 잔액을 함께, 수정 중이면 원래 금액을 되돌려 더한다", () => {
    expect(availableAfter({ remaining: 1_000_000, monthly: { budget: 300_000, spent: 250_000 }, amount: 80_000 }))
      .toEqual({ total: 1_000_000, totalAfter: 920_000, month: 50_000, monthAfter: -30_000 });
    expect(availableAfter({ remaining: 10_000, monthly: { budget: 300_000, spent: 300_000 }, amount: 40_000, refundTotal: 40_000, refundMonth: 40_000 }))
      .toEqual({ total: 50_000, totalAfter: 10_000, month: 40_000, monthAfter: 0 });
    expect(availableAfter({ amount: 5_000 })).toEqual({ total: undefined, totalAfter: undefined, month: undefined, monthAfter: undefined });
  });
});
