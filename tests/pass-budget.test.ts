// 출입증 회사 부담 → 예산 집행 합산 (예산은 하나, 쓰는 방법은 둘) — 가상의 값만 사용
import { describe, expect, it, vi } from "vitest";
import {
  applyPassDup, isCompanyLine, mergeSpendRows, passBudgetSpend, passDuplicateIds, passExcelRows, sumByItem, withPassDup,
  type PassCompanyLine,
} from "@/lib/pass-budget";
import { passSettlementRows, settle } from "@/lib/settlement";
import { bundleRemaining } from "@/lib/budget-bundle";
import { monthBudgets } from "@/lib/input-budget";
import { checkPolicy, flagLabel, needsJustification, needsReview, isUnexplained } from "@/lib/policy";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {}, toNumber: (v: unknown) => (v == null ? 0 : Number(v)) }));

let n = 0;
const line = (x: Partial<PassCompanyLine>): PassCompanyLine => ({
  id: `l${++n}`, projectId: "p", yearMonth: "2026-03", confirmed: true, userId: "u1", date: "2026-03-05", amount: 10_000,
  decision: "OVERTIME", memberClaim: null, onBehalfName: null, usageItemId: "pass-night", usageItemName: "야근식대(출입증)",
  linkedItemId: "night", linkedItemName: "야근 식대", linkedCategoryName: "식대", placeType: "식당", place: null, time: "19:10:00", ...x,
});

describe("회사 부담 줄", () => {
  it("결정 OVERTIME 또는 미결정 + 팀원 요청 OVERTIME", () => {
    expect(isCompanyLine({ decision: "OVERTIME", memberClaim: null })).toBe(true);
    expect(isCompanyLine({ decision: null, memberClaim: "OVERTIME" })).toBe(true);
    expect(isCompanyLine({ decision: "DEDUCT", memberClaim: "OVERTIME" })).toBe(false);
    expect(isCompanyLine({ decision: null, memberClaim: null })).toBe(false);
  });
});

describe("passBudgetSpend — 집행 합산", () => {
  const lines = [
    line({ amount: 12_000 }), // 확정 · 연결 → 집행
    line({ amount: 8_000, yearMonth: "2026-04" }), // 다른 달
    line({ amount: 5_000, confirmed: false }), // 확정 전 결정 → 확정 전
    line({ amount: 3_000, confirmed: false, decision: null, memberClaim: "OVERTIME" }), // 확정 전 팀원 요청 → 확정 전
    line({ amount: 9_000, confirmed: false, decision: "DEDUCT", memberClaim: "OVERTIME" }), // 요청했지만 본인 부담 → 제외
    line({ amount: 7_000, usageItemId: "pass-cafe", usageItemName: "커피(출입증)", linkedItemId: null, linkedItemName: null }), // 연결 없음 → 예산 밖
  ];
  const r = passBudgetSpend(lines);
  it("확정 명세의 회사 부담만, 연결 예산 항목·명세 월별로", () => {
    expect(r.confirmedRows).toEqual([
      { projectId: "p", itemId: "night", yearMonth: "2026-03", amount: 12_000, count: 1 },
      { projectId: "p", itemId: "night", yearMonth: "2026-04", amount: 8_000, count: 1 },
    ]);
  });
  it("확정 전(결정됨 + 팀원 요청)은 따로", () => {
    expect(r.pendingByItem).toEqual({ night: 8_000 });
  });
  it("출입증 항목별 합계는 연결과 무관 (예산 화면 출입증 칸)", () => {
    expect(r.byPassItem["pass-night"]).toEqual({ confirmed: 20_000, pending: 8_000, months: { "2026-03": 12_000, "2026-04": 8_000 } });
    expect(r.byPassItem["pass-cafe"]).toEqual({ confirmed: 7_000, pending: 0, months: { "2026-03": 7_000 } });
  });
  it("카드 합계와 합치면 같은 항목·월은 한 행", () => {
    const card = [{ projectId: "p", itemId: "night", yearMonth: "2026-03", amount: 320_000 }, { projectId: "p", itemId: "snack", yearMonth: "2026-03", amount: 5_000 }];
    const merged = mergeSpendRows(card, r.confirmedRows);
    expect(sumByItem(merged)).toEqual({ night: 340_000, snack: 5_000 });
    expect(merged.find((m) => m.itemId === "night" && m.yearMonth === "2026-03")!.amount).toBe(332_000);
    // 원래 행은 바꾸지 않는다
    expect(card[0].amount).toBe(320_000);
    expect(mergeSpendRows(card, [])).toBe(card);
  });
});

