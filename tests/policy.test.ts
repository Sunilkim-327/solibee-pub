import { describe, expect, it } from "vitest";
import { checkPolicy, dateWithWeekday, decodeFlags, encodeFlags, isUnexplained, koreanWon, needsJustification, parseFlags, type PolicyInput } from "@/lib/policy";

const base: PolicyInput = {
  amount: 40000,
  headcount: 2,
  date: new Date("2026-10-08T00:00:00Z"), // 목요일
  hasExternal: false,
  item: { name: "야근식대", accountCode: "복리후생비", perPersonLimit: 15000, perCaseLimit: null },
  remainingBefore: 100000,
  sameEntries: 0,
};
const codes = (x: Partial<PolicyInput>) => checkPolicy({ ...base, ...x }).map((f) => f.code);

describe("규정 점검", () => {
  it("1인당 한도 = 금액 ÷ 대상인원", () => {
    expect(codes({})).toEqual(["PER_PERSON"]); // 20,000 > 15,000
    expect(codes({ headcount: 3 })).toEqual([]); // 13,333
  });
  it("1인당 한도는 정수 비교: 금액 > 한도 × 인원 (반올림으로 놓치지 않음)", () => {
    expect(codes({ amount: 45_001, headcount: 3 })).toEqual(["PER_PERSON"]); // 15,000.33
    expect(codes({ amount: 45_000, headcount: 3 })).toEqual([]);
  });
  it("예산 초과 안내는 묶음 이름으로", () => {
    const f = checkPolicy({ ...base, headcount: 4, remainingBefore: 10_000, budgetName: "야근식대 묶음" });
    expect(f[0].message).toMatch(/^야근식대 묶음 예산 잔액 10,000원/);
  });
  it("1건 한도", () => {
    expect(codes({ headcount: 4, item: { ...base.item, perCaseLimit: 30000 } })).toEqual(["PER_CASE"]);
  });
  it("주말", () => {
    // 주말 사용은 점검하지 않음 (토요일)
    expect(codes({ headcount: 4, date: new Date("2026-10-10T00:00:00Z") })).toEqual([]);
  });
  it("예산 잔액 초과 (예산 없는 항목은 제외)", () => {
    expect(codes({ headcount: 4, remainingBefore: 30000 })).toEqual(["OVER_BUDGET"]);
    expect(codes({ headcount: 4, remainingBefore: null })).toEqual([]);
  });
  it("중복 의심", () => {
    expect(codes({ headcount: 4, sameEntries: 1 })).toEqual(["DUPLICATE"]);
  });
  it("거래처 참석 + 복리후생비 항목이면 계정 확인", () => {
    expect(codes({ headcount: 4, hasExternal: true })).toEqual(["ACCOUNT_CHECK"]);
    expect(codes({ headcount: 4, hasExternal: true, item: { ...base.item, accountCode: "회의비" } })).toEqual([]);
  });
});

describe("소명 필요 여부", () => {
  it("계정 확인은 안내만 — 소명 없이 저장, 다른 점검이 함께 있으면 소명 필요", () => {
    expect(needsJustification([{ code: "ACCOUNT_CHECK" }])).toBe(false);
    expect(needsJustification([{ code: "ACCOUNT_CHECK" }, { code: "PER_CASE" }])).toBe(true);
    expect(needsJustification([])).toBe(false);
  });
});

describe("표기", () => {
  it("금액 한글 병기", () => {
    expect(koreanWon(123000)).toBe("12만 3,000원");
    expect(koreanWon(150000000)).toBe("1억 5,000만원");
    expect(koreanWon(30000)).toBe("3만원");
  });
  it("금액 한글 병기 경계: 0 이하·정수 아님은 빈 문자열", () => {
    expect(koreanWon(0)).toBe("");
    expect(koreanWon(-5000)).toBe("");
    expect(koreanWon(1.5)).toBe("");
    expect(koreanWon(NaN)).toBe("");
    expect(koreanWon(9999)).toBe("9,999원");
    expect(koreanWon(100000000)).toBe("1억원");
    expect(koreanWon(3_000_000_000)).toBe("30억원");
  });
  it("요일", () => {
    expect(dateWithWeekday("2026-10-09")).toBe("10/9(금)");
    expect(dateWithWeekday("2026-10-11")).toBe("10/11(일)");
    expect(dateWithWeekday("bad")).toBe("bad");
  });
});

describe("flags 저장 형식", () => {
  it("encode/decode 왕복, 알 수 없는 코드는 버림", () => {
    const flags = checkPolicy({ ...base, sameEntries: 1 });
    expect(decodeFlags(encodeFlags(flags))).toEqual(flags.map((f) => f.code));
    expect(encodeFlags([])).toBeNull();
    // 예전에 저장된 주말 표시(WEEKEND)는 무시
    expect(parseFlags("WEEKEND,UNKNOWN, DUPLICATE")).toEqual(["DUPLICATE"]);
    expect(parseFlags(null)).toEqual([]);
  });
});

describe("소명 없는 규정 점검 (isUnexplained)", () => {
  it("소명이 필요한 점검이 있고 소명이 비었을 때만", () => {
    expect(isUnexplained({ flags: "PER_PERSON", justification: null })).toBe(true);
    expect(isUnexplained({ flags: "PER_PERSON", justification: "  " })).toBe(true);
    expect(isUnexplained({ flags: "PER_PERSON", justification: "고객 장애 대응" })).toBe(false);
    // 안내성 점검(계정 확인)만 있으면 소명 대상이 아님
    expect(isUnexplained({ flags: "ACCOUNT_CHECK", justification: null })).toBe(false);
    expect(isUnexplained({ flags: null })).toBe(false);
  });
});
