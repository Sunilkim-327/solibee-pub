import { describe, expect, it } from "vitest";
import { inputItemsOf, inputMemberIds, pmIds, settleRowMode, teamWithoutItems, visibleSettlePayers, type InputMembership, type InputSource } from "@/lib/input-capable";

const budget = (itemId: string, projectId = "P", bundle: string[] | null = null): InputSource =>
  ({ projectId, kind: "budget", itemId, bundleItemIds: bundle ? JSON.stringify(bundle) : null, managerId: null });
const member = (itemId: string, projectId = "P"): InputSource => ({ projectId, kind: "member", itemId, bundleItemIds: null, managerId: null });
const change = (itemId: string, managerId: string, projectId = "P"): InputSource => ({ projectId, kind: "change", itemId, bundleItemIds: null, managerId });
const ms = (userId: string, isPm = false, projectId = "P"): InputMembership => ({ projectId, userId, isPm });

describe("입력할 수 있는 사람 판정", () => {
  it("구성원 0명 (PM만): 입력 대상 팀원 없음, PM은 예산 항목 전체 입력", () => {
    const sources = [budget("a"), budget("b")];
    const members = [ms("pm", true)];
    expect(inputMemberIds(members, sources).size).toBe(0);
    expect(inputItemsOf(members[0], sources)).toEqual(["a", "b"]);
    expect(teamWithoutItems("P", [], sources)).toBe(0);
  });

  it("팀원은 있으나 팀원 지출 항목 0개: 팀원은 입력 대상이 아니다 (PM만 입력)", () => {
    const sources = [budget("a")];
    const members = [ms("pm", true), ms("u1"), ms("u2")];
    expect([...inputMemberIds(members, sources)]).toEqual([]);
    expect(inputItemsOf(ms("u1"), sources)).toEqual([]);
    expect(teamWithoutItems("P", [{ userId: "u1" }, { userId: "u2" }], sources)).toBe(2);
  });

  it("일부 팀원만 항목 있음: 과업 담당 팀원은 담당 과업 항목으로 입력할 수 있다", () => {
    const sources = [budget("a"), budget("c"), change("c", "u2")];
    const members = [ms("pm", true), ms("u1"), ms("u2")];
    expect([...inputMemberIds(members, sources)]).toEqual(["u2"]);
    // 팀원 지출 항목이 없으므로 안내 대상은 항목이 없는 1명
    expect(teamWithoutItems("P", [{ userId: "u1" }, { userId: "u2" }], sources)).toBe(1);
  });

  it("팀원 지출 항목이 있으면 팀원 모두 대상, 안내는 하지 않는다", () => {
    const sources = [budget("a"), member("a")];
    expect([...inputMemberIds([ms("pm", true), ms("u1"), ms("u2")], sources)]).toEqual(["u1", "u2"]);
    expect(teamWithoutItems("P", [{ userId: "u1" }], sources)).toBe(0);
  });

  it("예산에 없는 항목은 팀원 항목으로 골라도 입력할 수 없다 · 묶음 예산 항목은 입력 가능", () => {
    expect(inputMemberIds([ms("u1")], [budget("a"), member("z")]).size).toBe(0);
    expect([...inputMemberIds([ms("u1")], [budget("a", "P", ["b"]), member("b")])]).toEqual(["u1"]);
  });

  it("여러 프로젝트: 어느 한 곳에서라도 입력할 수 있으면 대상, 어디서든 PM이면 대상 아님", () => {
    const sources = [budget("a", "P"), budget("x", "S"), member("x", "S")];
    const members = [ms("u1", false, "P"), ms("u1", false, "S"), ms("u3", false, "P"), ms("pm", true, "P"), ms("pm", false, "S")];
    expect([...inputMemberIds(members, sources)]).toEqual(["u1"]);
    expect([...pmIds(members)]).toEqual(["pm"]);
  });
});

describe("팀원별 정산 카드 줄", () => {
  const targets = new Set(["u1"]);
  const pms = new Set(["pm"]);
  it("표시 방식: 대상 팀원 · PM · 입력할 수 없는 팀원", () => {
    expect(settleRowMode("u1", targets, pms)).toBe("target");
    expect(settleRowMode("pm", targets, pms)).toBe("pm");
    expect(settleRowMode("u2", targets, pms)).toBe("quiet");
  });
  it("입력할 수 없는 팀원은 지출이 있을 때만 (금액만), 목록 외 결제자는 그대로", () => {
    const rows = visibleSettlePayers([
      { id: "pm", entered: false, amount: 0 },
      { id: "u1", entered: false, amount: 0 },
      { id: "u2", entered: false, amount: 0 },
      { id: "u3", entered: true, amount: 5000 },
      { id: "x", entered: true, amount: 1000, member: false },
    ], targets, pms);
    expect(rows.map((r) => [r.id, r.mode])).toEqual([["pm", "pm"], ["u1", "target"], ["u3", "quiet"], ["x", "quiet"]]);
  });
  it("구성원 0명: PM 줄만", () => {
    expect(visibleSettlePayers([{ id: "pm", entered: false }], new Set(), pms).map((r) => r.mode)).toEqual(["pm"]);
  });
});
