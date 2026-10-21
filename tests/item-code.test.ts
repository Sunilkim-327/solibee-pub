import { describe, expect, it } from "vitest";
import { byCode, itemCodeProblem, suggestItemCode } from "@/lib/item-code";

describe("항목 코드", () => {
  it("형식 검사", () => {
    expect(itemCodeProblem("ops-01")).toBeNull();
    expect(itemCodeProblem("OPS_01")).toBeNull();
    expect(itemCodeProblem("")).toMatch(/입력/);
    expect(itemCodeProblem("야근")).toMatch(/영문/);
    expect(itemCodeProblem("a")).toMatch(/2~40/);
  });
  it("추천: 분류 코드 + 다음 번호 (이미 쓴 번호는 건너뜀)", () => {
    expect(suggestItemCode("ops", [])).toBe("ops-01");
    expect(suggestItemCode("ops", ["ops-pm", "ops-02", "office-01"])).toBe("ops-03");
  });
  it("코드 순 정렬 (숫자 자연 순서)", () => {
    const list = [{ code: "ops-10", name: "a" }, { code: "ops-2", name: "b" }, { code: null, name: "c" }];
    expect(list.sort(byCode).map((x) => x.code)).toEqual(["ops-2", "ops-10", null]);
  });
});
