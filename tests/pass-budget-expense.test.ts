// 지출 저장 검사(buildExpenseData)에 출입증 확정분·중복 의심 반영 — 가짜 db, 가상의 값
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {}, toNumber: (v: unknown) => (v == null ? 0 : Number(v)) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

import { buildExpenseData } from "@/lib/expenses";
import type { SessionUser } from "@/lib/access";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const project = { id: "p", startDate: d("2026-01-01"), endDate: d("2026-12-31") };
const member = { id: "m1", role: "MEMBER", name: "팀원" } as unknown as SessionUser;
const pm = { id: "pm", role: "MANAGER", name: "PM" } as unknown as SessionUser;
const item = { id: "night", projectId: "p", active: true, name: "야근 식대", hardBudget: true, needsAttendees: false, perPersonLimit: null, perCaseLimit: null, accountCode: null, categoryId: "food" };

/** card: 카드 지출 합계, pass: 출입증 확정분 합계, dup: 같은 날 출입증 회사 부담 줄 수 */
function fakeDb(o: { card: number; pass: number; dup?: number; hard?: boolean }) {
  const calls: Record<string, unknown[]> = { passAgg: [], passCount: [] };
  const db = {
    monthlyClosing: { findUnique: async () => null, findFirst: async () => null },
    item: { findUnique: async () => ({ ...item, hardBudget: o.hard ?? true }) },
    expense: { findUnique: async () => null, aggregate: async () => ({ _sum: { amount: o.card } }), count: async () => 0 },
    budgetLine: { findMany: async () => [{ itemId: "night", planned: 1_000_000, bundleItemIds: null }] },
    memberItem: { findMany: async () => [{ itemId: "night" }] },
    contractChange: { findMany: async () => [] },
    passStatementLine: {
      // 확정분은 줄을 읽어 하루 한도 배분 뒤 합산한다 (lib/pass-statement companySplit) — 여기서는 한도 없는 항목 한 줄
      findMany: async (a: unknown) => {
        calls.passAgg.push(a);
        return o.pass ? [{ id: "pl1", userId: "u9", date: new Date("2026-02-01T00:00:00Z"), amount: o.pass, decision: "OVERTIME", memberClaim: null, usageItemId: "pass-night", time: null, usageItem: { id: "pass-night", name: "야근식대(출입증)", perPersonLimit: null } }] : [];
      },
      count: async (a: unknown) => { calls.passCount.push(a); return o.dup ?? 0; },
    },
  };
  return { db: db as never, calls };
}
const input = { date: "2026-03-05", amount: 50_000, itemId: "night", detail: "야근 식사", headcount: 1, attendees: "팀원" };
// 팀원 입력 기한(다음 달 3일) 안의 오늘 — 이 테스트는 예산·출입증 검사만 본다
const today = "2026-03-20";

describe("하드 예산 — 하나의 예산 (카드 + 출입증 확정분)", () => {
  it("출입증 확정분으로 잔액이 모자라면 카드 입력도 막는다 (팀원에게는 금액 없이)", async () => {
    const { db, calls } = fakeDb({ card: 900_000, pass: 80_000 });
    await expect(buildExpenseData(member, project, input, { db, today })).rejects.toThrow("PM에게 요청");
    await expect(buildExpenseData(member, project, input, { db, today })).rejects.not.toThrow(/\d{2},\d{3}/);
    // 확정 명세의 회사 부담 결정 + 이 예산(묶음)에 연결된 항목만
    expect(calls.passAgg[0]).toMatchObject({
      where: { decision: "OVERTIME", statement: { projectId: "p", status: "CONFIRMED" }, usageItem: { is: { linkedItemId: { in: ["night"] } } } },
    });
  });
  it("PM에게는 남은 잔액(카드 + 출입증 뺀 금액)을 알린다", async () => {
    const { db } = fakeDb({ card: 900_000, pass: 80_000 });
    await expect(buildExpenseData(pm, project, { ...input, payMethod: "PERSONAL_CARD" }, { db, today })).rejects.toThrow("잔액 20,000원");
  });
  it("출입증을 빼면 들어갈 금액이면 저장 데이터", async () => {
    const { db } = fakeDb({ card: 900_000, pass: 0 });
    const r = await buildExpenseData(member, project, input, { db, today });
    expect(r.flags).toBeNull();
  });
  it("하드 예산이 아니면 예산 잔액 초과 점검(소명)으로", async () => {
    const { db } = fakeDb({ card: 900_000, pass: 80_000, hard: false });
    await expect(buildExpenseData(member, project, input, { db, today })).rejects.toMatchObject({ status: 422 });
    const r = await buildExpenseData(member, project, { ...input, justification: "야근 인원 증가" }, { db, today });
    expect(r.flags).toBe("OVER_BUDGET");
  });
});

describe("출입증 중복 의심 — 저장할 때도 같은 기준 (소명이 남도록)", () => {
  it("같은 날 이 항목에 연결된 출입증 회사 부담이 있으면 소명 필요", async () => {
    const { db, calls } = fakeDb({ card: 0, pass: 0, dup: 1 });
    await expect(buildExpenseData(member, project, input, { db, today })).rejects.toMatchObject({ status: 422 });
    const r = await buildExpenseData(member, project, { ...input, justification: "점심 카드, 저녁 출입증" }, { db, today });
    expect(r.flags).toBe("PASS_DUP");
    expect(r.justification).toBe("점심 카드, 저녁 출입증");
    expect(calls.passCount[0]).toMatchObject({
      where: { userId: "m1", date: d("2026-03-05"), onBehalfName: null, statement: { projectId: "p" }, usageItem: { is: { linkedItemId: "night" } } },
    });
  });
});
