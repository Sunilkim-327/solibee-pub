// 한도 초과 정산 — 카드 지출은 한도 금액으로 정산하고 결제금액을 세부내역에 남긴다, 출입증은 하루 한도까지만 회사 부담 (정합성 케이스별 점검)
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {}, toNumber: (v: unknown) => (v == null ? 0 : Number(v)) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

import type { SessionUser } from "@/lib/access";
import { buildExpenseData } from "@/lib/expenses";
import { companyAmounts, passBudgetSpend, passExcelRows, type PassCompanyLine } from "@/lib/pass-budget";
import { companySplit, dayLimitMessage, dayLimitOver, deductionList, memberExpectation, summarizeStatement } from "@/lib/pass-statement";
import { checkPolicy, limitCap, withPaidNote } from "@/lib/policy";

// ───────────────────────── 카드 지출: 순수함수
describe("한도 캡 (limitCap)", () => {
  const item = { perPersonLimit: 12_000, perCaseLimit: null };
  it("1인당 한도 × 인원을 넘기면 한도까지만 — 초과분은 본인 부담", () => {
    expect(limitCap(13_000, 1, item)).toEqual({ cap: 12_000, original: 13_000, over: 1_000 });
    expect(limitCap(30_000, 2, item)).toEqual({ cap: 24_000, original: 30_000, over: 6_000 });
  });
  it("한도와 같거나 작으면 캡 없음, 인원을 모르면 1인당 한도는 적용하지 않음", () => {
    expect(limitCap(12_000, 1, item)).toBeNull();
    expect(limitCap(11_999, 1, item)).toBeNull();
    expect(limitCap(100_000, null, item)).toBeNull();
    expect(limitCap(100_000, 0, item)).toBeNull();
  });
  it("1건 한도, 둘 다 있으면 작은 쪽", () => {
    expect(limitCap(13_000, null, { perPersonLimit: null, perCaseLimit: 12_000 })).toEqual({ cap: 12_000, original: 13_000, over: 1_000 });
    expect(limitCap(50_000, 3, { perPersonLimit: 12_000, perCaseLimit: 30_000 })).toEqual({ cap: 30_000, original: 50_000, over: 20_000 });
    expect(limitCap(50_000, 2, { perPersonLimit: 12_000, perCaseLimit: 30_000 })).toEqual({ cap: 24_000, original: 50_000, over: 26_000 });
    expect(limitCap(50_000, null, { perPersonLimit: null, perCaseLimit: null })).toBeNull();
  });
});

describe("세부내역 결제금액 표기 (withPaidNote)", () => {
  it("뒤에 붙이고, 이미 있으면 새 금액으로 바꾼다 (중복 금지)", () => {
    expect(withPaidNote("야근 석식", 13_000)).toBe("야근 석식 (결제금액:13,000원)");
    expect(withPaidNote("야근 석식 (결제금액:13,000원)", 14_000)).toBe("야근 석식 (결제금액:14,000원)");
    expect(withPaidNote("야근 석식 (결제금액:13,000원) ", 14_000)).toBe("야근 석식 (결제금액:14,000원)");
  });
});

describe("규정 점검 문구·예산 비교", () => {
  const base = { headcount: 1, date: new Date("2026-10-08T00:00:00Z"), hasExternal: false, item: { name: "야근식대", accountCode: null, perPersonLimit: 12_000, perCaseLimit: null }, remainingBefore: null, sameEntries: 0 };
  it("한도 초과 안내에 정산 금액·결제금액·본인 부담", () => {
    const [f] = checkPolicy({ ...base, amount: 13_000 });
    expect(f.code).toBe("PER_PERSON");
    expect(f.message).toContain("한도 12,000원으로 정산 (결제금액 13,000원, 본인 부담 1,000원)");
    const [c] = checkPolicy({ ...base, amount: 13_000, item: { ...base.item, perPersonLimit: null, perCaseLimit: 12_000 } });
    expect(c.code).toBe("PER_CASE");
    expect(c.message).toContain("한도 12,000원으로 정산 (결제금액 13,000원, 본인 부담 1,000원)");
  });
  it("예산 잔액 비교는 정산 금액(한도) 기준 — 잔액 12,000원에 13,000원 결제는 예산 초과가 아니다", () => {
    expect(checkPolicy({ ...base, amount: 13_000, remainingBefore: 12_000 }).map((f) => f.code)).toEqual(["PER_PERSON"]);
    expect(checkPolicy({ ...base, amount: 13_000, remainingBefore: 11_999 }).map((f) => f.code)).toEqual(["PER_PERSON", "OVER_BUDGET"]);
  });
});

