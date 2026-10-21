import { describe, expect, it } from "vitest";
import { loginIdProblem, toLoginId } from "@/lib/loginid";

describe("toLoginId", () => {
  it("공백 제거 + 소문자", () => {
    expect(toLoginId(" Hong.GD@Company.com ")).toBe("hong.gd@company.com");
  });
  it("null·undefined는 빈 문자열", () => {
    expect(toLoginId(null)).toBe("");
    expect(toLoginId(undefined)).toBe("");
  });
});

describe("loginIdProblem", () => {
  it("정상 이메일은 null", () => {
    expect(loginIdProblem("user.name+tag@example.co.kr")).toBeNull();
  });
  it("빈 값", () => {
    expect(loginIdProblem("")).toBe("아이디(이메일)를 입력하세요.");
  });
  it("이메일 형식이 아니면 오류", () => {
    expect(loginIdProblem("user")).toContain("이메일 주소 형식");
    expect(loginIdProblem("user@host")).toContain("이메일 주소 형식");
    expect(loginIdProblem("User@Example.com")).toContain("이메일 주소 형식"); // 대문자는 toLoginId로 정규화 후 검사
  });
  it("100자 초과는 오류", () => {
    expect(loginIdProblem(`${"a".repeat(95)}@ex.com`)).toContain("이메일 주소 형식");
  });
});
