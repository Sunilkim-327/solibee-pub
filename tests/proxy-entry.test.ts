import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {}, toNumber: Number }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

import { resolveProxyPayer } from "@/lib/expenses";
import type { SessionUser } from "@/lib/access";

const pm = { id: "pm", role: "MANAGER", name: "PM" } as unknown as SessionUser;
const member = { id: "m1", role: "MEMBER", name: "팀원" } as unknown as SessionUser;

/** projectMember.findUnique 결과를 돌려주는 가짜 db */
const dbWith = (row: unknown) => ({ projectMember: { findUnique: async () => row } }) as never;
const ok = { leftAt: null, isPayer: true, user: { active: true, name: "이서준" } };

describe("대리 입력 결제자 확인", () => {
  it("결제자를 지정하지 않거나 본인이면 본인 입력", async () => {
    expect(await resolveProxyPayer(pm, "p", undefined, "2026-10-12", dbWith(null))).toBeNull();
    expect(await resolveProxyPayer(pm, "p", "pm", "2026-10-12", dbWith(null))).toBeNull();
  });

  it("PM은 결제자 목록의 현재 구성원을 지정할 수 있다", async () => {
    expect(await resolveProxyPayer(pm, "p", "m1", "2026-10-12", dbWith(ok))).toBe("m1");
  });

  it("팀원은 다른 사람 대신 입력할 수 없다", async () => {
    await expect(resolveProxyPayer(member, "p", "pm", "2026-10-12", dbWith(ok))).rejects.toThrow("PM만");
  });

  it("조회 전용 PM은 대리 입력할 수 없다", async () => {
    await expect(resolveProxyPayer({ ...pm, readOnly: true } as SessionUser, "p", "m1", "2026-10-12", dbWith(ok))).rejects.toThrow("PM만");
  });

  it("구성원이 아니거나 결제자가 아니거나 비활성이면 거절", async () => {
    await expect(resolveProxyPayer(pm, "p", "x", "2026-10-12", dbWith(null))).rejects.toThrow("팀원");
    await expect(resolveProxyPayer(pm, "p", "m1", "2026-10-12", dbWith({ ...ok, isPayer: false }))).rejects.toThrow("팀원");
    await expect(resolveProxyPayer(pm, "p", "m1", "2026-10-12", dbWith({ ...ok, user: { active: false, name: "x" } }))).rejects.toThrow("팀원");
  });

  it("철수일 이후 날짜는 거절", async () => {
    const left = { ...ok, leftAt: new Date("2026-09-30T00:00:00Z") };
    await expect(resolveProxyPayer(pm, "p", "m1", "2026-10-12", dbWith(left))).rejects.toThrow("이전 팀원으로 처리");
    expect(await resolveProxyPayer(pm, "p", "m1", "2026-09-30", dbWith(left))).toBe("m1");
  });
});