// ───────────────────────── 카드 지출: 저장 (가짜 db)
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const project = { id: "p", startDate: d("2026-01-01"), endDate: d("2026-12-31") };
const pm = { id: "pm", role: "MANAGER", name: "PM" } as unknown as SessionUser;
type PassLine = { id: string; userId: string; date: Date; amount: number; decision: string; memberClaim: null; usageItemId: string; time: string | null; usageItem: { id: string; name: string; perPersonLimit: number | null } };
function fakeDb(o: { item: Record<string, unknown>; planned?: number | null; card?: number; passLines?: PassLine[] }) {
  const db = {
    monthlyClosing: { findFirst: async () => null },
    item: { findUnique: async () => ({ id: "night", projectId: "p", active: true, name: "야근식대", hardBudget: false, needsAttendees: true, accountCode: null, categoryId: "food", perPersonLimit: null, perCaseLimit: null, ...o.item }) },
    expense: { findUnique: async () => null, aggregate: async () => ({ _sum: { amount: o.card ?? 0 } }), count: async () => 0 },
    budgetLine: { findMany: async () => (o.planned === null ? [] : [{ itemId: "night", planned: o.planned ?? 1_000_000, bundleItemIds: null }]) },
    memberItem: { findMany: async () => [] },
    contractChange: { findMany: async () => [] },
    passStatementLine: { findMany: async () => o.passLines ?? [], count: async () => 0 },
  };
  return db as never;
}
const input = { date: "2026-03-05", payMethod: "PERSONAL_CARD", itemId: "night", detail: "야근 석식", headcount: 1, attendees: "PM", justification: "고객사 장애 대응" };

describe("지출 저장: 한도 초과는 한도 금액으로 저장 + 세부내역에 결제금액", () => {
  it("13,000원 결제 · 1인당 한도 12,000 → 금액 12,000·세부내역 '(결제금액:13,000원)'·소명 필요 표시", async () => {
    const db = fakeDb({ item: { perPersonLimit: 12_000 } });
    await expect(buildExpenseData(pm, project, { ...input, amount: 13_000, justification: undefined }, { db })).rejects.toMatchObject({ status: 422 });
    const r = await buildExpenseData(pm, project, { ...input, amount: 13_000 }, { db });
    expect(r.amount).toBe(12_000);
    expect(r.detail).toBe("야근 석식 (결제금액:13,000원)");
    expect(r.flags).toBe("PER_PERSON");
    expect(r.justification).toBe("고객사 장애 대응");
  });
  it("한도 안이면 그대로 (기존 표기도 손대지 않음)", async () => {
    const db = fakeDb({ item: { perPersonLimit: 12_000 } });
    const r = await buildExpenseData(pm, project, { ...input, amount: 12_000, detail: "야근 석식 (결제금액:13,000원)" }, { db });
    expect(r.amount).toBe(12_000);
    expect(r.detail).toBe("야근 석식 (결제금액:13,000원)");
    expect(r.flags).toBeNull();
  });
  it("수정 때 금액이 바뀌면 표기도 새 결제금액으로 (두 번 붙지 않음)", async () => {
    const db = fakeDb({ item: { perPersonLimit: 12_000 } });
    const r = await buildExpenseData(pm, project, { ...input, amount: 14_000, detail: "야근 석식 (결제금액:13,000원)" }, { db, excludeId: "e1" });
    expect(r.amount).toBe(12_000);
    expect(r.detail).toBe("야근 석식 (결제금액:14,000원)");
  });
  it("인원 2명이면 한도 × 2, 1건 한도가 더 작으면 1건 한도", async () => {
    const db2 = fakeDb({ item: { perPersonLimit: 12_000 } });
    expect((await buildExpenseData(pm, project, { ...input, amount: 30_000, headcount: 2, attendees: "PM, 팀원" }, { db: db2 })).amount).toBe(24_000);
    const db3 = fakeDb({ item: { perPersonLimit: 12_000, perCaseLimit: 20_000 } });
    const r = await buildExpenseData(pm, project, { ...input, amount: 30_000, headcount: 2, attendees: "PM, 팀원" }, { db: db3 });
    expect(r.amount).toBe(20_000);
    expect(r.flags).toBe("PER_PERSON,PER_CASE");
  });
  it("예산 잔액은 정산 금액으로 비교: 잔액 12,000에 13,000 결제 → 예산 초과 아님, 11,000이면 초과", async () => {
    const r = await buildExpenseData(pm, project, { ...input, amount: 13_000 }, { db: fakeDb({ item: { perPersonLimit: 12_000 }, planned: 100_000, card: 88_000 }) });
    expect(r.flags).toBe("PER_PERSON");
    const r2 = await buildExpenseData(pm, project, { ...input, amount: 13_000 }, { db: fakeDb({ item: { perPersonLimit: 12_000 }, planned: 100_000, card: 89_000 }) });
    expect(r2.flags).toBe("PER_PERSON,OVER_BUDGET");
  });
  it("출입증 확정분은 하루 한도 배분 뒤 회사 부담분만 집행에 든다 (9,000 + 8,000, 한도 12,000 → 12,000)", async () => {
    const pl = (id: string, amount: number): PassLine => ({ id, userId: "u1", date: d("2026-02-10"), amount, decision: "OVERTIME", memberClaim: null, usageItemId: "pn", time: null, usageItem: { id: "pn", name: "야근식대(출입증)", perPersonLimit: 12_000 } });
    // 예산 100,000 − 카드 70,000 − 출입증 12,000 = 18,000 잔액 → 20,000원 입력은 예산 초과
    const db = fakeDb({ item: {}, planned: 100_000, card: 70_000, passLines: [pl("a", 9_000), pl("b", 8_000)] });
    const r = await buildExpenseData(pm, project, { ...input, amount: 20_000 }, { db });
    expect(r.flags).toBe("OVER_BUDGET");
    const ok = await buildExpenseData(pm, project, { ...input, amount: 18_000 }, { db });
    expect(ok.flags).toBeNull();
  });
});

