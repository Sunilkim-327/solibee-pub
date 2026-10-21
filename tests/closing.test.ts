import { describe, expect, it } from "vitest";
import { availableActions, closingStatusIn, defaultClosingMonth, futureMonthProblem, lockedMonthMessage, stateFailureReason, unlockHint, isLocked, transition, transitionFailureStatus, type TransitionFailure } from "@/lib/closing";
import { suggestItem } from "@/lib/suggest";
import { excelSheetName, parseDateOnly, projectMonths, sheetName } from "@/lib/format";

describe("마감 워크플로우", () => {
  it("마감 이상 상태는 지출 수정 잠금", () => {
    expect(isLocked("DRAFT")).toBe(false);
    expect(isLocked("REJECTED")).toBe(false);
    expect(isLocked(undefined)).toBe(false);
    expect(isLocked("CLOSED")).toBe(true);
    expect(isLocked("SUBMITTED")).toBe(true);
    expect(isLocked("APPROVED")).toBe(true);
  });

  it("작성중 → 마감 → 상신 → 승인", () => {
    expect(transition("DRAFT", "close", "MANAGER")).toEqual({ ok: true, next: "CLOSED" });
    expect(transition("CLOSED", "submit", "MANAGER")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(transition("SUBMITTED", "approve", "HQ")).toEqual({ ok: true, next: "APPROVED" });
  });

  it("반려 시 PM 재마감·재상신 가능", () => {
    expect(transition("SUBMITTED", "reject", "HQ")).toEqual({ ok: true, next: "REJECTED" });
    expect(transition("REJECTED", "close", "MANAGER")).toEqual({ ok: true, next: "CLOSED" });
  });

  it("역할·상태 가드", () => {
    expect(transition("DRAFT", "close", "MEMBER").ok).toBe(false);
    expect(transition("SUBMITTED", "approve", "MANAGER").ok).toBe(false);
    expect(transition("DRAFT", "submit", "MANAGER").ok).toBe(false);
    expect(transition("APPROVED", "reopen", "MANAGER").ok).toBe(false);
    expect(availableActions("CLOSED", "MANAGER")).toEqual(["reopen", "submit"]);
    expect(availableActions("SUBMITTED", "HQ")).toEqual(["approve", "reject"]);
    // 승인 취소는 재무팀만, 반려 상태로 돌아가 PM이 수정
    expect(transition("APPROVED", "revoke", "HQ")).toEqual({ ok: true, next: "REJECTED" });
    expect(transition("APPROVED", "revoke", "MANAGER").ok).toBe(false);
    // 직무 분리: 관리자는 마감·상신·승인·반려·마감 해제 모두 불가 (조회 전용)
    expect(["close", "submit"].map((a) => transition(a === "close" ? "DRAFT" : "CLOSED", a as "close", "ADMIN").ok)).toEqual([false, false]);
    expect(transition("SUBMITTED", "approve", "ADMIN").ok).toBe(false);
    expect(transition("SUBMITTED", "reject", "ADMIN").ok).toBe(false);
    expect(transition("CLOSED", "reopen", "ADMIN").ok).toBe(false);
  });
});

describe("마감 전환 실패 구분", () => {
  it("역할 불일치 403, 상태 불일치 409", () => {
    const role = transition("SUBMITTED", "approve", "ADMIN") as TransitionFailure;
    expect(role.code).toBe("role");
    expect(transitionFailureStatus(role)).toBe(403);
    const state = transition("DRAFT", "submit", "MANAGER") as TransitionFailure;
    expect(state.code).toBe("state");
    expect(transitionFailureStatus(state)).toBe(409);
  });
});

describe("유틸", () => {
  it("키워드 항목 추천", () => {
    const items = [
      { id: "pm", name: "PM운영비", keywords: "운영" },
      { id: "book", name: "도서구입", keywords: "도서,책,교재" },
      { id: "sub", name: "소프트웨어구독", keywords: "구독,라이선스,saas" },
    ];
    expect(suggestItem("클린코드 도서 구매", items)?.id).toBe("book");
    expect(suggestItem("Figma 구독료", items)?.id).toBe("sub");
    expect(suggestItem("", items)).toBeNull();
  });

  it("날짜·시트명", () => {
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("2026-02-03")?.toISOString()).toBe("2026-02-03T00:00:00.000Z");
    expect(sheetName("2025-12")).toBe("25.12월");
    expect(sheetName("2026-02")).toBe("26.2월");
    // 기존 상신 양식: 시작 연도는 "12월", 이후 연도는 "26.1월"
    expect(excelSheetName("2025-12", "2025-12")).toBe("12월");
    expect(excelSheetName("2026-01", "2025-12")).toBe("26.1월");
    expect(excelSheetName("2026-11", "2025-12")).toBe("26.11월");
    expect(
      projectMonths(new Date("2025-12-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z")),
    ).toHaveLength(12);
  });
});

