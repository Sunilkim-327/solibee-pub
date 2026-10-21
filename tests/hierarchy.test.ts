import { describe, expect, it } from "vitest";
import { ancestorsOf, descendantsOf, orderTree, visibleProjects, wouldCycleProject } from "@/lib/hierarchy";

// 본사업 ─ 서브A ─ 서브A-1
//        └ 서브B
// 별도사업
const nodes = [
  { id: "main", parentId: null },
  { id: "a", parentId: "main" },
  { id: "a1", parentId: "a" },
  { id: "b", parentId: "main" },
  { id: "other", parentId: null },
];

describe("프로젝트 상·하위 구조", () => {
  it("하위·상위 찾기", () => {
    expect(descendantsOf(nodes, "main").sort()).toEqual(["a", "a1", "b"]);
    expect(descendantsOf(nodes, "a")).toEqual(["a1"]);
    expect(ancestorsOf(nodes, "a1")).toEqual(["a", "main"]);
    expect(ancestorsOf(nodes, "main")).toEqual([]);
  });

  it("순환 금지", () => {
    expect(wouldCycleProject(nodes, "main", "a1")).toBe(true);
    expect(wouldCycleProject(nodes, "a", "a")).toBe(true);
    expect(wouldCycleProject(nodes, "b", "a")).toBe(false);
    expect(wouldCycleProject(nodes, "a", null)).toBe(false);
  });

  it("상위 PM은 하위 전체를 보고, 하위 PM은 상위를 못 본다", () => {
    const top = visibleProjects(nodes, [{ projectId: "main", isPm: true }]);
    expect([...top.entries()].sort()).toEqual([["a", "parent-pm"], ["a1", "parent-pm"], ["b", "parent-pm"], ["main", "member"]]);
    const sub = visibleProjects(nodes, [{ projectId: "a", isPm: true }]);
    expect([...sub.keys()].sort()).toEqual(["a", "a1"]);
    expect(sub.has("main")).toBe(false);
  });

  it("상위 프로젝트의 팀원(비 PM)은 하위를 보지 못한다", () => {
    expect([...visibleProjects(nodes, [{ projectId: "main", isPm: false }]).keys()]).toEqual(["main"]);
  });

  it("트리 순서", () => {
    expect(orderTree(nodes).map((n) => `${"-".repeat(n.depth)}${n.id}`)).toEqual(["main", "-a", "--a1", "-b", "other"]);
  });
});

describe("조직장", () => {
  const depts = [
    { id: "co", parentId: null },
    { id: "biz", parentId: "co" },
    { id: "plat", parentId: "biz" },
    { id: "data", parentId: "biz" },
    { id: "fin", parentId: "co" },
  ];
  const projects = [
    { id: "p-plat", departmentId: "plat" },
    { id: "p-data", departmentId: "data" },
    { id: "p-fin", departmentId: "fin" },
    { id: "p-none", departmentId: null },
  ];
  it("본부장은 본부 아래 모든 팀의 프로젝트", async () => {
    const { orgHeadProjects } = await import("@/lib/hierarchy");
    expect(orgHeadProjects(projects, depts, ["biz"]).sort()).toEqual(["p-data", "p-plat"]);
    expect(orgHeadProjects(projects, depts, ["plat"])).toEqual(["p-plat"]);
    expect(orgHeadProjects(projects, depts, [])).toEqual([]);
  });
});
