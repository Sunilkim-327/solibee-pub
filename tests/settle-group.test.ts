// 서브 프로젝트 '메인과 함께 상신' 순수함수 (가상의 값)
import { describe, expect, it } from "vitest";
import {
  EXCEL_PREFIX_MAX, excelItemName, excelPrefixProblem, isSettleChild, mergeSettleClosings, partLabel, planImportItems, settleChildIds, settleParentFor, settleParentIds,
  type SettleNode,
} from "@/lib/settle-group";
import { visibleProjects } from "@/lib/hierarchy";
import { suggestItemCode } from "@/lib/item-code";
import { buildDashboard } from "@/lib/reports";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const node = (id: string, x: Partial<SettleNode> = {}): SettleNode => ({
  id, name: id, parentId: null, seriesId: null, startDate: d("2026-01-01"), endDate: d("2026-12-31"), settleWithParent: false, excelPrefix: null, ...x,
});
// 1차·2차 연속 사업 + 1차에 연결된 함께 상신 서브(연차를 넘김) + 따로 상신하는 서브 + 함께 상신 서브의 손자
const nodes: SettleNode[] = [
  node("main1", { name: "운영 1차", seriesId: "s", excelPrefix: "운영" }),
  node("main2", { name: "운영 2차", seriesId: "s", startDate: d("2027-01-01"), endDate: d("2027-12-31"), excelPrefix: "운영" }),
  node("sub", { name: "대응 과업", parentId: "main1", settleWithParent: true, excelPrefix: "대응", startDate: d("2026-07-01"), endDate: d("2027-03-31") }),
  node("solo", { name: "별도 서브", parentId: "main1" }),
  node("grand", { name: "손자", parentId: "sub", settleWithParent: true, excelPrefix: "손자" }),
  node("other", { name: "다른 사업" }),
];

describe("함께 상신 묶음", () => {
  it("메인의 함께 상신 서브: 직접 하위 + 같은 연속 사업 다른 연차에 연결된 서브(기간 겹침), 따로 상신·손자 제외", () => {
    expect(settleChildIds(nodes, "main1")).toEqual(["sub"]);
    expect(settleChildIds(nodes, "main2")).toEqual(["sub"]); // 1차에 연결됐지만 2차 기간(27.01~03)에도 걸침
    expect(settleChildIds(nodes, "other")).toEqual([]);
    expect(settleChildIds(nodes, "sub")).toEqual([]); // 함께 상신하는 서브 아래의 함께 상신은 무시 (한 단계만)
    expect(settleParentIds(nodes, "grand")).toEqual([]);
    expect(isSettleChild(nodes[2])).toBe(true);
    expect(isSettleChild(nodes[3])).toBe(false);
  });

  it("서브의 그 달 메인: 그 달이 든 연차", () => {
    expect(settleParentIds(nodes, "sub").sort()).toEqual(["main1", "main2"]);
    expect(settleParentIds(nodes, "solo")).toEqual([]);
    expect(settleParentFor(nodes, "sub", "2026-09")?.id).toBe("main1");
    expect(settleParentFor(nodes, "sub", "2027-02")?.id).toBe("main2");
    expect(settleParentFor(nodes, "solo", "2026-09")).toBeNull();
  });

  it("서브의 마감 상태: 그 달 메인 행이 우선, 메인 행이 없는 달은 서브 자신의 행", () => {
    const own = [{ yearMonth: "2026-07", status: "APPROVED" }, { yearMonth: "2026-08", status: "CLOSED" }];
    const parents = [{ yearMonth: "2026-08", status: "SUBMITTED" }, { yearMonth: "2026-09", status: "CLOSED" }];
    expect(mergeSettleClosings(own, parents)).toEqual([
      { yearMonth: "2026-07", status: "APPROVED" }, { yearMonth: "2026-08", status: "SUBMITTED" }, { yearMonth: "2026-09", status: "CLOSED" },
    ]);
  });

  it("구분 이름·엑셀 항목 이름 (구분명 없으면 항목 이름 그대로)", () => {
    expect(partLabel({ name: "대응 과업", excelPrefix: "대응" })).toBe("대응");
    expect(partLabel({ name: "대응 과업", excelPrefix: null })).toBe("대응 과업");
    expect(excelItemName("대응", "야근식대")).toBe("대응_야근식대");
    expect(excelItemName(null, "야근식대")).toBe("야근식대");
    expect(excelItemName(" ", "야근식대")).toBe("야근식대");
  });

  it("엑셀 구분명 검사: SUMIF 조건이 그대로 맞도록 와일드카드·밑줄·비교 연산자 금지", () => {
    expect(excelPrefixProblem("대응")).toBeNull();
    expect(excelPrefixProblem("운영2")).toBeNull();
    for (const bad of ["대*응", "대?", "a~b", "운_영", "<운영", "=대응", `"대응"`]) expect(excelPrefixProblem(bad)).not.toBeNull();
    expect(excelPrefixProblem("가".repeat(EXCEL_PREFIX_MAX + 1))).not.toBeNull();
  });
});

