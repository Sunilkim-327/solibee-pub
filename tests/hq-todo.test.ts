import { describe, expect, it } from "vitest";
import { buildHqTodos, type HqTodoProject } from "@/lib/hq-todo";

const p = (x: Partial<HqTodoProject> & { id: string }): HqTodoProject => ({
  name: x.id, phase: "ACTIVE", hasBudget: true, pms: ["PM"], submitted: [], closable: false, ...x,
});

describe("재무팀 할 일", () => {
  const rows = [
    p({ id: "a", submitted: ["2026-09"] }),
    p({ id: "b", hasBudget: false }),
    p({ id: "c", pms: [] }),
    p({ id: "d", phase: "WRAPUP", closable: true }),
    p({ id: "e", phase: "WRAPUP", closable: false, hasBudget: false }), // 종료 대기는 예산 미등록 대상 아님
    p({ id: "f", phase: "CLOSED", pms: [], hasBudget: false }), // 종료된 프로젝트는 제외
  ];
  it("종류별로 해당 프로젝트만", () => {
    const t = buildHqTodos(rows, true);
    expect(t.map((x) => [x.kind, x.projects.map((y) => y.id).join("")])).toEqual([
      ["APPROVE", "a"], ["NO_BUDGET", "b"], ["NO_PM", "c"], ["CLOSABLE", "d"],
    ]);
    expect(t[0].projects[0].note).toBe("9월");
    // 빨강은 반려·오류 전용 — 승인 대기는 진행(info), 미등록·PM 미지정은 경고
    expect(t.map((x) => x.tone)).toEqual(["info", "warn", "warn", "info"]);
  });
  it("승인 대기·종료 처리 링크는 프로젝트마다 자기 달·자기 프로젝트로", () => {
    const t = buildHqTodos([
      p({ id: "a", submitted: ["2026-09", "2026-07"] }),
      p({ id: "b", submitted: ["2026-08"] }),
      p({ id: "d", phase: "WRAPUP", closable: true }),
    ], true);
    expect(t[0].projects.map((x) => x.href)).toEqual(["/closing?ym=2026-07", "/closing?ym=2026-08"]);
    expect(t.find((x) => x.kind === "CLOSABLE")!.projects[0].href).toBe("/master?project=d&tab=life");
  });
  it("관리자는 승인 대기를 보지 않는다 (승인은 재무팀만)", () => {
    expect(buildHqTodos(rows, false).some((x) => x.kind === "APPROVE")).toBe(false);
  });
  it("할 일이 없으면 빈 목록", () => {
    expect(buildHqTodos([p({ id: "x" })], true)).toEqual([]);
  });
});
