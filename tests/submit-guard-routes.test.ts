// 상신 가드·승인 가드·반려 사유 보존 — 실제 라우트 (tests/snapshot-routes.test.ts 양식: e2e.db를 임시 파일로 복사해 가상의 프로젝트·사람을 넣고 호출)
// 설계 검토(2026-10-14) P0-1·P0-3
// - preflight: 출입증 확정 전(PASS_OPEN)·소명 없음(UNEXPLAINED) 나열, 체크리스트의 출입증 항목
// - submit: 사유 없으면 409 SUBMIT_BLOCKED, 짧으면 400, 사유를 적으면 200 + submitOverride·submitNote 저장 + 감사 기록
// - approve: 소명 없는 건이 있으면 사유 없이는 409 APPROVE_BLOCKED
// - reject 뒤 close: 반려 사유가 lastReviewNote로 남는다
// e2e.db·dev.db는 바꾸지 않는다. e2e.db가 없으면 건너뛴다.
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-guard-${process.pid}-${Date.now()}.db`);
if (has) {
  const src = new DatabaseSync(SRC, { readOnly: true });
  src.exec(`VACUUM INTO '${TMP.replace(/'/g, "''")}'`);
  src.close();
  process.env.DATABASE_URL = `file:${TMP.split(path.sep).join("/")}`;
}

let token: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "opex_session" && token ? { value: token } : undefined) }),
  headers: async () => new Headers(),
}));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ids = { pm: "", hq: "", project: "", item: "", expense: "", closing: "" };
let closingRoute: { POST: Handler };
let preflightRoute: { GET: Handler };
let reviewRoute: { POST: Handler };
let as: (userId: string) => void;
let db: typeof import("@/lib/db").prisma;

