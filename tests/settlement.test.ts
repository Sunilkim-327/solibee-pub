import { describe, expect, it } from "vitest";
import {
  budgetSummary,
  forecastTotal,
  paceStatus,
  burnSeries,
  monthUsage,
  monthItemRows,
  riskItems,
  payerUsage,
  budgetRunway,
  type UsageRow,
  splitConfirmed,
  isConfirmedStatus,
  monthAvailable,
  monthlyByItem,
  plannedAmount,
  settle,
  type SettlementExpense,
} from "@/lib/settlement";

const e = (p: Partial<SettlementExpense>): SettlementExpense => ({
  amount: 10000,
  payMethod: "PERSONAL_CARD",
  isHq: false,
  payerId: "kim",
  itemId: "pm",
  yearMonth: "2026-02",
  ...p,
});

const sample: SettlementExpense[] = [
  e({ amount: 30000, payerId: "kim" }),
  e({ amount: 12000, payerId: "kim", itemId: "night" }),
  e({ amount: 25000, payerId: "lee" }),
  e({ amount: 40000, payMethod: "SHARED_CARD", payerId: "kim", itemId: "night" }),
  e({ amount: 100000, payMethod: "HQ", isHq: true, payerId: "hq", itemId: "office", yearMonth: "2026-03" }),
];

describe("정산 규칙", () => {
  it("1. 월 총합계 = 개인 집행내역 합 + 본사 집행내역 합", () => {
    const s = settle(sample);
    expect(s.personal).toBe(107000);
    expect(s.hq).toBe(100000);
    expect(s.total).toBe(207000);
  });

  it("2. 팀원별 정산금액 = PERSONAL_CARD & !isHq 결제자별 합", () => {
    const s = settle(sample);
    expect(s.byPayer).toEqual({ kim: 42000, lee: 25000 });
  });

  it("2-1. 결제자 마스터에 있으면 지출이 없어도 0원으로 노출", () => {
    const s = settle(sample, ["kim", "lee", "park"]);
    expect(s.byPayer.park).toBe(0);
  });

  it("3. 공용법인카드 = SHARED_CARD 합", () => {
    expect(settle(sample).sharedCard).toBe(40000);
  });

  it("4. 본사 = isHq 합", () => {
    expect(settle(sample).hq).toBe(100000);
  });

  it("5. 검증: 팀원별 + 공용 + 본사 == 총합계", () => {
    expect(settle(sample).isValid).toBe(true);
    expect(settle([]).isValid).toBe(true);
  });

  it("5-1. 결제방법과 본사 구분이 어긋나면 검증 실패", () => {
    // 본사 구분이 아닌데 결제방법이 본사지출 → 어느 정산 칸에도 잡히지 않음
    const bad = [...sample, e({ amount: 5000, payMethod: "HQ", isHq: false })];
    expect(settle(bad).isValid).toBe(false);
    // 본사 집행인데 공용카드 → 이중 집계
    const dup = [...sample, e({ amount: 5000, payMethod: "SHARED_CARD", isHq: true })];
    expect(settle(dup).isValid).toBe(false);
  });

  it("6. 예산 지출 = item별 누적 합", () => {
    const b = budgetSummary([], sample);
    const spent = Object.fromEntries(b.rows.map((r) => [r.itemId, r.spent]));
    expect(spent).toEqual({ pm: 55000, night: 52000, office: 100000 });
  });

  it("7. 잔액 = planned − 지출, 집행률", () => {
    const b = budgetSummary(
      [
        { itemId: "pm", planned: 100000 },
        { itemId: "pm", planned: 20000 },
        { itemId: "night", planned: 40000 },
      ],
      sample,
    );
    const pm = b.rows.find((r) => r.itemId === "pm")!;
    expect(pm).toMatchObject({ planned: 120000, spent: 55000, remaining: 65000, rate: 45.8 });
    const night = b.rows.find((r) => r.itemId === "night")!;
    expect(night.remaining).toBe(-12000);
    const office = b.rows.find((r) => r.itemId === "office")!;
    expect(office.rate).toBeNull();
    expect(b.totalPlanned).toBe(160000);
    expect(b.totalSpent).toBe(207000);
    expect(b.totalRemaining).toBe(-47000);
  });

  it("8. 월 컬럼 = yearMonth별 item 합", () => {
    expect(monthlyByItem(sample)).toEqual({
      pm: { "2026-02": 55000 },
      night: { "2026-02": 52000 },
      office: { "2026-03": 100000 },
    });
  });

  it("계획금액 = 단가 × 기간", () => {
    expect(plannedAmount(150000, 12)).toBe(1800000);
  });
});

