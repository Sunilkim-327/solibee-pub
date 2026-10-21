import { describe, expect, it } from "vitest";
import { INPUT_DEADLINE_DAY, daysToDeadline, inputDeadline, inputDeadlineLabel, inputDeadlineProblem, inputOpen, monthPhase } from "@/lib/month-phase";

describe("월 단계 — 입력 기한 다음 달 3일 (2026-10-15 결정)", () => {
  it("기본 기한은 다음 달 3일, 0이면 그 달 말일, 다음 달이 짧으면 그 달 말일", () => {
    expect(INPUT_DEADLINE_DAY).toBe(3);
    expect(inputDeadline("2026-09")).toBe("2026-10-03");
    expect(inputDeadline("2026-12")).toBe("2027-01-03");
    expect(inputDeadline("2026-09", 0)).toBe("2026-09-30");
    expect(inputDeadline("2026-01", 31)).toBe("2026-02-28");
    expect(inputDeadlineLabel("2026-09")).toBe("10월 3일");
  });
  it("기한 전이면 입력 가능, 기한 당일까지 가능, 다음 날부터 불가, 미래 달은 불가", () => {
    expect(inputOpen("2026-09", "2026-09-15")).toBe(true);
    expect(inputOpen("2026-09", "2026-10-03")).toBe(true);
    expect(inputOpen("2026-09", "2026-10-04")).toBe(false);
    expect(inputOpen("2026-11", "2026-10-15")).toBe(false);
    expect(daysToDeadline("2026-10", "2026-10-15")).toBe(19);
    expect(daysToDeadline("2026-09", "2026-10-15")).toBe(-12);
  });
  it("10월 15일에 보면 9월은 마감 대기, 10월은 작성중, 11월은 예정 — 마감 상태가 있으면 그대로", () => {
    const today = "2026-10-15";
    expect(monthPhase("2026-09", "DRAFT", today)).toBe("PENDING_CLOSE");
    expect(monthPhase("2026-09", null, today)).toBe("PENDING_CLOSE");
    expect(monthPhase("2026-10", undefined, today)).toBe("DRAFT");
    expect(monthPhase("2026-11", "DRAFT", today)).toBe("FUTURE");
    expect(monthPhase("2026-09", "CLOSED", today)).toBe("CLOSED");
    expect(monthPhase("2026-08", "SUBMITTED", today)).toBe("SUBMITTED");
    expect(monthPhase("2026-07", "APPROVED", today)).toBe("APPROVED");
    // 반려는 PM이 고치는 중 — 기한과 무관
    expect(monthPhase("2026-08", "REJECTED", today)).toBe("REJECTED");
    // 10월 3일까지는 9월도 작성중
    expect(monthPhase("2026-09", "DRAFT", "2026-10-03")).toBe("DRAFT");
  });
  it("기한 문구: 지나면 달·기한·다음 행동, 아니면 null, 미래 달은 따로", () => {
    expect(inputDeadlineProblem("2026-09", "2026-10-15")).toBe("9월 입력 기한(10월 3일)이 지났어요. 추가·수정할 건은 PM에게 요청하세요.");
    expect(inputDeadlineProblem("2026-10", "2026-10-15")).toBeNull();
    expect(inputDeadlineProblem("2026-11", "2026-10-15")).toBe("아직 오지 않은 달이에요.");
  });
});
