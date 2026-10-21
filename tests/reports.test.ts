import { describe, expect, it } from "vitest";
import { budgetAuditSummary, buildDashboard } from "@/lib/reports";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const project = { id: "p", startDate: d("2026-01-01"), endDate: d("2026-03-31") };
const item = (id: string, name: string, categoryId = "food", projectId = "p") => ({ id, name, projectId, categoryId, active: true, accountCode: null, category: { name: categoryId === "food" ? "식대" : "기타" } });
const ex = (itemId: string, amount: number, yearMonth: string, projectId = "p") => ({ itemId, amount, yearMonth, projectId, payMethod: "PERSONAL_CARD", isHq: false, payerId: "u" });

describe("buildDashboard (예산 대비 집행)", () => {
  it("묶음은 대표 항목으로 합산, 월별·총계·마감 상태", () => {
    const r = buildDashboard({
      project,
      children: [],
      lines: [{ projectId: "p", itemId: "night", planned: 300_000, bundleItemIds: '["snack"]' }, { projectId: "p", itemId: "etc", planned: 50_000, bundleItemIds: null }],
      expenses: [ex("night", 10_000, "2026-01"), ex("snack", 5_000, "2026-02"), ex("etc", 7_000, "2026-02")],
      items: [item("night", "야근식대"), item("snack", "간식비"), item("other", "회식비"), item("etc", "잡비", "misc")],
      closings: new Map([["2026-01", { status: "APPROVED" }]]),
      now: "2026-02",
    });
    expect(r.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    const night = r.rows.find((x) => x.itemId === "night")!;
    expect(night).toMatchObject({ planned: 300_000, spent: 15_000, remaining: 285_000, itemName: "야근식대 + 간식비", bundleItemNames: ["간식비"], months: [10_000, 5_000, 0] });
    expect(r.rows.some((x) => x.itemId === "snack")).toBe(false);
    expect(r.totals).toMatchObject({ planned: 350_000, spent: 22_000, remaining: 328_000 });
    expect(r.trend.map((t) => t.status)).toEqual(["APPROVED", "DRAFT", "DRAFT"]);
    expect(r.categories).toEqual([{ name: "식대", planned: 300_000, spent: 15_000 }, { name: "기타", planned: 50_000, spent: 7_000 }]);
  });

  it("분류의 모든 항목을 묶으면 분류 이름으로 표시", () => {
    const r = buildDashboard({
      project, children: [],
      lines: [{ projectId: "p", itemId: "a", planned: 100, bundleItemIds: ["b"] }],
      expenses: [], items: [item("a", "가"), item("b", "나")], closings: new Map(), now: "2026-01",
    });
    expect(r.rows[0].itemName).toBe("식대 (분류 전체)");
  });

  it("하위 프로젝트 취합: 기간 내 월만, 예산은 귀속 개월 비율 (분류+항목명으로 합침)", () => {
    const child = { id: "c", startDate: d("2026-02-01"), endDate: d("2026-07-31") }; // 6개월 중 2개월 귀속
    const r = buildDashboard({
      project,
      children: [child],
      lines: [{ projectId: "p", itemId: "n1", planned: 1000, bundleItemIds: null }, { projectId: "c", itemId: "n2", planned: 1000, bundleItemIds: null }],
      expenses: [ex("n1", 100, "2026-01"), ex("n2", 200, "2026-03", "c"), ex("n2", 999, "2026-05", "c")],
      items: [item("n1", "야근식대"), item("n2", "야근식대", "food", "c")],
      closings: new Map(), now: "2026-03",
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ planned: 1000 + 333, spent: 300 });
  });

  it("매월/비정기 항목: 예산 행이 모두 기간(회) ≥ 개월수면 매월, 하나라도 짧으면 비정기", () => {
    const r = buildDashboard({
      project, children: [],
      lines: [
        { projectId: "p", itemId: "night", planned: 300, periods: 3, bundleItemIds: null },
        { projectId: "p", itemId: "etc", planned: 300, periods: 3, bundleItemIds: null },
        { projectId: "p", itemId: "etc", planned: 100, periods: 1, bundleItemIds: null },
        { projectId: "p", itemId: "other", planned: 100, bundleItemIds: null },
      ],
      expenses: [], items: [item("night", "야근식대"), item("etc", "잡비", "misc"), item("other", "회식비")], closings: new Map(), now: "2026-01",
    });
    const reg = Object.fromEntries(r.rows.map((x) => [x.itemId, x.regular]));
    expect(reg).toEqual({ night: true, etc: false, other: true });
  });
});

describe("budgetAuditSummary (예산 저장 감사 요약)", () => {
  const l = (itemId: string, unitPrice: number, detail = "", bundleItemIds: string | null = null) => ({ itemId, detail, unitPrice, periods: 3, planned: unitPrice * 3, changeId: null, bundleItemIds });
  it("행 수·계획 합계·바뀐 항목만 (순서만 바뀐 건 제외)", () => {
    const before = [l("a", 100), l("b", 200), l("c", 300)];
    const after = [l("b", 200), l("a", 100), l("c", 350), l("d", 10)];
    expect(budgetAuditSummary(before, after)).toEqual({ count: 4, prevCount: 3, planned: 1980, changedItemIds: ["c", "d"] });
  });
  it("삭제·묶음 변경도 바뀐 항목", () => {
    expect(budgetAuditSummary([l("a", 1), l("b", 1)], [l("a", 1, "", '["x"]')]).changedItemIds).toEqual(["a", "b"]);
  });
});
