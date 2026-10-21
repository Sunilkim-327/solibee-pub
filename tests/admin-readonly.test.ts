import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {}, toNumber: Number }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const { assertWritable, ADMIN_READONLY_MESSAGE } = await import("@/lib/access");
type U = Parameters<typeof assertWritable>[0];
const base: U = { id: "u", name: "관리자", loginId: null, role: "ADMIN", mustChangePassword: false, departmentName: null, position: null };

describe("관리자 프로젝트 데이터 조회 전용 (assertWritable)", () => {
  it("관리자는 기본 차단 (403, 안내 문구)", () => {
    const u: U = { ...base, readOnly: true, readOnlyReason: "admin" };
    expect(() => assertWritable(u)).toThrow(ADMIN_READONLY_MESSAGE);
    try { assertWritable(u); } catch (e) { expect((e as { status?: number }).status).toBe(403); }
  });
  it("기준 정보 기능(allowAdmin)은 통과", () => {
    expect(() => assertWritable({ ...base, readOnly: true, readOnlyReason: "admin" }, { allowAdmin: true })).not.toThrow();
  });
  it("종료된 프로젝트는 allowAdmin이어도 차단 (closed 우선)", () => {
    expect(() => assertWritable({ ...base, readOnly: true, readOnlyReason: "closed" }, { allowAdmin: true })).toThrow(/종료된 프로젝트/);
  });
  it("상위 PM 조회(view)는 allowAdmin과 무관하게 차단", () => {
    expect(() => assertWritable({ ...base, role: "MANAGER", readOnly: true, readOnlyReason: "view" }, { allowAdmin: true })).toThrow(/조회 권한/);
  });
  it("쓰기 가능한 사용자는 통과", () => {
    expect(() => assertWritable({ ...base, role: "MANAGER" })).not.toThrow();
  });
});
