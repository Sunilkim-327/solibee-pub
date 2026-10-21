import { describe, expect, it } from "vitest";
import { bundleAlias } from "@/lib/budget-bundle";
import { allFolded, budgetLookups, buildBudgetIndex, categoryGauge, foldStorageKey, gaugeTone, parseFold, passLinkedIndex, pct, serializeFold, swapIds, toggleFold, toggleFoldAll } from "@/components/budget/model";
import type { BudgetItem, Line } from "@/components/budget/types";

const line = (key: string, itemId: string, unitPrice: number, periods: number, bundle: string[] = []): Line =>
  ({ key, itemId, detail: "", unitPrice, periods, changeId: "", bundle });
const item = (id: string, extra: Partial<BudgetItem> = {}): BudgetItem =>
  ({ id, name: id, code: null, categoryId: "c", perPersonLimit: null, hardBudget: false, active: true, needsAttendees: true, ...extra });

describe("예산 화면 색인", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const lines = [line("1", "a", 100, 12, ["b"]), line("2", "a", 50, 2), line("3", "c", 10, 1)];
  const alias = bundleAlias(lines.map((l) => ({ itemId: l.itemId, bundleItemIds: l.bundle })));
  const spent = { a: 300, b: 200, c: 5, gone: 70 };
  const monthly = { a: { "2026-01": 100 }, b: { "2026-01": 50, "2026-02": 150 }, c: { "2026-02": 5 } };
  const ix = buildBudgetIndex(items, lines, alias, spent, monthly);
  const f = budgetLookups(ix, new Set(items.map((i) => i.id)), spent);

  it("묶인 항목 지출은 대표 항목으로 합산", () => {
    expect(f.spentOf("a")).toBe(500);
    expect(f.spentOf("b")).toBe(0);
    expect(f.spentOf("c")).toBe(5);
  });
  it("목록에 없는 항목은 그 항목 지출", () => {
    expect(f.spentOf("gone")).toBe(70);
  });
  it("계획 = 행별 단가 × 기간 합", () => {
    expect(f.plannedOf("a")).toBe(1300);
    expect(f.plannedOf("b")).toBe(0);
    expect(f.linesOf("a").map((l) => l.key)).toEqual(["1", "2"]);
  });
  it("월별 지출도 대표 항목으로", () => {
    expect(f.monthOf("a", "2026-01")).toBe(150);
    expect(f.monthOf("a", "2026-02")).toBe(150);
    expect(f.monthOf("c", "2026-02")).toBe(5);
    expect(f.monthOf("c", "2026-01")).toBe(0);
  });
});

describe("출입증 연결 합계", () => {
  it("연결 예산 항목별로 합산", () => {
    const m = passLinkedIndex(
      [item("p1", { linkedItemId: "a" }), item("p2", { linkedItemId: "a" }), item("p3")],
      { p1: { confirmed: 10, pending: 1, months: {} }, p2: { confirmed: 5, pending: 0, months: {} } },
    );
    expect(m.get("a")).toEqual({ confirmed: 15, pending: 1, names: ["p1", "p2"] });
    expect(m.has("p3")).toBe(false);
  });
});

describe("순서 바꾸기", () => {
  it("두 항목 자리만 바꾸고 나머지(다른 분류)는 그대로", () => {
    const list = [{ id: "x" }, { id: "a" }, { id: "y" }, { id: "b" }];
    expect(swapIds(list, "a", "b").map((i) => i.id)).toEqual(["x", "b", "y", "a"]);
    // 되돌리기 = 한 번 더
    expect(swapIds(swapIds(list, "a", "b"), "a", "b")).toEqual(list);
    expect(swapIds(list, "a", "zz")).toBe(list);
  });
});

