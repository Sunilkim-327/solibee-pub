import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import { optInt, str, strArray } from "@/lib/validate";

const err = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.message}` : "other";
  }
  return null;
};

describe("입력 검증", () => {
  it("str: 공백 제거·빈 값 null·길이·타입", () => {
    expect(str(undefined, "이름", 10)).toBeUndefined();
    expect(str("  가나 ", "이름", 10)).toBe("가나");
    expect(str("   ", "이름", 10)).toBeNull();
    expect(str(null, "이름", 10)).toBeNull();
    expect(err(() => str("a".repeat(11), "이름", 10))).toMatch(/^400 .*10자/);
    expect(err(() => str(5, "이름", 10))).toMatch(/^400/);
    expect(err(() => str("", "이름", 10, { required: "이름을 입력하세요." }))).toBe("400 이름을 입력하세요.");
    expect(err(() => str(undefined, "이름", 10, { required: true }))).toMatch(/^400/);
  });

  it("strArray: 문자열 배열만, 중복 제거, 개수 제한", () => {
    expect(strArray(undefined, "구성원", 3)).toEqual([]);
    expect(strArray(["a", "a", "b"], "구성원", 3)).toEqual(["a", "b"]);
    expect(err(() => strArray("a", "구성원", 3))).toMatch(/^400/);
    expect(err(() => strArray(["a", 1], "구성원", 3))).toMatch(/^400/);
    expect(err(() => strArray(["a", "b", "c", "d"], "구성원", 3))).toMatch(/^400 .*3개/);
  });

  it("optInt", () => {
    expect(optInt(undefined, "한도")).toBeUndefined();
    expect(optInt(null, "한도")).toBeNull();
    expect(optInt("", "한도")).toBeNull();
    expect(optInt("12,000", "한도")).toBe(12000);
    expect(err(() => optInt(1.5, "한도"))).toMatch(/^400/);
    expect(err(() => optInt(-1, "한도", { min: 0 }))).toMatch(/^400 .*0 이상/);
  });
});
