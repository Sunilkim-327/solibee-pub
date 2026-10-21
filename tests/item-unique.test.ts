// 항목 이름·코드 중복 — DB 유니크 위반(P2002) → 409 매핑 (설계 검토(2026-10-14) P1-8), 순수 함수
import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import { itemCodeDupMessage, itemNameDupMessage, itemUniqueError, withItemUnique } from "@/lib/item-unique";

const p2002 = (target: unknown) => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });

describe("itemUniqueError", () => {
  it("이름 유니크 위반 → 409 '이미 같은 이름의 항목이 있습니다: ○○'", () => {
    const e = itemUniqueError(p2002(["projectId", "name"]), { name: "야근식대", code: "ops-01" });
    expect(e).toBeInstanceOf(HttpError);
    expect(e!.status).toBe(409);
    expect(e!.message).toBe(itemNameDupMessage("야근식대"));
    expect(e!.message).toBe("이미 같은 이름의 항목이 있습니다: 야근식대");
  });

  it("코드 유니크 위반 → 409 '이미 같은 코드의 항목이 있습니다: ○○' (target이 문자열이어도)", () => {
    expect(itemUniqueError(p2002(["projectId", "code"]), { name: "야근식대", code: "ops-01" })!.message).toBe(itemCodeDupMessage("ops-01"));
    expect(itemUniqueError(p2002("Item_projectId_code_key"), { name: "야근식대", code: "ops-01" })!.message).toBe("이미 같은 코드의 항목이 있습니다: ops-01");
  });

  it("수정에서 이름만 바꾼 경우(code undefined) 대상 열을 몰라도 이름으로 안내", () => {
    expect(itemUniqueError(p2002(undefined), { name: "야근식대" })!.message).toBe(itemNameDupMessage("야근식대"));
  });

  it("P2002가 아닌 오류는 null (그대로 던진다)", () => {
    expect(itemUniqueError(Object.assign(new Error("x"), { code: "P2025" }), { name: "a" })).toBeNull();
    expect(itemUniqueError(new Error("x"), { name: "a" })).toBeNull();
    expect(itemUniqueError(null, { name: "a" })).toBeNull();
  });

  it("withItemUnique: P2002는 HttpError 409로, 다른 오류는 그대로", async () => {
    await expect(withItemUnique({ name: "a" }, async () => { throw p2002(["projectId", "name"]); })).rejects.toMatchObject({ status: 409, message: itemNameDupMessage("a") });
    const other = new Error("boom");
    await expect(withItemUnique({ name: "a" }, async () => { throw other; })).rejects.toBe(other);
    await expect(withItemUnique({ name: "a" }, async () => 1)).resolves.toBe(1);
  });
});
