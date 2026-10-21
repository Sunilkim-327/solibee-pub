import { describe, expect, it } from "vitest";
import { summarizePass } from "@/lib/pass";

describe("업체 출입증 사용", () => {
  it("월 집계 — 항목별 합계(사용처 내역)·사용자별", () => {
    const s = summarizePass([
      { userId: "a", userName: "가", itemId: "m", itemName: "야근식대", amount: 8000, placeType: "식당" },
      { userId: "a", userName: "가", itemId: "m", itemName: "야근식대", amount: 3000, placeType: "카페" },
      { userId: "b", userName: "나", itemId: "m", itemName: "야근식대", amount: 9000, placeType: "식당" },
      { userId: "b", userName: "나", itemId: "s", itemName: "간식비", amount: 2500, placeType: "편의점" },
    ]);
    expect(s.total).toBe(22500);
    expect(s.count).toBe(4);
    expect(s.byItem.map((i) => [i.name, i.amount, i.count])).toEqual([["야근식대", 20000, 3], ["간식비", 2500, 1]]);
    expect(s.byItem[0].places).toEqual([{ placeType: "식당", amount: 17000 }, { placeType: "카페", amount: 3000 }]);
    expect(s.byUser.map((u) => [u.name, u.amount])).toEqual([["나", 11500], ["가", 11000]]);
  });
});