describe("closingStatusIn", () => {
  it("맵에 없으면 DRAFT", () => {
    const m = new Map([["2026-01", { status: "CLOSED" }]]);
    expect(closingStatusIn(m, "2026-01")).toBe("CLOSED");
    expect(closingStatusIn(m, "2026-02")).toBe("DRAFT");
  });
});

describe("시작 전 달 마감·상신 차단", () => {
  it("이번 달 이후는 마감·상신 불가, 지난 달·이번 달은 가능", () => {
    expect(futureMonthProblem("close", "2026-11", "2026-10")).toMatch(/시작하지 않은 달/);
    expect(futureMonthProblem("submit", "2027-01", "2026-10")).toMatch(/시작하지 않은 달/);
    expect(futureMonthProblem("close", "2026-10", "2026-10")).toBeNull();
    expect(futureMonthProblem("submit", "2026-09", "2026-10")).toBeNull();
  });
  it("마감 해제는 앞으로의 달이어도 가능 (이미 잘못 마감된 달 정리)", () => {
    expect(futureMonthProblem("reopen", "2026-12", "2026-10")).toBeNull();
  });
});

describe("잠긴 달 안내 문구", () => {
  it("상태별로 필요한 처리를 알려 준다", () => {
    expect(unlockHint("CLOSED")).toMatch(/PM이 마감을 해제/);
    expect(unlockHint("SUBMITTED")).toMatch(/재무 승인 담당이 반려/);
    expect(unlockHint("APPROVED")).toMatch(/재무 승인 담당이 승인을 취소/);
    expect(lockedMonthMessage("APPROVED")).toMatch(/^승인된 월의 지출은 변경할 수 없습니다\. .*승인을 취소/);
    expect(lockedMonthMessage("CLOSED")).toMatch(/^마감된 월/);
  });
  it("상태 때문에 안 되는 처리는 이유를 담는다", () => {
    expect(stateFailureReason("APPROVED", "reopen")).toBe("승인 상태에서는 마감 해제할 수 없습니다. 수정이 필요하면 재무 승인 담당이 승인을 취소해야 합니다.");
    const t = transition("SUBMITTED", "reopen", "MANAGER");
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toMatch(/상신 상태에서는 마감 해제할 수 없습니다/);
  });
});

describe("마감·상신 화면 기본 선택 달", () => {
  const rows = [
    { ym: "2026-07", status: "APPROVED" as const },
    { ym: "2026-08", status: "DRAFT" as const },
    { ym: "2026-09", status: "CLOSED" as const },
    { ym: "2026-10", status: "DRAFT" as const },
  ];
  it("PM: 반려 → 마감 → 지난 작성중 순 (각각 가장 오래된 달)", () => {
    expect(defaultClosingMonth([...rows, { ym: "2026-06", status: "REJECTED" }], "MANAGER", "2026-10")).toBe("2026-06");
    expect(defaultClosingMonth(rows, "MANAGER", "2026-10")).toBe("2026-09");
    expect(defaultClosingMonth(rows.filter((r) => r.status !== "CLOSED"), "MANAGER", "2026-10")).toBe("2026-08");
    // 처리할 달이 없으면 이번 달
    expect(defaultClosingMonth([rows[0], rows[3]], "MANAGER", "2026-10")).toBe("2026-10");
  });
  it("재무팀: 승인 대기 달 먼저 (PM 처리 대상은 보지 않음)", () => {
    expect(defaultClosingMonth([...rows, { ym: "2026-08", status: "SUBMITTED" }, { ym: "2026-05", status: "SUBMITTED" }], "HQ", "2026-10")).toBe("2026-05");
    expect(defaultClosingMonth(rows, "HQ", "2026-10")).toBe("2026-10");
  });
  it("달이 없으면 null, 이번 달이 기간 밖이면 가장 최근 달", () => {
    expect(defaultClosingMonth([], "MANAGER", "2026-10")).toBeNull();
    expect(defaultClosingMonth([rows[0]], "HQ", "2027-03")).toBe("2026-07");
  });
});