// ───────────────────────── 출입증: 하루 한도 배분
const items = [{ id: "night", name: "야근식대(출입증)", perPersonLimit: 12_000 }, { id: "meet", name: "회의비", perPersonLimit: null }];
const L = (id: string, amount: number, x: Partial<{ userId: string | null; date: string | null; decision: string | null; memberClaim: string | null; usageItemId: string | null; time: string | null }> = {}) =>
  ({ id, userId: "u1", date: "2026-10-05", amount, decision: "OVERTIME" as string | null, memberClaim: null as string | null, usageItemId: "night" as string | null, time: null as string | null, ...x });

describe("companySplit — 같은 사람·날·항목의 회사 부담은 한도까지만", () => {
  it("한 줄 17,000 → 회사 12,000·본인 5,000", () => {
    const s = companySplit([L("a", 17_000)], items);
    expect(s.get("a")).toEqual({ company: 12_000, personal: 5_000, limit: 12_000, used: 17_000, itemName: "야근식대(출입증)" });
  });
  it("두 줄 9,000 + 8,000 → 9,000/0 + 3,000/5,000 (시간 순으로 한도를 채움)", () => {
    const s = companySplit([L("a", 9_000, { time: "19:00:00" }), L("b", 8_000, { time: "21:00:00" })], items);
    expect(s.get("a")).toMatchObject({ company: 9_000, personal: 0, used: 17_000 });
    expect(s.get("b")).toMatchObject({ company: 3_000, personal: 5_000, used: 17_000 });
    // 순서가 바뀌어 들어와도 같은 결과
    const s2 = companySplit([L("b", 8_000, { time: "21:00:00" }), L("a", 9_000, { time: "19:00:00" })], items);
    expect(s2.get("b")).toMatchObject({ company: 3_000, personal: 5_000 });
  });
  it("결정된 줄이 요청 중인 줄보다 먼저 한도를 차지한다", () => {
    const s = companySplit([L("claim", 8_000, { decision: null, memberClaim: "OVERTIME", time: "18:00:00" }), L("done", 9_000, { time: "21:00:00" })], items);
    expect(s.get("done")).toMatchObject({ company: 9_000, personal: 0 });
    expect(s.get("claim")).toMatchObject({ company: 3_000, personal: 5_000 });
  });
  it("한도 안이면 전액 회사 부담, 다른 날·다른 사람·다른 항목은 따로 센다", () => {
    const s = companySplit([L("a", 7_000), L("b", 5_000), L("c", 11_000, { date: "2026-10-06" }), L("d", 11_000, { userId: "u2" }), L("e", 50_000, { usageItemId: "meet" })], items);
    expect(s.get("a")).toMatchObject({ company: 7_000, personal: 0, used: 12_000 });
    expect(s.get("b")).toMatchObject({ company: 5_000, personal: 0 });
    expect(s.get("c")).toMatchObject({ company: 11_000, personal: 0 });
    expect(s.get("d")).toMatchObject({ company: 11_000, personal: 0 });
    expect(s.has("e")).toBe(false); // 한도 없는 항목
  });
  it("본인 부담 결정·미결정(요청 없음)·사용자나 날짜 없는 줄은 배분 대상이 아니다", () => {
    const s = companySplit([L("x", 20_000, { decision: "DEDUCT" }), L("y", 20_000, { decision: null }), L("z", 20_000, { userId: null }), L("w", 20_000, { date: null })], items);
    expect(s.size).toBe(0);
  });
  it("Date 객체 날짜도 같은 날로 묶는다", () => {
    const s = companySplit([{ ...L("a", 9_000), date: new Date("2026-10-05T00:00:00Z") as unknown as string }, L("b", 8_000)], items);
    expect(s.get("b")).toMatchObject({ company: 3_000, personal: 5_000 });
  });
  it("경고 문구: 회사 부담·초과분을 적는다 (줄의 '회사 부담 n · 초과 n' 표기와 같은 말 — '본인 부담' 글자 없음)", () => {
    const over = dayLimitOver([L("a", 9_000), L("b", 8_000)], items);
    expect(over.get("a")).toMatchObject({ company: 12_000, personal: 5_000, limit: 12_000, used: 17_000 });
    expect(dayLimitMessage(over.get("a")!)).toBe("⚠ 야근식대(출입증) 1일 한도 12,000원 초과 · 회사 부담 12,000원 · 초과 5,000원");
    expect(dayLimitMessage(over.get("a")!)).not.toContain("본인 부담");
    expect(dayLimitOver([L("a", 12_000)], items).size).toBe(0);
  });
});

