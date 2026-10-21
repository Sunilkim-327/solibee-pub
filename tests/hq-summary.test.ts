// 재무 승인 판단 요약 — 순수함수 (lib/hq-summary.ts) 설계 검토(2026-10-14) P0-3. 가짜 데이터
import { describe, expect, it } from "vitest";
import {
  SELF_APPROVAL_HINT, approveSummaryText, deltaText, expenseChanges, hqBudgetTable, monthDelta, passStatusText, payerCompare, reviewTimeline, selfApprovalText, selfApprovalWarning,
  type BudgetPartLike,
} from "@/lib/hq-summary";

const months = ["2026-01", "2026-02", "2026-03"];
const row = (itemId: string, x: Partial<BudgetPartLike["dash"]["rows"][number]> = {}) => ({
  itemId, itemName: itemId, accountCode: "복리후생비", categoryName: "식대", planned: 300_000, spent: 0, remaining: 300_000, months: [0, 0, 0], regular: true, ...x,
});
const part = (id: string, rows: BudgetPartLike["dash"]["rows"], lines: BudgetPartLike["lines"], exact = false): BudgetPartLike => ({
  id, exact, lines,
  dash: {
    rows,
    totals: { planned: rows.reduce((a, r) => a + r.planned, 0), spent: rows.reduce((a, r) => a + r.spent, 0), remaining: rows.reduce((a, r) => a + r.remaining, 0) },
    trend: months.map((_, i) => ({ amount: rows.reduce((a, r) => a + (r.months[i] ?? 0), 0) })),
  },
});
const prefixOf = (id: string) => (id === "sub" ? "대응" : id === "main" ? "운영" : null);

describe("hqBudgetTable — 엑셀 '프로젝트 운영비' 시트와 같은 행·열", () => {
  const main = part("main", [
    row("night", { spent: 350_000, remaining: -50_000, months: [100_000, 100_000, 150_000] }),
    row("coffee", { itemName: "커피", planned: 90_000, spent: 60_000, remaining: 30_000, months: [10_000, 0, 50_000] }),
    row("edu", { itemName: "교육", planned: 200_000, spent: 0, remaining: 200_000, regular: false }),
  ], [
    { itemId: "night", detail: "야근 1만원×10", unitPrice: 100_000, periods: 3 },
    { itemId: "coffee", detail: "원두", unitPrice: 20_000, periods: 3 }, { itemId: "coffee", detail: "컵", unitPrice: 10_000, periods: 3 },
    { itemId: "edu", detail: "세미나", unitPrice: 200_000, periods: 1 },
  ]);
  const sub = part("sub", [row("night", { planned: 150_000, remaining: 150_000 })], [{ itemId: "night", detail: "대응 야근", unitPrice: 100_000, periods: 3 }], true);
  const t = hqBudgetTable({ parts: [main, sub], months, ym: "2026-03", prefixOf });

  it("메인 → 서브 순, 항목 이름에 구분명, 이 달 인덱스", () => {
    expect(t.idx).toBe(2);
    expect(t.rows.map((r) => r.itemName)).toEqual(["운영_night", "운영_커피", "운영_교육", "대응_night"]);
    expect(t.rows[0]).toMatchObject({ accountCode: "복리후생비", categoryName: "식대", partId: "main" });
  });
  it("상세내역은 예산 행을 ' / '로, 단가·기간은 예산 행이 하나일 때만 (서브는 단가×기간=계획일 때만)", () => {
    expect(t.rows[0]).toMatchObject({ detail: "야근 1만원×10", unitPrice: 100_000, periods: 3 });
    expect(t.rows[1]).toMatchObject({ detail: "원두 / 컵", unitPrice: null, periods: null });
    // 서브: 100,000 × 3 ≠ 150,000(귀속 비율로 나눈 계획) → 값만
    expect(t.rows[3]).toMatchObject({ detail: "대응 야근", unitPrice: null, periods: null, planned: 150_000 });
  });
  it("잔액 음수·이 달 월 배정 초과 표시 — 비정기 항목은 월 배정 없음", () => {
    // night: 잔액 -50,000 → over, 월 배정 100,000 < 이 달 150,000 → overMonth
    expect(t.rows[0]).toMatchObject({ over: true, overMonth: true, thisMonth: 150_000, monthBudget: 100_000 });
    // coffee: 월 배정 30,000 < 이 달 50,000 → overMonth만
    expect(t.rows[1]).toMatchObject({ over: false, overMonth: true, monthBudget: 30_000 });
    expect(t.rows[2]).toMatchObject({ over: false, overMonth: false, monthBudget: null });
    expect(t.warnCount).toBe(2);
  });
  it("총합계 행 = 메인 + 서브 (계획·지출·잔액·월별·이 달)", () => {
    expect(t.totals).toEqual({ planned: 740_000, spent: 410_000, remaining: 330_000, months: [110_000, 100_000, 200_000], thisMonth: 200_000 });
  });
  it("기간 밖 달이면 idx -1, 이 달 집행 0", () => {
    const x = hqBudgetTable({ parts: [main], months, ym: "2025-12", prefixOf });
    expect(x.idx).toBe(-1);
    expect(x.rows[0].thisMonth).toBe(0);
    expect(x.totals.thisMonth).toBe(0);
  });
});