describe("권한: 서브 팀원은 메인을 볼 수 없고, 메인 PM은 서브를 조회", () => {
  it("visibleProjects", () => {
    const tree = nodes.map(({ id, parentId }) => ({ id, parentId }));
    const subMember = visibleProjects(tree, [{ projectId: "sub", isPm: false }]);
    expect([...subMember.keys()]).toEqual(["sub"]);
    const subPm = visibleProjects(tree, [{ projectId: "sub", isPm: true }]);
    expect(subPm.has("main1")).toBe(false);
    const mainPm = visibleProjects(tree, [{ projectId: "main1", isPm: true }]);
    expect(mainPm.get("sub")).toBe("parent-pm");
    // 메인 팀원(PM 아님)은 서브를 보지 않는다
    expect(visibleProjects(tree, [{ projectId: "main1", isPm: false }]).has("sub")).toBe(false);
  });
});

describe("메인 항목 가져오기 계획", () => {
  type I = { id: string; code: string | null; categoryId: string; name: string; active: boolean };
  const it_ = (id: string, code: string | null, categoryId: string, name: string, active = true): I => ({ id, code, categoryId, name, active });
  it("같은 코드는 건너뛰고, 코드 없는 메인 항목에 코드를 정하고, 같은 분류·이름의 코드 없는 서브 항목에 코드를 붙인다", () => {
    const main = [it_("m1", "ops-01", "ops", "야근식대"), it_("m2", null, "ops", "회의비"), it_("m3", "ops-03", "ops", "간식비"), it_("m4", "ops-04", "ops", "폐지", false), it_("m5", null, "etc", "소모품")];
    const child = [it_("c1", "ops-01", "ops", "야근식대"), it_("c2", null, "etc", "소모품"), it_("c3", "x-9", "ops", "간식비")];
    const plan = planImportItems(main, child, suggestItemCode);
    expect([...plan.setMainCode.entries()]).toEqual([["m2", "ops-05"], ["m5", "etc-01"]]); // 분류 코드 + 다음 번호 (lib/item-code suggestItemCode)
    expect([...plan.setChildCode.entries()]).toEqual([["c2", "etc-01"]]);
    // 간식비: 이름이 같은 서브 항목(다른 코드)이 있어 건너뜀 / 폐지: 비활성
    expect(plan.create.map((c) => [c.id, c.code])).toEqual([["m2", "ops-05"]]);
  });
  it("서브가 비어 있으면 활성 메인 항목을 모두 같은 코드로", () => {
    const plan = planImportItems([it_("m1", "ops-01", "ops", "야근식대"), it_("m2", "ops-02", "ops", "회의비")], [], suggestItemCode);
    expect(plan.create.map((c) => c.code)).toEqual(["ops-01", "ops-02"]);
    expect(plan.setMainCode.size).toBe(0);
  });
});

describe("현황 취합: 같은 항목 코드는 한 줄로", () => {
  it("이름이 달라도 코드가 같으면 합치고, 코드가 없으면 분류+이름", () => {
    const cat = { name: "식대" };
    const items = [
      { id: "a", name: "야근식대", code: "ops-01", projectId: "main1", categoryId: "food", active: true, accountCode: null, category: cat },
      { id: "b", name: "야근 식대", code: "OPS-01", projectId: "sub", categoryId: "food", active: true, accountCode: null, category: cat },
      { id: "c", name: "간식", code: null, projectId: "main1", categoryId: "food", active: true, accountCode: null, category: cat },
      { id: "e", name: "간식", code: null, projectId: "sub", categoryId: "food", active: true, accountCode: null, category: cat },
    ];
    const dash = buildDashboard({
      project: { id: "main1", startDate: d("2026-01-01"), endDate: d("2026-12-31") },
      children: [{ id: "sub", startDate: d("2026-01-01"), endDate: d("2026-12-31") }],
      lines: [{ projectId: "main1", itemId: "a", planned: 120_000, bundleItemIds: null }, { projectId: "sub", itemId: "b", planned: 60_000, bundleItemIds: null }],
      expenses: [{ projectId: "main1", itemId: "a", yearMonth: "2026-02", amount: 10_000 }, { projectId: "sub", itemId: "b", yearMonth: "2026-02", amount: 5_000 },
        { projectId: "sub", itemId: "e", yearMonth: "2026-03", amount: 3_000 }],
      items, closings: new Map(), now: "2026-03",
    });
    const night = dash.rows.find((r) => r.itemName === "야근식대")!;
    expect([night.planned, night.spent]).toEqual([180_000, 15_000]);
    expect(dash.rows.find((r) => r.itemName === "간식")?.spent).toBe(3_000);
    expect(dash.rows).toHaveLength(2);
  });
});