describe("집계·급여 공제·팀원 예상도 같은 배분", () => {
  const lines = [
    { ...L("a", 9_000, { time: "19:00:00" }), holderName: "홍길동", usageItemName: "야근식대(출입증)", sheetName: "식당" },
    { ...L("b", 8_000, { time: "21:00:00" }), holderName: "홍길동", usageItemName: "야근식대(출입증)", sheetName: "카페" },
    { ...L("c", 4_000, { decision: "DEDUCT" }), holderName: "홍길동" },
  ];
  it("summarizeStatement: 회사 부담 12,000(2건) · 본인 부담 9,000(2건: 공제 4,000 + 초과분 5,000)", () => {
    const s = summarizeStatement(lines, items);
    expect(s.total).toEqual({ amount: 21_000, count: 3 });
    expect(s.overtime).toEqual({ amount: 12_000, count: 2 });
    expect(s.deduct).toEqual({ amount: 9_000, count: 2 });
    expect(s.items).toEqual([{ name: "야근식대(출입증)", amount: 12_000, count: 2, places: [{ place: "식당", amount: 9_000 }, { place: "카페", amount: 3_000 }] }]);
    expect(s.people[0].overtime.amount + s.people[0].deduct.amount).toBe(21_000);
    // 항목을 안 주면 예전처럼 전액 회사 부담 (하위 호환)
    expect(summarizeStatement(lines).overtime.amount).toBe(17_000);
  });
  it("deductionList: 초과분 5,000은 그 줄의 공제액, 회사 부담분은 companyAmount", () => {
    const [p] = deductionList(lines, items);
    expect(p).toMatchObject({ userId: "u1", amount: 9_000, count: 2 });
    expect(p.lines.map((l) => [l.id, l.deductAmount, l.companyAmount])).toEqual([["b", 5_000, 3_000], ["c", 4_000, 0]]);
    expect(deductionList(lines)[0].amount).toBe(4_000);
  });
  it("memberExpectation: 정해진 초과분은 공제 확정, 요청 중인 초과분은 예상 공제", () => {
    const e = memberExpectation(lines, items);
    expect(e).toEqual({ total: 21_000, checked: 0, expected: 9_000, deducted: 9_000, likely: 0, overtime: 12_000 });
    const pending = memberExpectation([L("a", 9_000, { decision: null, memberClaim: "OVERTIME", time: "19:00:00" }), L("b", 8_000, { decision: null, memberClaim: "OVERTIME", time: "21:00:00" })], items);
    expect(pending).toEqual({ total: 17_000, checked: 17_000, expected: 5_000, deducted: 0, likely: 5_000, overtime: 0 });
  });
  it("팀원 요약 카드·하단 바 합계: 회사 부담 = 전체 − 본인 부담 예정 — 줄의 배분(회사 부담 12,000 · 본인 부담 5,000)과 같다", () => {
    // 회사 부담 줄(a 9,000 · b 8,000)을 통째로 더하면 17,000이지만 한도 초과분 5,000은 본인 부담 (components/PassForm MyPassLines와 같은 계산)
    const split = companySplit(lines, items);
    const e = memberExpectation(lines, items, split);
    expect(e.total - e.expected).toBe(12_000);
    expect(e.total - e.expected).toBe([...split.values()].reduce((a, s) => a + s.company, 0));
    expect(e.expected).toBe(4_000 + 5_000);
    // 요청 중(PM 확인 중) 줄도 같은 배분 — 요청분의 초과분은 본인 부담 예정, 회사 부담(PM 확인 중 포함)은 한도까지
    const pend = [L("a", 9_000, { decision: null, memberClaim: "OVERTIME", time: "19:00:00" }), L("b", 8_000, { decision: null, memberClaim: "OVERTIME", time: "21:00:00" })];
    const p = memberExpectation(pend, items, companySplit(pend, items));
    expect(p.total - p.expected).toBe(12_000);
    expect(p.likely).toBe(5_000);
  });
});