describe("전월 대비", () => {
  it("±30% 이상이면 강조, 전월 0원에서 생기면 '신규', 전월 없음은 비교 없음", () => {
    expect(monthDelta(130_000, 100_000)).toEqual({ diff: 30_000, pct: 30, warn: true });
    expect(monthDelta(120_000, 100_000)).toEqual({ diff: 20_000, pct: 20, warn: false });
    expect(monthDelta(60_000, 100_000)).toEqual({ diff: -40_000, pct: -40, warn: true });
    expect(monthDelta(50_000, 0)).toEqual({ diff: 50_000, pct: null, warn: true });
    expect(monthDelta(0, 0)).toEqual({ diff: 0, pct: null, warn: false });
    expect(monthDelta(10, null)).toEqual({ diff: null, pct: null, warn: false });
    expect(deltaText(monthDelta(130_000, 100_000))).toBe("+30%");
    expect(deltaText(monthDelta(60_000, 100_000))).toBe("-40%");
    expect(deltaText(monthDelta(50_000, 0))).toBe("신규");
    expect(deltaText(monthDelta(0, 0))).toBe("0%");
    expect(deltaText(monthDelta(10, null))).toBe("");
  });
  it("결제자별: 둘 다 0원이면 빼고, 결제자 목록 순서 → 목록 밖은 이름순", () => {
    const rows = payerCompare({ a: 100_000, c: 50_000, z: 0 }, { a: 50_000, b: 30_000, z: 0 }, (id) => ({ a: "가", b: "나", c: "다" }[id] ?? id), ["b", "a"]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rows[1]).toMatchObject({ name: "가", current: 100_000, prev: 50_000, diff: 50_000, pct: 100, warn: true });
    expect(rows[0]).toMatchObject({ current: 0, prev: 30_000, pct: -100, warn: true });
    expect(rows[2]).toMatchObject({ pct: null, warn: true }); // 전월 0원 → 신규
  });
  it("결제자별: 동명이인은 집행내역 표와 같은 '이름(2)' 규칙 — 결제자 목록 순서로 번호, 목록 밖은 그 뒤", () => {
    const nameOf = (id: string) => ({ a: "이서준", b: "이서준", c: "김하늘", d: "이서준" }[id] ?? id);
    const rows = payerCompare({ a: 10_000, b: 20_000, d: 5_000 }, { c: 1_000 }, nameOf, ["b", "a", "c"]);
    expect(rows.map((r) => [r.id, r.name])).toEqual([["b", "이서준"], ["a", "이서준(2)"], ["c", "김하늘"], ["d", "이서준(3)"]]);
  });
});