describe("잔액·이번 달 가용 — 출입증 때문에 예산이 차면 카드 입력도 막힌다", () => {
  const budgetLines = [{ itemId: "night", planned: 1_200_000, periods: 12, bundleItemIds: null }];
  const spent = sumByItem(mergeSpendRows([{ projectId: "p", itemId: "night", yearMonth: "2026-03", amount: 1_100_000 }], passBudgetSpend([line({ amount: 100_000 })]).confirmedRows));
  it("잔액 = 배정 − (카드 + 출입증 확정분)", () => {
    expect(bundleRemaining(budgetLines, spent)).toEqual({ night: 0 });
  });
  it("이번 달 가용도 같은 합계", () => {
    expect(monthBudgets(budgetLines, { night: 60_000 + 50_000 }, 12)).toEqual({ night: { budget: 100_000, spent: 110_000 } });
  });
  it("초과 판정: 잔액 0이면 1원도 초과", () => {
    const flags = checkPolicy({ amount: 1, headcount: 1, date: new Date("2026-03-10T00:00:00Z"), hasExternal: false, item: { name: "야근 식대", accountCode: null, perPersonLimit: null, perCaseLimit: null }, remainingBefore: 0, sameEntries: 0 });
    expect(flags.map((f) => f.code)).toEqual(["OVER_BUDGET"]);
  });
});

describe("상신 정산 합계 (lib/settlement)", () => {
  const expenses = [
    { amount: 30_000, payMethod: "PERSONAL_CARD", isHq: false, payerId: "u1", itemId: "night", yearMonth: "2026-03" },
    { amount: 20_000, payMethod: "SHARED_CARD", isHq: false, payerId: "u1", itemId: "team", yearMonth: "2026-03" },
    { amount: 40_000, payMethod: "HQ", isHq: true, payerId: "h", itemId: "sup", yearMonth: "2026-03" },
  ];
  it("출입증 확정분은 본사 집행으로 총합계에 — 팀원별 정산에는 없음, 검증 일치", () => {
    const s = settle([...expenses, ...passSettlementRows([{ itemId: "night", yearMonth: "2026-03", amount: 12_000 }])], ["u1", "u2"]);
    expect(s).toEqual({ total: 102_000, personal: 50_000, byPayer: { u1: 30_000, u2: 0 }, sharedCard: 20_000, hq: 52_000, pass: 12_000, isValid: true });
  });
  it("출입증이 없으면 pass 0 (기존과 같음)", () => {
    expect(settle(expenses, ["u1"]).pass).toBe(0);
  });
});

describe("상신 엑셀 출입증 줄", () => {
  it("그 달 확정분을 사용 건마다 한 줄로 (분류 → 항목 → 사람 → 사용일 순)", () => {
    const rows = passExcelRows([
      line({ amount: 10_000 }), line({ amount: 11_000, date: "2026-03-06" }),
      line({ amount: 5_000, linkedItemId: "coffee", linkedItemName: "간식비", linkedCategoryName: "식대" }),
      line({ amount: 4_000, linkedItemId: "aaa", linkedItemName: "가 항목", linkedCategoryName: "기타" }),
      line({ amount: 99_000, confirmed: false }), line({ amount: 1_000, yearMonth: "2026-04" }), line({ amount: 1_000, linkedItemId: null }),
    ], "2026-03");
    expect(rows).toEqual([
      { itemId: "aaa", itemName: "가 항목", categoryName: "기타", amount: 4_000, count: 1, date: "2026-03-05", vendors: [], users: [] },
      { itemId: "coffee", itemName: "간식비", categoryName: "식대", amount: 5_000, count: 1, date: "2026-03-05", vendors: [], users: [] },
      { itemId: "night", itemName: "야근 식대", categoryName: "식대", amount: 10_000, count: 1, date: "2026-03-05", vendors: [], users: [] },
      { itemId: "night", itemName: "야근 식대", categoryName: "식대", amount: 11_000, count: 1, date: "2026-03-06", vendors: [], users: [] },
    ]);
  });
});

