import { describe, expect, it } from "vitest";
import { digits as budgetDigits } from "@/components/budget/model";
import { digits as masterDigits } from "@/components/master/model";

describe("화면 숫자 입력 도우미", () => {
  it("예산 단가: 숫자만, 13자리까지 (21억 초과 허용), 비면 0", () => {
    expect(budgetDigits("3,000,000,000원")).toBe(3_000_000_000);
    expect(budgetDigits("12345678901234567")).toBe(1_234_567_890_123);
    expect(budgetDigits("")).toBe(0);
    expect(budgetDigits("abc")).toBe(0);
  });
  it("마스터 한도: 숫자 문자열, 9자리까지", () => {
    expect(masterDigits("1,234,567,890,1")).toBe("123456789");
    expect(masterDigits("가")).toBe("");
  });
});
