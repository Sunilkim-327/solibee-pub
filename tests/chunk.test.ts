import { describe, expect, it } from "vitest";
import { chunkIds, ID_CHUNK } from "@/lib/chunk";

describe("chunkIds — D1 바인딩 한도(100)에 맞춰 id 목록 나누기", () => {
  it("빈 목록은 빈 배열 (쿼리를 만들지 않는다)", () => {
    expect(chunkIds([])).toEqual([]);
  });
  it("한도 이하는 한 묶음", () => {
    const ids = Array.from({ length: ID_CHUNK }, (_, i) => `l${i}`);
    expect(chunkIds(ids)).toEqual([ids]);
  });
  it("한도를 넘으면 90개씩, 끝 묶음은 나머지 — 모든 id가 한 번씩", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `l${i}`);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([90, 90, 70]);
    expect(chunks.flat()).toEqual(ids);
    expect(chunks.every((c) => c.length < 100)).toBe(true);
  });
});
