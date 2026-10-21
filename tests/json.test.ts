import { describe, expect, it } from "vitest";
import { parseStringArray } from "@/lib/json";

describe("parseStringArray", () => {
  it("JSON 문자열·배열 모두 받고, 문자열만 남긴다", () => {
    expect(parseStringArray('["a","b"]')).toEqual(["a", "b"]);
    expect(parseStringArray(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(parseStringArray('["a",2]')).toEqual(["a"]);
  });
  it("비었거나 형식이 다르면 빈 배열", () => {
    expect(parseStringArray(null)).toEqual([]);
    expect(parseStringArray(undefined)).toEqual([]);
    expect(parseStringArray("")).toEqual([]);
    expect(parseStringArray("x")).toEqual([]);
    expect(parseStringArray('{"a":1}')).toEqual([]);
  });
});