describe("예산 집행·상신 엑셀도 회사 부담분만", () => {
  const cl = (id: string, amount: number, x: Partial<PassCompanyLine> = {}): PassCompanyLine => ({
    id, projectId: "p", yearMonth: "2026-10", confirmed: true, userId: "u1", date: "2026-10-05", amount, decision: "OVERTIME", memberClaim: null, onBehalfName: null,
    usageItemId: "night", usageItemName: "야근식대(출입증)", limit: 12_000, linkedItemId: "card-night", linkedItemName: "야근식대", linkedCategoryName: "복리후생비",
    placeType: "식당", place: null, time: null, userName: "홍길동", userPosition: "사원", ...x,
  });
  it("companyAmounts·passBudgetSpend: 9,000 + 8,000 → 12,000", () => {
    const lines = [cl("a", 9_000, { time: "19:00:00" }), cl("b", 8_000, { time: "21:00:00" })];
    expect([...companyAmounts(lines).values()]).toEqual([9_000, 3_000]);
    const r = passBudgetSpend(lines);
    expect(r.confirmedRows).toEqual([{ projectId: "p", itemId: "card-night", yearMonth: "2026-10", amount: 12_000, count: 2 }]);
    expect(r.byPassItem.night.confirmed).toBe(12_000);
    // 한도 정보가 없으면 전액 (하위 호환)
    expect(passBudgetSpend(lines.map((l) => ({ ...l, limit: null }))).confirmedRows[0].amount).toBe(17_000);
  });
  it("확정 전(요청 포함)도 배분, 전액 본인 부담이 된 줄은 상신 엑셀에서 빠진다", () => {
    const pend = passBudgetSpend([cl("a", 12_000, { confirmed: false }), cl("b", 3_000, { confirmed: false, decision: null, memberClaim: "OVERTIME" })]);
    expect(pend.pendingByItem["card-night"]).toBe(12_000);
    const rows = passExcelRows([cl("a", 12_000, { time: "19:00:00" }), cl("b", 3_000, { time: "21:00:00" })], "2026-10");
    expect(rows.map((r) => r.amount)).toEqual([12_000]);
  });
});