describe("중복 의심 — 같은 사람·같은 날 카드 지출 항목 = 출입증 연결 예산 항목", () => {
  const exp = (id: string, x: Partial<{ payerId: string; date: string; itemId: string; isHq: boolean }> = {}) =>
    ({ id, payerId: "u1", date: "2026-03-05", itemId: "night", isHq: false, flags: null as string | null, ...x });
  const lines = [line({}), line({ userId: "u2", date: "2026-03-07", confirmed: false, decision: null, memberClaim: "OVERTIME" })];
  it("확정 전 결정·팀원 요청도 걸린다", () => {
    const ids = passDuplicateIds([exp("a"), exp("b", { payerId: "u2", date: "2026-03-07" })], lines);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
  it("다른 날·다른 사람·다른 항목·본사 지출은 아님", () => {
    const ids = passDuplicateIds([exp("a", { date: "2026-03-06" }), exp("b", { payerId: "u9" }), exp("c", { itemId: "snack" }), exp("d", { isHq: true })], lines);
    expect(ids.size).toBe(0);
  });
  it("본인 부담·연결 없음·외부인 대납·날짜 없는 줄은 보지 않는다", () => {
    const other = [line({ decision: "DEDUCT" }), line({ linkedItemId: null }), line({ onBehalfName: "외부인" }), line({ date: null })];
    expect(passDuplicateIds([exp("a")], other).size).toBe(0);
  });
  it("저장된 점검 결과에 지금 기준으로 반영 (결정이 바뀌면 빠진다)", () => {
    expect(withPassDup(null, true)).toBe("PASS_DUP");
    expect(withPassDup("PER_PERSON", true)).toBe("PER_PERSON,PASS_DUP");
    expect(withPassDup("PER_PERSON,PASS_DUP", false)).toBe("PER_PERSON");
    expect(withPassDup("PASS_DUP", false)).toBeNull();
    expect(withPassDup("PASS_DUP", true)).toBe("PASS_DUP");
    const rows = applyPassDup([exp("a"), { ...exp("b", { date: "2026-03-09" }), flags: "PASS_DUP" }], lines);
    expect(rows.map((r) => r.flags)).toEqual(["PASS_DUP", null]);
  });
  it("소명이 필요한 점검 (기존 흐름: 확인 필요·소명 없음)", () => {
    expect(needsReview("PASS_DUP")).toBe(true);
    expect(isUnexplained({ flags: "PASS_DUP", justification: null })).toBe(true);
    expect(isUnexplained({ flags: "PASS_DUP", justification: "점심은 카드, 저녁은 출입증" })).toBe(false);
    const flags = checkPolicy({ amount: 9_000, headcount: 1, date: new Date("2026-03-05T00:00:00Z"), hasExternal: false, item: { name: "야근 식대", accountCode: null, perPersonLimit: null, perCaseLimit: null }, remainingBefore: null, sameEntries: 0, passDuplicate: true });
    expect(flags).toEqual([{ code: "PASS_DUP", message: expect.stringContaining("야근 식대 중복 의심") }]);
    expect(needsJustification(flags)).toBe(true);
  });
  it("점검 이름은 항목으로 (항목명 일반화)", () => {
    expect(flagLabel("PASS_DUP", "야근 식대")).toBe("야근 식대 중복 의심");
    expect(flagLabel("PASS_DUP", "주말 식대")).toBe("주말 식대 중복 의심");
    expect(flagLabel("PASS_DUP")).toBe("출입증 중복 의심");
    expect(flagLabel("DUPLICATE", "야근 식대")).toBe("중복 의심");
  });
});

describe("현황 집계 (buildDashboard) — 집행 = 카드 + 출입증 확정분", () => {
  it("항목 집행·월별·잔액·총계에 반영", async () => {
    const { buildDashboard } = await import("@/lib/reports");
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const project = { id: "p", startDate: d("2026-01-01"), endDate: d("2026-12-31") };
    const pass = passBudgetSpend([line({ amount: 80_000 }), line({ amount: 15_000, confirmed: false })]).confirmedRows;
    const dash = buildDashboard({
      project, children: [],
      lines: [{ projectId: "p", itemId: "night", planned: 1_200_000, periods: 12, bundleItemIds: null }],
      expenses: mergeSpendRows([{ projectId: "p", itemId: "night", yearMonth: "2026-03", amount: 320_000 }], pass),
      items: [{ id: "night", name: "야근 식대", projectId: "p", categoryId: "food", active: true, accountCode: null, category: { name: "식대" } }],
      closings: new Map(), now: "2026-03",
    });
    expect(dash.rows[0]).toMatchObject({ itemId: "night", planned: 1_200_000, spent: 400_000, remaining: 800_000 });
    expect(dash.rows[0].months[2]).toBe(400_000);
    expect(dash.totals.spent).toBe(400_000);
  });
});
