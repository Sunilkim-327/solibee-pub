// 변경계약 종료일 단축 → 본계약 종료일 되돌리기 — 실제 라우트 (tests/submit-guard-routes.test.ts 양식)
// 원 12/31, 과업으로 3/31까지 연장, 1월 지출이 있어 1/31로만 되돌림 → extendedFrom(원 종료일) 유지,
// 지출이 없어진 뒤 12/31까지 되돌리면 extendedFrom 삭제. e2e.db·dev.db는 바꾸지 않는다.
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-restore-${process.pid}-${Date.now()}.db`);
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
const ids = { project: "", change: "", expense: "" };
let changeRoute: { PATCH: Handler };
let db: typeof import("@/lib/db").prisma;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null | undefined) => x?.toISOString().slice(0, 10) ?? null;
const patch = async (body: unknown) => {
  const res = await changeRoute.PATCH(new Request("http://localhost/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ids.change }) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};
const state = async () => {
  const [p, c] = await Promise.all([db.project.findUniqueOrThrow({ where: { id: ids.project } }), db.contractChange.findUniqueOrThrow({ where: { id: ids.change } })]);
  return { projectEnd: iso(p.endDate), changeEnd: iso(c.endDate), extendedFrom: iso(c.extendedFrom) };
};

beforeAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  db = prisma;
  const { createSessionToken } = await import("@/lib/session");
  const user = (name: string, role: string) => prisma.user.create({ data: { name, role, position: "책임", passwordHash: "x", loginId: `${name}-${Date.now()}@test.local` } });
  const [pm, hq] = await Promise.all([user("가상PM되돌림", "MANAGER"), user("가상재무되돌림", "HQ")]);
  // 원 종료일 12/31 → 변경 1차 과업으로 3/31까지 연장된 상태
  const project = await prisma.project.create({ data: { name: "가상 종료일 되돌림", startDate: d("2026-01-01"), endDate: d("2027-03-31"), fiscalStart: 1 } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: pm.id, isPm: true, isPayer: true } });
  const change = await prisma.contractChange.create({ data: { projectId: project.id, seq: 1, title: "가상 연장 과업", signedAt: d("2026-11-01"), startDate: d("2026-11-01"), endDate: d("2027-03-31"), extendedFrom: d("2026-12-31") } });
  const cat = await prisma.category.findFirstOrThrow({ where: { id: { not: "client-pass" } }, orderBy: { order: "asc" } });
  const item = await prisma.item.create({ data: { projectId: project.id, categoryId: cat.id, name: "가상 야근식대", code: "rst-01", needsAttendees: false } });
  // 연장 기간 안(1/15)의 지출
  const e = await prisma.expense.create({ data: { projectId: project.id, payerId: pm.id, date: d("2027-01-15"), amount: 10_000, payMethod: "PERSONAL_CARD", itemId: item.id, detail: "가상", yearMonth: "2027-01", createdBy: pm.id } });
  Object.assign(ids, { project: project.id, change: change.id, expense: e.id });
  token = createSessionToken(hq.id, 0);
  changeRoute = await import("@/app/api/changes/[id]/route") as unknown as typeof changeRoute;
}, 60_000);

afterAll(async () => {
  if (!has) return;
  await db.$disconnect();
  rmSync(TMP, { force: true });
});

describe.skipIf(!has)("본계약 종료일 되돌리기 — API", () => {
  it("1월 지출이 있으면 1/31까지만 되돌리고 extendedFrom(원 종료일 12/31)은 남긴다", async () => {
    const r = await patch({ endDate: "2027-01-31" });
    expect(r.status).toBe(200);
    expect(await state()).toEqual({ projectEnd: "2027-01-31", changeEnd: "2027-01-31", extendedFrom: "2026-12-31" });
  });
  it("지출이 없어진 뒤 12/31까지 되돌리면 본계약 종료일이 원 종료일로 돌아가고 extendedFrom은 지워진다", async () => {
    await db.expense.delete({ where: { id: ids.expense } });
    const r = await patch({ endDate: "2026-12-31" });
    expect(r.status).toBe(200);
    expect(await state()).toEqual({ projectEnd: "2026-12-31", changeEnd: "2026-12-31", extendedFrom: null });
    const log = await db.auditLog.findFirst({ where: { entity: "Project", entityId: ids.project, action: "restore-end" }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();
  });
});