describe("집행률", () => {
  it("계획 0이면 null", () => {
    expect(pct(5, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33.3);
  });
});

describe("출입증 → 예산 집계 키 (묶음)", () => {
  it("묶인 항목에 연결된 출입증은 대표 항목 줄로", async () => {
    const { passLinkedByKey, spendSplit } = await import("@/components/budget/model");
    const byItem = new Map([["b", { confirmed: 10, pending: 2, names: ["pb"] }], ["c", { confirmed: 5, pending: 0, names: ["pc"] }]]);
    const m = passLinkedByKey(byItem, new Map([["b", "a"]]));
    expect(m.get("a")).toEqual({ confirmed: 10, pending: 2, names: ["pb"] });
    expect(m.get("c")).toEqual({ confirmed: 5, pending: 0, names: ["pc"] });
    // 집행(카드 + 출입증) 400 중 출입증 80 → 카드 320
    expect(spendSplit(400, { confirmed: 80, pending: 15, names: [] })).toEqual({ card: 320, pass: 80, pending: 15 });
  });
});

describe("분류 접기", () => {
  it("토글은 새 집합을 만들고, 모두 접기/펼치기는 보이는 분류 기준", () => {
    const a = toggleFold(new Set(), "c1");
    expect([...a]).toEqual(["c1"]);
    expect([...toggleFold(a, "c1")]).toEqual([]);
    expect(allFolded(a, ["c1", "c2"])).toBe(false);
    expect([...toggleFoldAll(a, ["c1", "c2"])].sort()).toEqual(["c1", "c2"]);
    expect([...toggleFoldAll(new Set(["c1", "c2", "old"]), ["c1", "c2"])]).toEqual([]);
    expect(allFolded(new Set(), [])).toBe(false);
  });
  it("저장값 직렬화 왕복, 깨진 값은 기본(모두 펼침)", () => {
    expect([...parseFold(serializeFold(new Set(["c2", "c1"])))]).toEqual(["c2", "c1"]);
    expect(parseFold(null).size).toBe(0);
    expect(parseFold("{oops").size).toBe(0);
    expect([...parseFold('["a", 3, null, "b"]')]).toEqual(["a", "b"]);
    expect(foldStorageKey("p1")).toBe("opex:budgetFold:p1");
  });
});

describe("분류 머리줄 게이지", () => {
  it("집행률·마감분 비율·잔액, 속도 판정은 매월 쓰는 분류만 기간과 비교", () => {
    const g = categoryGauge({ planned: 5_040_000, spent: 3_683_000, confirmed: 3_000_000, timeRate: 75, paced: true });
    expect(g.rate).toBe(73.1);
    expect(g.confirmedRate).toBe(59.5);
    expect(g.remaining).toBe(1_357_000);
    expect(g.marker).toBe(75);
    expect(g.status).toBe("ok");
    expect(categoryGauge({ planned: 1000, spent: 300, timeRate: 75, paced: true }).status).toBe("slow");
    expect(categoryGauge({ planned: 1000, spent: 300, timeRate: 75, paced: false }).status).toBe("ok");
    expect(gaugeTone("slow")).toBe("info");
    expect(gaugeTone("fast")).toBe("warn");
  });
  it("배정 0이면 집행률 없음, 초과면 bad, 마감분·눈금은 100%에서 자른다", () => {
    const none = categoryGauge({ planned: 0, spent: 10 });
    expect(none.rate).toBeNull();
    expect(none.status).toBe("none");
    expect(none.marker).toBeNull();
    expect(none.confirmedRate).toBeNull();
    const over = categoryGauge({ planned: 1000, spent: 1200, confirmed: 1100, timeRate: 120 });
    expect(over.status).toBe("over");
    expect(gaugeTone(over.status)).toBe("bad");
    expect(over.confirmedRate).toBe(100);
    expect(over.marker).toBe(100);
  });
});

describe("항목 행 표시 모델 — 펼치기 없이", () => {
  it("한 행뿐이면(상세내역이 있어도) 보조 줄 없음, 여럿·변경계약이면 보조 줄", async () => {
    const { hasSubRows, itemRowView } = await import("@/components/budget/model");
    expect(hasSubRows([line("1", "a", 100, 12)])).toBe(false);
    expect(hasSubRows([])).toBe(false);
    expect(hasSubRows([line("1", "a", 100, 12), line("2", "a", 50, 2)])).toBe(true);
    expect(hasSubRows([{ ...line("1", "a", 100, 12), detail: "회식" }])).toBe(false);
    expect(hasSubRows([{ ...line("1", "a", 100, 12), changeId: "ch" }])).toBe(true);
    const v = itemRowView([{ ...line("1", "a", 100, 12, ["b"]), detail: " 회식 " }], { name: "a", categoryId: "c", perPersonLimit: null, hardBudget: false, needsAttendees: true, active: true }, (id) => `이름${id}`);
    expect(v.inline).toBe(true);
    expect(v.detail).toBe("회식");
    expect(v.bundle).toEqual(["b"]);
    expect(v.tags.map((t) => t.label)).toEqual(["묶음: 이름b"]);
  });
  it("칩은 기본값이 아닌 설정만 — 기본이면 비어 있다", async () => {
    const { itemTags } = await import("@/components/budget/model");
    expect(itemTags({ perPersonLimit: null, needsAttendees: true, hardBudget: false, active: true }, [])).toEqual([]);
    expect(itemTags({ perPersonLimit: 12000, needsAttendees: false, hardBudget: true, active: false }, []).map((t) => t.label))
      .toEqual(["1인당 12,000원", "참석자 불필요", "잔액 초과 막기", "사용 안 함"]);
  });
});

describe("항목 펼침 패널 — 월별·누적 추이", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  it("누적 실적은 경과 달까지, 예상은 최근 평균으로 미입력 미래 달을 채운다, 마감분 표시", async () => {
    const { itemBurn } = await import("@/components/budget/model");
    const pts = itemBurn({ months, monthly: [100, 200, 0, 0], lines: [{ amount: 800, from: null }], elapsed: 2, closings: { "2026-01": "APPROVED", "2026-02": "DRAFT" } });
    expect(pts.map((p) => p.actual)).toEqual([100, 300, null, null]);
    expect(pts.map((p) => p.plan)).toEqual([200, 400, 600, 800]);
    expect(pts.map((p) => p.forecast)).toEqual([null, 300, 450, 600]);
    expect(pts.map((p) => p.confirmed)).toEqual([true, false, false, false]);
  });
  it("변경계약 행은 효력 시작 달부터 균등 배분 → 계획 누적이 계단", async () => {
    const { itemBurn } = await import("@/components/budget/model");
    const pts = itemBurn({ months, monthly: [0, 0, 0, 0], lines: [{ amount: 400, from: null }, { amount: 200, from: "2026-03" }], elapsed: 0 });
    expect(pts.map((p) => p.plan)).toEqual([100, 200, 400, 600]);
    // 기간 밖(이전)에서 시작한 변경은 처음부터, 기간 뒤는 무시
    expect(itemBurn({ months, monthly: [0, 0, 0, 0], lines: [{ amount: 400, from: "2025-12" }], elapsed: 0 }).map((p) => p.plan)).toEqual([100, 200, 300, 400]);
    expect(itemBurn({ months, monthly: [0, 0, 0, 0], lines: [{ amount: 400, from: "2027-01" }], elapsed: 0 }).map((p) => p.plan)).toEqual([0, 0, 0, 0]);
  });
  it("작은 사실: 월 평균(경과 달)·가장 많이 쓴 달·남은 달 월 가용·종료 시 예상 잔액", async () => {
    const { itemBurn, itemFacts } = await import("@/components/budget/model");
    const pts = itemBurn({ months, monthly: [100, 300, 0, 0], lines: [{ amount: 800, from: null }], elapsed: 2 });
    const f = itemFacts(pts, 800, 2);
    expect(f.avg).toBe(200);
    expect(f.peak).toEqual({ ym: "2026-02", amount: 300 });
    expect(f.remainMonths).toBe(2);
    expect(f.monthlyAvailable).toBe(200);
    expect(f.forecast).toBe(800);
    expect(f.forecastLeft).toBe(0);
    expect(itemFacts(pts, 800, 4).monthlyAvailable).toBeNull();
  });
});
