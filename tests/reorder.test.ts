import { describe, expect, it } from "vitest";
import { isMove, moveInList, orderUpdates } from "@/lib/reorder";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
const ids = (l: { id: string }[] | null) => l?.map((x) => x.id) ?? null;

describe("순서 이동", () => {
  it("이웃과 바꾼다", () => {
    expect(ids(moveInList(list, "b", "up"))).toEqual(["b", "a", "c"]);
    expect(ids(moveInList(list, "b", "down"))).toEqual(["a", "c", "b"]);
    expect(ids(list)).toEqual(["a", "b", "c"]); // 원본 불변
  });
  it("끝이거나 없는 id면 null", () => {
    expect(moveInList(list, "a", "up")).toBeNull();
    expect(moveInList(list, "c", "down")).toBeNull();
    expect(moveInList(list, "x", "up")).toBeNull();
  });
  it("값 확인", () => {
    expect(isMove("up")).toBe(true);
    expect(isMove("left")).toBe(false);
  });
  it("순서 값이 바뀌는 행만 저장 대상", () => {
    const rows = [{ id: "a", order: 0 }, { id: "b", order: 1 }, { id: "c", order: 2 }];
    expect(orderUpdates(moveInList(rows, "b", "up")!)).toEqual([{ id: "b", order: 0 }, { id: "a", order: 1 }]);
    // 순서 값이 비어 있거나 겹치면 0..n으로 다시 매긴다
    const messy = [{ id: "a", order: 0 }, { id: "b", order: 0 }, { id: "c", order: 5 }];
    expect(orderUpdates(moveInList(messy, "c", "up")!)).toEqual([{ id: "c", order: 1 }, { id: "b", order: 2 }]);
  });
});

describe("화면 목록을 서버 순서로 맞추기", () => {
  it("해당 항목들의 자리 안에서만 서버 순서로 바꾼다", async () => {
    const { applyOrder } = await import("@/components/budget/model");
    const list = [{ id: "x" }, { id: "a" }, { id: "y" }, { id: "b" }, { id: "c" }];
    expect(applyOrder(list, ["c", "a", "b"]).map((i) => i.id)).toEqual(["x", "c", "y", "a", "b"]);
  });
});