describe("반려 이후 바뀐 지출 (Expense 감사 기록)", () => {
  const at = new Date("2026-10-05T09:00:00Z");
  const log = (action: string, data: unknown, id = action) => ({ id, action, userId: "u1", createdAt: at, data: JSON.stringify(data) });
  it("등록·수정·삭제를 그 달 것만 — 수정은 before/after 부분 병합, 다른 달로 옮긴 것은 movedOut", () => {
    const rows = expenseChanges([
      log("create", { payerId: "p1", itemId: "i1", amount: 12_000, detail: "야근", yearMonth: "2026-09" }),
      log("create", { payerId: "p1", itemId: "i1", amount: 9_000, detail: "다른 달", yearMonth: "2026-10" }, "create-other"),
      log("update", { before: { payerId: "p2", itemId: "i1", amount: 10_000, detail: "전", yearMonth: "2026-09" }, after: { amount: 15_000 } }),
      log("update", { before: { payerId: "p2", itemId: "i1", amount: 10_000, detail: "전", yearMonth: "2026-09" }, after: { yearMonth: "2026-10", itemId: "i2" } }, "update-move"),
      log("delete", { payerId: "p3", itemId: "i2", amount: 7_000, detail: "지움", yearMonth: "2026-09" }),
      { id: "bad", action: "update", userId: "u1", createdAt: at, data: "{broken" },
    ], "2026-09");
    expect(rows.map((r) => r.id)).toEqual(["create", "update", "update-move", "delete"]);
    expect(rows[0]).toMatchObject({ action: "create", payerId: "p1", itemId: "i1", amountBefore: null, amountAfter: 12_000, detail: "야근" });
    expect(rows[1]).toMatchObject({ action: "update", payerId: "p2", amountBefore: 10_000, amountAfter: 15_000, detail: "전", itemAfterId: null, movedOut: false });
    expect(rows[2]).toMatchObject({ movedOut: true, itemId: "i1", itemAfterId: "i2", amountAfter: 10_000 });
    expect(rows[3]).toMatchObject({ action: "delete", amountBefore: 7_000, amountAfter: null });
  });
  it("검토 이력: 상신·반려·승인 취소·승인만 최근순, 상신의 가드 무시 사유·항목", () => {
    const t = reviewTimeline([
      { id: "c", action: "close", userId: "pm", createdAt: new Date("2026-10-01T00:00:00Z"), data: JSON.stringify({ total: 1 }) },
      { id: "s", action: "submit", userId: "pm", createdAt: new Date("2026-10-02T00:00:00Z"), data: JSON.stringify({ blockers: ["PASS_OPEN", "X"], overrideReason: "업체 내역 지연", note: "10월 합산" }) },
      { id: "r", action: "reject", userId: "hq", createdAt: new Date("2026-10-03T00:00:00Z"), data: JSON.stringify({ note: "영수증 확인" }) },
    ]);
    expect(t.map((e) => e.id)).toEqual(["r", "s"]);
    expect(t[1]).toMatchObject({ action: "submit", byId: "pm", note: "10월 합산", overrideReason: "업체 내역 지연", blockers: ["PASS_OPEN"] });
    expect(t[0]).toMatchObject({ action: "reject", note: "영수증 확인", blockers: [], approvalRef: null, unexplainedOverride: null });
  });
  it("승인: 결재 문서번호·소명 없음 승인(override.unexplained) — 빈 문서번호·0건은 null", () => {
    const t = reviewTimeline([
      { id: "a1", action: "approve", userId: "hq", createdAt: new Date("2026-10-04T00:00:00Z"), data: JSON.stringify({ from: "SUBMITTED", to: "APPROVED", note: "확인 후 승인", approvalRef: "BW-2026-1234", override: { unexplained: 2 } }) },
      { id: "a2", action: "approve", userId: "hq", createdAt: new Date("2026-10-03T00:00:00Z"), data: JSON.stringify({ from: "SUBMITTED", to: "APPROVED", approvalRef: "  ", override: { unexplained: 0 } }) },
    ]);
    expect(t[0]).toMatchObject({ id: "a1", action: "approve", note: "확인 후 승인", approvalRef: "BW-2026-1234", unexplainedOverride: 2, selfApproval: null });
    expect(t[1]).toMatchObject({ id: "a2", approvalRef: null, unexplainedOverride: null });
  });
  it("승인: 자기 승인 기록(selfApproval) — 0건·형식이 다르면 null", () => {
    const t = reviewTimeline([
      { id: "a1", action: "approve", userId: "hq", createdAt: new Date("2026-10-04T00:00:00Z"), data: JSON.stringify({ from: "SUBMITTED", to: "APPROVED", selfApproval: { count: 2, amount: 350_000 } }) },
      { id: "a2", action: "approve", userId: "hq", createdAt: new Date("2026-10-03T00:00:00Z"), data: JSON.stringify({ from: "SUBMITTED", to: "APPROVED", selfApproval: { count: 0, amount: 0 } }) },
      { id: "a3", action: "approve", userId: "hq", createdAt: new Date("2026-10-02T00:00:00Z"), data: JSON.stringify({ from: "SUBMITTED", to: "APPROVED", selfApproval: "x" }) },
    ]);
    expect(t[0].selfApproval).toEqual({ count: 2, amount: 350_000 });
    expect(t[1].selfApproval).toBeNull();
    expect(t[2].selfApproval).toBeNull();
  });
});