const YM = "2026-04";
const json = async (h: Handler, params: Record<string, string>, init: RequestInit = {}) => {
  const res = await h(new Request("http://localhost/api", { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};
const post = (action: string, body?: unknown) => json(closingRoute.POST, { id: ids.project, ym: YM, action }, { method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const REASON = "업체 출입증 내역이 다음 주에 도착해 5월 내역에 합산 예정";

beforeAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  db = prisma;
  const { createSessionToken } = await import("@/lib/session");
  as = (userId: string) => { token = createSessionToken(userId, 0); };
  const user = (name: string, role: string, position: string) => prisma.user.create({ data: { name, role, position, passwordHash: "x", loginId: `${name}-${Date.now()}@test.local` } });
  const [pm, hq] = await Promise.all([user("가상PM가드", "MANAGER", "팀장"), user("가상재무가드", "HQ", "책임")]);
  // 출입증을 쓰는 프로젝트 — 그 달 업체 내역은 올렸지만 확정 전(OPEN)
  const project = await prisma.project.create({ data: { name: "가상 상신 가드", startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), fiscalStart: 1, clientPassEnabled: true, clientPassName: "가상 출입증" } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: pm.id, isPm: true, isPayer: true } });
  const cat = await prisma.category.findFirstOrThrow({ where: { id: { not: "client-pass" } }, orderBy: { order: "asc" } });
  const item = await prisma.item.create({ data: { projectId: project.id, categoryId: cat.id, name: "가상 야근식대", code: "guard-01", needsAttendees: false, perPersonLimit: 10_000 } });
  await prisma.budgetLine.create({ data: { projectId: project.id, itemId: item.id, detail: "가상", unitPrice: 100_000, periods: 12, planned: 1_200_000 } });
  // 규정 점검(1인 한도 초과)에 걸렸는데 소명이 없는 지출
  const e = await prisma.expense.create({
    data: { projectId: project.id, payerId: pm.id, date: new Date("2026-04-10T00:00:00Z"), amount: 12_000, payMethod: "PERSONAL_CARD", itemId: item.id, detail: "가상 지출", yearMonth: YM, createdBy: pm.id, flags: "PER_PERSON", justification: null },
  });
  await prisma.passStatement.create({ data: { projectId: project.id, yearMonth: YM, fileName: "가상.xlsx", uploadedBy: pm.id, status: "OPEN" } });
  Object.assign(ids, { pm: pm.id, hq: hq.id, project: project.id, item: item.id, expense: e.id });
  closingRoute = await import("@/app/api/projects/[id]/closings/[ym]/[action]/route") as unknown as typeof closingRoute;
  preflightRoute = await import("@/app/api/projects/[id]/closings/[ym]/preflight/route") as unknown as typeof preflightRoute;
  reviewRoute = await import("@/app/api/closings/[id]/review/route") as unknown as typeof reviewRoute;
}, 60_000);

afterAll(async () => {
  if (!has) return;
  await db.$disconnect();
  rmSync(TMP, { force: true });
});

describe.skipIf(!has)("상신 가드 — API", () => {
  it("마감 뒤 preflight: 출입증 확정 전·소명 없음이 나열되고(사유로 넘길 수 있음), 체크리스트 출입증 항목은 확정 전", async () => {
    as(ids.pm);
    const closed = await post("close");
    expect(closed.status).toBe(200);
    ids.closing = closed.body!.id as string;
    const pre = await json(preflightRoute.GET, { id: ids.project, ym: YM });
    expect(pre.status).toBe(200);
    const blockers = pre.body!.blockers as { code: string; message: string }[];
    expect(blockers.map((b) => b.code)).toEqual(["PASS_OPEN", "UNEXPLAINED"]);
    expect(blockers[0].message).toContain("4월 출입증 확정 전");
    expect(pre.body).toMatchObject({ overridable: true, reasonMin: 10, reasonMax: 300 });
    const checks = pre.body!.checks as { key: string; ok: boolean; label: string }[];
    expect(checks.find((c) => c.key === "pass")).toMatchObject({ ok: false, label: "출입증 확정 전" });
    expect(checks.find((c) => c.key === "flags")).toMatchObject({ ok: false, label: "규정 점검 1건" });
  });

  it("사유 없이 상신 → 409 SUBMIT_BLOCKED(blockers·hint), 짧은 사유 → 400, 사유를 적으면 상신되고 submitOverride·submitNote·감사 기록이 남는다", async () => {
    as(ids.pm);
    const blocked = await post("submit");
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: "SUBMIT_BLOCKED", overridable: true, hint: "사유를 적으면 그대로 상신할 수 있습니다" });
    expect((blocked.body!.blockers as { code: string }[]).map((b) => b.code)).toEqual(["PASS_OPEN", "UNEXPLAINED"]);
    expect((await post("submit", { overrideReason: "짧음" })).status).toBe(400);
    expect((await post("submit", { overrideReason: "x".repeat(301) })).status).toBe(400);

    const ok = await post("submit", { overrideReason: REASON, note: "반려 후 영수증 보완" });
    expect(ok.status).toBe(200);
    expect(ok.body?.status).toBe("SUBMITTED");
    expect(ok.body?.submitNote).toBe("반려 후 영수증 보완");
    const row = await db.monthlyClosing.findUniqueOrThrow({ where: { id: ids.closing } });
    expect(JSON.parse(row.submitOverride!)).toMatchObject({ reason: REASON, blockers: ["PASS_OPEN", "UNEXPLAINED"] });
    expect(row.submitNote).toBe("반려 후 영수증 보완");
    const log = await db.auditLog.findFirst({ where: { entity: "MonthlyClosing", entityId: ids.closing, action: "submit" }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(log!.data!)).toMatchObject({ from: "CLOSED", to: "SUBMITTED", blockers: ["PASS_OPEN", "UNEXPLAINED"], overrideReason: REASON, note: "반려 후 영수증 보완" });
  }, 30_000); // 상신은 승인본 엑셀 스냅샷까지 만들어 전체 테스트와 함께 돌면 5초를 넘긴다

  it("승인: 소명 없는 건이 있으면 사유 없이는 409 APPROVE_BLOCKED, 반려하면 사유가 저장된다", async () => {
    as(ids.hq);
    const blocked = await json(reviewRoute.POST, { id: ids.closing }, { method: "POST", body: JSON.stringify({ decision: "approve", note: "" }) });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: "APPROVE_BLOCKED", unexplained: 1 });
    const rejected = await json(reviewRoute.POST, { id: ids.closing }, { method: "POST", body: JSON.stringify({ decision: "reject", note: "한도 초과 소명을 받으세요" }) });
    expect(rejected.status).toBe(200);
    expect(rejected.body?.reviewNote).toBe("한도 초과 소명을 받으세요");
  });

  it("반려 뒤 재마감: 반려 사유가 lastReviewNote로 남고 reviewNote는 비워진다. 소명을 채우면 소명 항목은 사라지고 출입증만 남아, 사유로 상신 → 사유 승인. 승인자가 입력한 본사 지출은 감사 기록 selfApproval에(차단 없음)", async () => {
    as(ids.pm);
    await db.expense.update({ where: { id: ids.expense }, data: { justification: "야근 3인 식사" } });
    // 재무 승인 담당 본인이 입력한 본사 지출 2건 (P0-3 ④ 자기 승인 — 경고·기록만, 승인은 막지 않는다)
    await db.expense.createMany({
      data: [1, 2].map((n) => ({
        projectId: ids.project, payerId: ids.pm, date: new Date("2026-04-12T00:00:00Z"), amount: 30_000 * n, payMethod: "HQ", isHq: true, itemId: ids.item, detail: `가상 본사 지출 ${n}`, yearMonth: YM, createdBy: ids.hq,
      })),
    });
    const closed = await post("close");
    expect(closed.status).toBe(200);
    const row = await db.monthlyClosing.findUniqueOrThrow({ where: { id: ids.closing } });
    expect(row.reviewNote).toBeNull();
    expect(row.lastReviewNote).toBe("한도 초과 소명을 받으세요");
    expect(row.lastReviewedBy).toBe(ids.hq);
    expect(row.lastReviewedAt).not.toBeNull();

    const pre = await json(preflightRoute.GET, { id: ids.project, ym: YM });
    expect((pre.body!.blockers as { code: string }[]).map((b) => b.code)).toEqual(["PASS_OPEN"]);
    const submitted = await post("submit", { overrideReason: REASON });
    expect(submitted.status).toBe(200);
    expect(JSON.parse((submitted.body!.submitOverride as string))).toMatchObject({ blockers: ["PASS_OPEN"] });
    // 소명이 다 있으면 사유 없이 승인된다 (출입증은 재무 승인 가드가 아님 — 판단 요약에 표시)
    as(ids.hq);
    const approved = await json(reviewRoute.POST, { id: ids.closing }, { method: "POST", body: JSON.stringify({ decision: "approve", note: "" }) });
    expect(approved.status).toBe(200);
    expect(approved.body?.status).toBe("APPROVED");
    // 승인된 달에도 직전 반려 사유는 그대로
    expect((await db.monthlyClosing.findUniqueOrThrow({ where: { id: ids.closing } })).lastReviewNote).toBe("한도 초과 소명을 받으세요");
    // 자기 승인: 승인자 본인이 입력한 본사 지출 2건 90,000원이 승인 감사 기록에 남는다
    const log = await db.auditLog.findFirst({ where: { entity: "MonthlyClosing", entityId: ids.closing, action: "approve" }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(log!.data!)).toMatchObject({ from: "SUBMITTED", to: "APPROVED", selfApproval: { count: 2, amount: 90_000 } });
  });
});
