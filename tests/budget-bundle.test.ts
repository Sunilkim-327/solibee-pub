import { describe, expect, it } from "vitest";
import { budgetItemIds, budgetKey, budgetKeyMap, bundleAlias, bundleBudgets, bundleLabel, bundleMembers, bundleProblem, bundleRemaining, parseBundle } from "@/lib/budget-bundle";
import { budgetSummary } from "@/lib/settlement";

const ex = (itemId: string, amount: number, yearMonth = "2026-08") => ({ itemId, amount, yearMonth, payMethod: "PERSONAL_CARD", isHq: false, payerId: "u1" });

describe("묶음 예산", () => {
  const lines = [
    { itemId: "night", bundleItemIds: ["snack"], planned: 300_000 * 12 },
    { itemId: "office", bundleItemIds: [], planned: 100_000 * 12 },
  ];

  it("묶인 항목의 지출은 대표 항목 예산으로 합산: 계획 − (야근식대 + 간식비) = 잔액", () => {
    const alias = bundleAlias(lines);
    const expenses = [ex("night", 120_000), ex("snack", 30_000), ex("office", 50_000)].map((e) => ({ ...e, itemId: budgetKey(alias, e.itemId) }));
    const s = budgetSummary(lines, expenses);
    expect(s.rows.find((r) => r.itemId === "night")).toMatchObject({ planned: 3_600_000, spent: 150_000, remaining: 3_450_000 });
    expect(s.rows.some((r) => r.itemId === "snack")).toBe(false);
    expect(s.totalSpent).toBe(200_000);
  });

  it("검증: 한 항목은 한 묶음에만, 묶인 항목은 따로 예산 행 불가", () => {
    expect(bundleProblem(lines)).toBeNull();
    expect(bundleProblem([...lines, { itemId: "snack" }])).toMatch(/따로 예산 행/);
    expect(bundleProblem([...lines, { itemId: "office2", bundleItemIds: ["snack"] }])).toMatch(/두 묶음/);
    // 같은 대표 항목의 여러 행(상세내역별)에 같은 항목을 넣는 것은 허용
    expect(bundleProblem([...lines, { itemId: "night", bundleItemIds: ["snack"] }])).toBeNull();
  });

  it("같은 분류의 항목만 묶을 수 있음", () => {
    const cat = (id: string) => ({ night: "ops", snack: "ops", office: "office" })[id];
    expect(bundleProblem([{ itemId: "night", bundleItemIds: ["snack"] }], (x) => x, cat)).toBeNull();
    expect(bundleProblem([{ itemId: "night", bundleItemIds: ["office"] }], (x) => x, cat)).toMatch(/분류가 달라/);
  });

  it("예산 항목 = 예산 행 항목 + 묶음으로 들어간 항목 (팀원·PM 입력 범위)", () => {
    expect(budgetItemIds([{ itemId: "ktx", bundleItemIds: JSON.stringify(["hotel", "taxi"]) }, { itemId: "pm", bundleItemIds: null }, { itemId: "ktx", bundleItemIds: ["hotel"] }]))
      .toEqual(["ktx", "hotel", "taxi", "pm"]);
  });

  it("보조: JSON 읽기·대표 항목별 묶음·표시 이름", () => {
    expect(parseBundle('["a","b"]')).toEqual(["a", "b"]);
    expect(parseBundle("x")).toEqual([]);
    expect(bundleMembers(lines).get("night")).toEqual(["snack"]);
    expect(bundleLabel("야근식대", ["간식비"])).toBe("야근식대 + 간식비");
  });
});

describe("묶음 단위 예산 잔액 (입력 폼·서버 검사 공통)", () => {
  const lines = [
    { itemId: "night", bundleItemIds: JSON.stringify(["snack"]), planned: 300_000 },
    { itemId: "office", bundleItemIds: null, planned: 100_000 },
  ];
  it("묶인 항목도 묶음 공동 잔액을 보여 준다", () => {
    const r = bundleRemaining(lines, { night: 120_000, snack: 30_000, office: 50_000, other: 9 });
    expect(r).toEqual({ night: 150_000, snack: 150_000, office: 50_000 });
  });
  it("예산 키·묶음 그룹·계획", () => {
    const of = bundleBudgets(lines);
    expect(of("snack")).toEqual({ key: "night", group: ["night", "snack"], planned: 300_000 });
    expect(of("office")).toEqual({ key: "office", group: ["office"], planned: 100_000 });
    expect(of("none").planned).toBeNull();
    expect(budgetKeyMap(lines)).toEqual({ night: "night", snack: "night", office: "office" });
  });
  it("bundleAlias·bundleMembers는 JSON 문자열도 받는다", () => {
    expect(bundleAlias(lines).get("snack")).toBe("night");
    expect(bundleMembers(lines).get("night")).toEqual(["snack"]);
    expect(budgetItemIds([{ itemId: "a", bundleItemIds: "bad json" }, { itemId: "b", bundleItemIds: ["a", "c"] }])).toEqual(["a", "b", "c"]);
  });
});