describe("소진 예측", () => {
  it("누적 + 최근 3개월 평균 × 남은 개월", () => {
    // 12개월 중 4개월 경과: 누적 100, 최근 3개월 평균 (20+30+40)/3=30, 남은 8개월 → 100 + 240
    expect(forecastTotal([10, 20, 30, 40, 0, 0, 0, 0, 0, 0, 0, 0], 4)).toBe(340);
    expect(forecastTotal([0, 0, 0], 0)).toBe(0);
    expect(forecastTotal([5, 5, 5], 3)).toBe(15);
  });
});

describe("소진 예측 — 미리 입력된 다음 달", () => {
  it("이미 입력된 미래 월은 실제 금액, 빈 달만 평균", () => {
    // 12개월, 6개월 경과(월 100), 7월에 300 선입력 → 900 + 100 × 5
    expect(forecastTotal([100, 100, 100, 100, 100, 100, 300, 0, 0, 0, 0, 0], 6)).toBe(1400);
  });
});

describe("집행 속도 판정 (paceStatus)", () => {
  it("예산 없음·초과", () => {
    expect(paceStatus({ rate: null, timeRate: 50 })).toBe("none");
    expect(paceStatus({ rate: 100, timeRate: 100 })).toBe("ok");
    expect(paceStatus({ rate: 100.1, timeRate: 100 })).toBe("over");
    expect(paceStatus({ rate: 101, timeRate: null })).toBe("over");
  });
  it("경과보다 10%p 넘게 빠르면 fast (경계 포함 안 함)", () => {
    expect(paceStatus({ rate: 60, timeRate: 50 })).toBe("ok");
    expect(paceStatus({ rate: 60.1, timeRate: 50 })).toBe("fast");
    // 경과 91.7%에 90% → 정상 (80% 고정 기준 폐기)
    expect(paceStatus({ rate: 90, timeRate: 91.7 })).toBe("ok");
  });
  it("속도를 볼 수 없으면(null) 초과만", () => {
    expect(paceStatus({ rate: 97.5, timeRate: null })).toBe("ok");
    expect(paceStatus({ rate: 5, timeRate: null })).toBe("ok");
  });
  it("종료 시 초과 예상", () => {
    expect(paceStatus({ rate: 50, timeRate: 50, forecast: 1100, planned: 1000 })).toBe("forecastOver");
    expect(paceStatus({ rate: 50, timeRate: 50, forecast: 1000, planned: 1000 })).toBe("ok");
    expect(paceStatus({ rate: 50, timeRate: 50, forecast: 1100, planned: 0 })).toBe("ok");
  });
  it("느림: 경과 25% 이상에서 20%p 넘게 늦음", () => {
    expect(paceStatus({ rate: 45.7, timeRate: 91.7 })).toBe("slow");
    expect(paceStatus({ rate: 0, timeRate: 16.7 })).toBe("ok");
    expect(paceStatus({ rate: 30, timeRate: 50 })).toBe("ok");
    expect(paceStatus({ rate: 29.9, timeRate: 50 })).toBe("slow");
  });
  it("우선순위: 초과 > 빠름 > 초과 예상 > 느림", () => {
    expect(paceStatus({ rate: 120, timeRate: 50, forecast: 9999, planned: 100 })).toBe("over");
    expect(paceStatus({ rate: 80, timeRate: 50, forecast: 9999, planned: 100 })).toBe("fast");
    expect(paceStatus({ rate: 10, timeRate: 60, forecast: 9999, planned: 100 })).toBe("forecastOver");
  });
});

describe("누적 집행 추이 (burnSeries)", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  it("실적은 경과월까지, 계획은 균등 누적(끝전은 마지막), 예상 끝값 = forecastTotal", () => {
    const s = burnSeries(months, [10, 20, 0, 0], 100, 2);
    expect(s.map((p) => p.actual)).toEqual([10, 30, null, null]);
    expect(s.map((p) => p.plan)).toEqual([25, 50, 75, 100]);
    expect(s.map((p) => p.forecast)).toEqual([null, 30, 45, 60]);
    expect(s[3].forecast).toBe(forecastTotal([10, 20, 0, 0], 2));
  });
  it("미리 입력된 다음 달은 예상에 그대로", () => {
    const s = burnSeries(months, [10, 10, 50, 0], 100, 2);
    expect(s[3].forecast).toBe(forecastTotal([10, 10, 50, 0], 2));
  });
  it("경과 0개월이면 실적·예상 없음, 계획 끝전", () => {
    const s = burnSeries(["a", "b", "c"], [0, 0, 0], 100, 0);
    expect(s.every((p) => p.actual === null && p.forecast === null)).toBe(true);
    expect(s.map((p) => p.plan)).toEqual([33, 66, 100]);
  });
});

