import { describe, expect, it } from "vitest";
import { orderPayers } from "@/lib/settlement-range";

describe("orderPayers", () => {
  const master = [{ id: "a", name: "김부장" }, { id: "b", name: "이대리" }];
  const names = new Map([["x", "홍길동"], ["y", "강감찬"]]);

  it("마스터 순서 유지, 마스터에 없는 결제자는 뒤에 이름순", () => {
    expect(orderPayers(master, ["x", "b", "y", "a", "x"], (id) => names.get(id)).map((p) => p.id)).toEqual(["a", "b", "y", "x"]);
  });
  it("이름을 모르면 id로", () => {
    expect(orderPayers([], ["z"], () => undefined)).toEqual([{ id: "z", name: "z" }]);
  });
});
