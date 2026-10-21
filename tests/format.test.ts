import { describe, expect, it } from "vitest";
import {
  addMonths, currentYearMonth, digitsOnly, excelSheetName, formatPeriod, isYearMonth, localYmd, pad2, parseDateOnly, parseIntInput, parseWonInput, projectMonths,
  seoulToday, seoulTodayDate, seoulYm, toYearMonth, todayString, won, dayLabel, shortDate, ymKo, dash0, dotDate, kstDateTime, shortDateTime, ymShort,
} from "@/lib/format";

describe("won", () => {
  it("천 단위 콤마", () => {
    expect(won(0)).toBe("0");
    expect(won(1234567)).toBe("1,234,567");
    expect(won(-12000)).toBe("-12,000");
  });
});

describe("localYmd", () => {
  it("로컬 날짜를 YYYY-MM-DD로", () => {
    expect(localYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localYmd(new Date(2025, 11, 31, 23, 59))).toBe("2025-12-31");
  });
});

describe("addMonths", () => {
  it("연도 경계를 넘는다", () => {
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-03", 12)).toBe("2027-03");
    expect(addMonths("2026-03", 0)).toBe("2026-03");
  });
});

describe("projectMonths", () => {
  it("시작월~종료월 포함", () => {
    expect(projectMonths(new Date("2025-11-15T00:00:00Z"), new Date("2026-02-01T00:00:00Z"))).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("같은 달이면 한 개", () => {
    expect(projectMonths(new Date("2026-05-01T00:00:00Z"), new Date("2026-05-31T00:00:00Z"))).toEqual(["2026-05"]);
  });
  it("종료가 시작보다 이르면 빈 목록", () => {
    expect(projectMonths(new Date("2026-05-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z"))).toEqual([]);
  });
  it("최대 120개월", () => {
    expect(projectMonths(new Date("2000-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"))).toHaveLength(120);
  });
});

describe("excelSheetName", () => {
  it("시작 연도는 월만, 이후 연도는 연도 두 자리 붙임", () => {
    expect(excelSheetName("2025-12", "2025-12")).toBe("12월");
    expect(excelSheetName("2026-01", "2025-12")).toBe("26.1월");
    expect(excelSheetName("2026-11", "2025-12")).toBe("26.11월");
  });
});

describe("parseDateOnly", () => {
  it("유효한 날짜는 UTC 자정", () => {
    expect(parseDateOnly("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
  it("형식 오류·존재하지 않는 날짜는 null", () => {
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("2026-2-1")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
    expect(parseDateOnly(20260201)).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
  });
});

describe("formatPeriod", () => {
  it("YYYY.MM.DD ~ YYYY.MM.DD", () => {
    expect(formatPeriod(new Date("2025-12-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z"))).toBe("2025.12.01 ~ 2026.11.30");
    expect(formatPeriod("2025-12-01", "2026-11-30")).toBe("2025.12.01 ~ 2026.11.30");
  });
});

describe("한국 시간 기준 오늘·이번 달", () => {
  it("UTC 23:30 월말 = 한국 다음 달 1일", () => {
    const t = new Date("2026-01-31T23:30:00Z");
    expect(seoulToday(t)).toBe("2026-02-01");
    expect(seoulYm(t)).toBe("2026-02");
    expect(currentYearMonth(t)).toBe("2026-02");
    expect(todayString(t)).toBe("2026-02-01");
    expect(seoulTodayDate(t).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
  it("한국 자정 직전은 같은 날", () => {
    const t = new Date("2026-12-31T14:59:00Z"); // 한국 23:59
    expect(seoulToday(t)).toBe("2026-12-31");
    expect(seoulYm(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01");
  });
});

describe("숫자 입력", () => {
  it("pad2", () => {
    expect(pad2(3)).toBe("03");
    expect(pad2(12)).toBe("12");
  });
  it("parseIntInput: 비면 null, 정수 아니면 NaN, 쉼표 허용", () => {
    expect(parseIntInput("")).toBeNull();
    expect(parseIntInput(null)).toBeNull();
    expect(parseIntInput("12,000")).toBe(12000);
    expect(parseIntInput(5)).toBe(5);
    expect(parseIntInput("1.5")).toBeNaN();
    expect(parseIntInput("abc")).toBeNaN();
  });
  it("digitsOnly·parseWonInput", () => {
    expect(digitsOnly("₩12,345원")).toBe("12345");
    expect(digitsOnly("123456", 3)).toBe("123");
    expect(parseWonInput("12,000")).toBe(12000);
    expect(parseWonInput("")).toBe(0);
  });
});

describe("yearMonth", () => {
  it("isYearMonth", () => {
    expect(isYearMonth("2026-02")).toBe(true);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth("2026-2")).toBe(false);
    expect(isYearMonth(202602)).toBe(false);
  });
  it("toYearMonth (UTC 기준 저장 일자)", () => {
    expect(toYearMonth(new Date("2026-02-28T00:00:00Z"))).toBe("2026-02");
  });
});

describe("화면 표기 함수", () => {
  it("dayLabel: 10월 6일 (화)", () => {
    expect(dayLabel("2026-10-06")).toBe("10월 6일 (화)");
    expect(dayLabel("2026-01-01")).toBe("1월 1일 (목)");
    expect(dayLabel(new Date("2026-10-11T00:00:00.000Z"))).toBe("10월 11일 (일)");
  });
  it("shortDate: 10.06 (화)", () => {
    expect(shortDate("2026-10-06")).toBe("10.06 (화)");
    expect(shortDate("2025-12-31")).toBe("12.31 (수)");
    expect(shortDate(new Date("2026-10-11T00:00:00.000Z"))).toBe("10.11 (일)");
  });
  it("ymKo: 2026년 10월", () => {
    expect(ymKo("2026-10")).toBe("2026년 10월");
    expect(ymKo("2026-02")).toBe("2026년 2월");
  });
  it("dash0: 0은 -", () => {
    expect(dash0(0)).toBe("-");
    expect(dash0(15300)).toBe("15,300");
    expect(dash0(-1200)).toBe("-1,200");
  });
});

describe("dotDate·kstDateTime", () => {
  it("점 날짜", () => {
    expect(dotDate("2026-10-06")).toBe("2026.10.06");
    expect(dotDate("2026-10-06T00:00:00.000Z")).toBe("2026.10.06");
    expect(dotDate(new Date("2026-01-02T00:00:00.000Z"))).toBe("2026.01.02");
  });
  it("한국 시간 일시 — 날짜가 넘어가는 경우", () => {
    expect(kstDateTime("2026-10-06T16:05:00.000Z")).toBe("2026.10.07 01:05");
    expect(kstDateTime(new Date("2026-10-06T05:30:00.000Z"))).toBe("2026.10.06 14:30");
  });
  it("좁은 칸 일시 — 연도 없이 한국 시간", () => {
    expect(shortDateTime("2026-10-05T09:00:00.000Z")).toBe("10.05 18:00");
    expect(shortDateTime("2026-12-31T15:30:00.000Z")).toBe("01.01 00:30");
    expect(shortDateTime(new Date("2026-10-06T05:30:00.000Z"))).toBe("10.06 14:30");
  });
});

describe("ymShort", () => {
  it("연도 두 자리 + 월", () => {
    expect(ymShort("2026-08")).toBe("26년 8월");
    expect(ymShort("2025-12")).toBe("25년 12월");
  });
});

describe("monthsLabel", () => {
  it("이어진 달은 범위, 떨어진 달은 ·로", async () => {
    const { monthsLabel } = await import("@/lib/format");
    expect(monthsLabel(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"])).toBe("1~9월");
    expect(monthsLabel(["2026-03", "2026-01"])).toBe("1월·3월");
    expect(monthsLabel(["2025-12", "2026-01", "2026-03"])).toBe("25년 12월~26년 1월·26년 3월");
    expect(monthsLabel([])).toBe("");
  });
});