describe("PM 홈 집계", () => {
  const row = (x: Partial<UsageRow> & { itemId: string }): UsageRow => ({ itemName: x.itemId, categoryName: "c", planned: 1200, spent: 0, forecast: 0, months: [], regular: true, ...x });
  it("monthUsage: 매월 항목은 월 예산 대비, 비정기는 따로", () => {
    const u = monthUsage([row({ itemId: "a", months: [50, 100] }), row({ itemId: "b", regular: false, months: [0, 300] })], 1, 12);
    expect(u).toEqual({ budget: 100, regularSpent: 100, irregularSpent: 300, total: 400, rate: 100 });
  });
  it("monthItemRows: 항목별 월 배정·집행·남음, 비정기는 집행만 — 합계는 monthUsage와 같다", () => {
    const rows = [row({ itemId: "a", months: [50, 100] }), row({ itemId: "b", planned: 2400, months: [0, 250] }), row({ itemId: "c", regular: false, months: [0, 300] })];
    const r = monthItemRows(rows, 1, 12);
    expect(r.rows.map((x) => [x.itemId, x.budget, x.spent, x.left])).toEqual([["a", 100, 100, 0], ["b", 200, 250, -50], ["c", null, 300, null]]);
    const u = monthUsage(rows, 1, 12);
    expect(r.totals).toEqual({ budget: u.budget, spent: u.regularSpent, left: u.budget - u.regularSpent, irregularSpent: u.irregularSpent });
    // 아직 지출이 없는 달
    expect(monthItemRows(rows, 0, 12).rows.map((x) => x.left)).toEqual([50, 200, null]);
  });
  it("riskItems: 초과·빠름·초과 예상만, 위험순, 비정기는 초과만", () => {
    const r = riskItems([
      row({ itemId: "ok", spent: 500, forecast: 1100 }),
      row({ itemId: "fast", spent: 900, forecast: 1100 }),
      row({ itemId: "over", spent: 1300, forecast: 1300 }),
      row({ itemId: "irr", regular: false, spent: 1250 }),
      row({ itemId: "irrOk", regular: false, spent: 1000 }),
      row({ itemId: "fc", spent: 600, forecast: 1500 }),
    ], 50);
    expect(r.map((x) => x.itemId)).toEqual(["over", "irr", "fast", "fc"]);
    expect(r[0].remaining).toBe(-100);
    expect(riskItems([row({ itemId: "a", spent: 1300 }), row({ itemId: "b", spent: 1250 })], 50, 1).map((x) => x.itemId)).toEqual(["a"]);
  });
  it("payerUsage: 0원 포함·미입력 표시, 결제자 목록 순서(직급 → 성명) 유지, 목록 밖 결제자는 뒤에", () => {
    const r = payerUsage([{ id: "p1", name: "가" }, { id: "p2", name: "나" }], [{ payerId: "p2", name: "나", amount: 30, count: 2 }, { payerId: "x", name: "다", amount: 50, count: 1 }]);
    expect(r.map((x) => [x.id, x.amount, x.entered, x.member])).toEqual([["p1", 0, false, true], ["p2", 30, true, true], ["x", 50, true, false]]);
  });
  it("budgetRunway: 잔액 ÷ 남은 개월(내림), 기간 끝나면 null", () => {
    expect(budgetRunway(1200, 400, 2)).toEqual({ remaining: 800, monthsLeft: 2, perMonth: 400 });
    expect(budgetRunway(1200, 400, 0)).toEqual({ remaining: 800, monthsLeft: 0, perMonth: null });
    expect(budgetRunway(1200, 1300, 3)).toEqual({ remaining: -100, monthsLeft: 3, perMonth: -34 });
  });
});

describe("확정분·작성중분, 이번 달 가용", () => {
  it("splitConfirmed: 마감·상신·승인 = 확정, 작성중·반려·상태 없음 = 작성중", () => {
    const by = { "2026-01": 10, "2026-02": 20, "2026-03": 30, "2026-04": 40, "2026-05": 50 };
    const st = { "2026-01": "APPROVED", "2026-02": "SUBMITTED", "2026-03": "CLOSED", "2026-04": "REJECTED" };
    expect(splitConfirmed(by, st)).toEqual({ confirmed: 60, draft: 90 });
    expect(splitConfirmed(undefined, st)).toEqual({ confirmed: 0, draft: 0 });
    expect(isConfirmedStatus("DRAFT")).toBe(false);
  });
  it("monthAvailable: 매월 항목만 월 예산 − 이번 달 사용", () => {
    expect(monthAvailable(1200, 12, 30, true)).toBe(70);
    expect(monthAvailable(1200, 12, 130, true)).toBe(-30);
    expect(monthAvailable(1200, 12, 30, false)).toBeNull();
    expect(monthAvailable(0, 12, 0, true)).toBeNull();
  });
});
