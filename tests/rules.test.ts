import { describe, expect, it } from "vitest";
import {
  allowedItemIds,
  allowedPayMethods,
  canEditBudget,
  canEditMaster,
  canManageProjectSettings,
  canSeeAllRows,
  defaultNeedsAttendees,
  requiresAttendees,
} from "@/lib/rules";

describe("입력 권한 규칙", () => {
  const budget = ["night-meal", "night-taxi", "pm", "night-meal"];

  it("팀원은 예산 항목 중 PM이 노출한 항목만", () => {
    expect(allowedItemIds("MEMBER", budget, ["night-meal", "night-taxi"])).toEqual(["night-meal", "night-taxi"]);
  });

  it("PM이 노출했어도 예산에 없는 항목은 불가", () => {
    expect(allowedItemIds("MEMBER", budget, ["night-meal", "not-in-budget"])).toEqual(["night-meal"]);
  });

  it("PM·재무팀은 예산 항목 전체 (중복 제거)", () => {
    expect(allowedItemIds("MANAGER", budget, [])).toEqual(["night-meal", "night-taxi", "pm"]);
    expect(allowedItemIds("HQ", budget, [])).toEqual(["night-meal", "night-taxi", "pm"]);
  });

  it("팀원 결제방법은 개인식법인카드 고정", () => {
    expect(allowedPayMethods("MEMBER")).toEqual(["PERSONAL_CARD"]);
    expect(allowedPayMethods("HQ")).toEqual(["HQ"]);
  });

  it("카드 사용분은 대상인원·참석자 필수", () => {
    expect(requiresAttendees("PERSONAL_CARD")).toBe(true);
    expect(requiresAttendees("SHARED_CARD")).toBe(true);
    expect(requiresAttendees("HQ")).toBe(false);
    // 공용 비용 항목(참석자 필수 꺼짐)은 카드 사용분이라도 선택
    expect(requiresAttendees("PERSONAL_CARD", false)).toBe(false);
    expect(requiresAttendees("SHARED_CARD", true)).toBe(true);
  });

  it("예산·마스터는 재무팀만 편집, 팀원 노출 설정은 PM", () => {
    expect(canEditBudget("HQ")).toBe(true);
    expect(canEditBudget("MANAGER")).toBe(false);
    expect(canEditBudget("ADMIN")).toBe(false);
    expect(canEditMaster("HQ")).toBe(true);
    expect(canEditMaster("ADMIN")).toBe(false);
    expect(canManageProjectSettings("MANAGER")).toBe(true);
    expect(canManageProjectSettings("MEMBER")).toBe(false);
  });
});

describe("변경계약 과업 지정", async () => {
  const { resolveChangeId } = await import("@/lib/rules");
  const base = { managed: [{ id: "c1", itemIds: ["dev", "night"] }], memberItemIds: ["night", "taxi"], projectChangeIds: ["c1", "c2"] };
  it("담당 PM: 과업 전용 항목은 자동 연결, 팀원 공통 항목은 본 과업", () => {
    expect(resolveChangeId({ ...base, role: "MEMBER", itemId: "dev", requested: null })).toEqual({ changeId: "c1" });
    expect(resolveChangeId({ ...base, role: "MEMBER", itemId: "night", requested: null })).toEqual({ changeId: null });
    expect(resolveChangeId({ ...base, role: "MEMBER", itemId: "night", requested: "c1" })).toEqual({ changeId: "c1" });
  });
  it("담당 PM: 다른 과업·과업 밖 항목은 거부", () => {
    expect(resolveChangeId({ ...base, role: "MEMBER", itemId: "dev", requested: "c2" })).toHaveProperty("error");
    expect(resolveChangeId({ ...base, role: "MEMBER", itemId: "taxi", requested: "c1" })).toHaveProperty("error");
  });
  it("메인 PM: 어느 과업이든 지정, 없는 과업은 거부", () => {
    expect(resolveChangeId({ ...base, managed: [], role: "MANAGER", itemId: "taxi", requested: "c2" })).toEqual({ changeId: "c2" });
    expect(resolveChangeId({ ...base, managed: [], role: "MANAGER", itemId: "taxi", requested: "x" })).toHaveProperty("error");
    expect(resolveChangeId({ ...base, managed: [], role: "MANAGER", itemId: "taxi", requested: null })).toEqual({ changeId: null });
  });
});

describe("전체 행 조회", () => {
  it("이 프로젝트 PM·재무팀·관리자만 (팀원·상위 조회 제외, 종료된 프로젝트는 허용)", () => {
    expect(canSeeAllRows({ role: "MANAGER" })).toBe(true);
    expect(canSeeAllRows({ role: "HQ" })).toBe(true);
    expect(canSeeAllRows({ role: "ADMIN", readOnlyReason: "closed" })).toBe(true);
    expect(canSeeAllRows({ role: "MEMBER" })).toBe(false);
    expect(canSeeAllRows({ role: "MANAGER", readOnlyReason: "view" })).toBe(false);
  });
});

describe("참석자 필수 기본값", () => {
  it("인당 한도가 있는 항목만 필수", () => {
    expect(defaultNeedsAttendees(15000)).toBe(true);
    expect(defaultNeedsAttendees(null)).toBe(false);
    expect(defaultNeedsAttendees(undefined)).toBe(false);
    expect(defaultNeedsAttendees(0)).toBe(false);
  });
});