describe("자기 승인 경고 (P0-3 ④ — 차단 아님)", () => {
  const list = [
    { isHq: true, payMethod: "HQ", createdBy: "hq1", amount: 100_000 },
    { isHq: true, payMethod: "HQ", createdBy: "hq1", amount: 50_000 },
    { isHq: true, payMethod: "HQ", createdBy: "hq2", amount: 70_000 },
    // 본사 지출이 아닌 건은 누가 입력했든 세지 않는다
    { isHq: false, payMethod: "PERSONAL_CARD", createdBy: "hq1", amount: 999_000 },
  ];
  it("승인자 본인이 입력한 본사 지출만 건수·금액으로", () => {
    expect(selfApprovalWarning(list, "hq1")).toEqual({ count: 2, amount: 150_000 });
    expect(selfApprovalWarning(list, "hq2")).toEqual({ count: 1, amount: 70_000 });
  });
  it("없으면 null — 다른 사람·승인자 없음·빈 목록", () => {
    expect(selfApprovalWarning(list, "hq3")).toBeNull();
    expect(selfApprovalWarning(list, null)).toBeNull();
    expect(selfApprovalWarning(list, undefined)).toBeNull();
    expect(selfApprovalWarning([], "hq1")).toBeNull();
  });
  it("isHq 없이 결제방법 HQ만 있어도 본사 지출로 본다 (감사 기록 등 다른 모양의 입력)", () => {
    expect(selfApprovalWarning([{ payMethod: "HQ", createdBy: "hq1", amount: 10 }], "hq1")).toEqual({ count: 1, amount: 10 });
    expect(selfApprovalWarning([{ isHq: true, createdBy: "hq1", amount: 10 }], "hq1")).toEqual({ count: 1, amount: 10 });
  });
  it("문구", () => {
    expect(selfApprovalText({ count: 2, amount: 150_000 })).toBe("본사 지출 2건 150,000원을 본인이 입력했어요");
    expect(SELF_APPROVAL_HINT).toBe("다른 재무 승인 담당이 승인하는 것이 좋아요");
  });
});

describe("문구", () => {
  it("출입증 상태 한 줄·승인 확인 요약", () => {
    expect(passStatusText(null)).toBeNull();
    expect(passStatusText([])).toBeNull();
    expect(passStatusText([{ label: "운영", status: "CONFIRMED" }])).toBe("확정");
    expect(passStatusText([{ label: "운영", status: "CONFIRMED" }, { label: "대응", status: "OPEN" }])).toBe("운영 확정 · 대응 확정 전");
    expect(approveSummaryText({ total: 1_234_000, flagged: 3, unexplained: 1, passText: "확정 전", warnCount: 2 }))
      .toBe("총액 1,234,000원 · 규정 점검 3건(소명 없음 1건) · 출입증 확정 전 · 예산 초과 항목 2개");
    expect(approveSummaryText({ total: 0, flagged: 0, unexplained: 0, passText: null, warnCount: 0 })).toBe("총액 0원 · 규정 점검 없음 · 예산 초과 항목 없음");
    expect(approveSummaryText({ total: 10, flagged: 2, unexplained: 0, passText: null, warnCount: 0 })).toContain("규정 점검 2건(모두 소명)");
  });
});
