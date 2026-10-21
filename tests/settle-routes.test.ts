// 메인과 함께 상신하는 서브 — API 권한·잠금 (e2e.db를 임시 파일로 복사해 가상의 프로젝트·사람을 넣고 실제 라우트를 호출한다)
// - 서브 단독 마감·상신 차단 (403, 메인과 함께 상신 안내)
// - 메인 마감 시 서브 같은 달 지출 등록·수정·삭제 403, 마감 해제하면 다시 가능
// - 서브 팀원은 메인 데이터를 볼 수 없고, 메인 PM은 서브를 조회만
// e2e.db·dev.db는 바꾸지 않는다. e2e.db가 없으면 건너뛴다.
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-settle-${process.pid}-${Date.now()}.db`);
if (has) {
  const src = new DatabaseSync(SRC, { readOnly: true });
  src.exec(`VACUUM INTO '${TMP.replace(/'/g, "''")}'`);
  src.close();
  process.env.DATABASE_URL = `file:${TMP.split(path.sep).join("/")}`;
}

// 로그인 쿠키: 테스트가 고른 사용자
let token: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "opex_session" && token ? { value: token } : undefined) }),
  headers: async () => new Headers(),
}));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ids = { mainPm: "", subPm: "", subMember: "", main: "", sub: "", expense: "", subItem: "" };
let closing: { POST: Handler };
let expenseRoute: { PATCH: Handler; DELETE: Handler };
let projectExpenses: { GET: Handler; POST: Handler };
let as: (userId: string) => void;

const call = async (h: Handler, params: Record<string, string>, init: RequestInit = {}) => {
  const res = await h(new Request("http://localhost/api", { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json().catch(() => null)) as { error?: string } | null };
};

beforeAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  const { createSessionToken } = await import("@/lib/session");
  as = (userId: string) => { token = createSessionToken(userId, 0); };
  const user = (name: string, role: string, position: string) => prisma.user.create({ data: { name, role, position, passwordHash: "x", loginId: `${name}-${Date.now()}@test.local` } });
  const [mainPm, subPm, subMember, mainMember] = await Promise.all([user("가상메인PM", "MANAGER", "팀장"), user("가상서브PM", "MANAGER", "책임"), user("가상서브팀원", "MEMBER", "사원"), user("가상메인팀원", "MEMBER", "사원")]);
  const period = { startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), fiscalStart: 1 };
  const main = await prisma.project.create({ data: { name: "가상 메인", excelPrefix: "운영", ...period } });
  const sub = await prisma.project.create({ data: { name: "가상 대응", parentId: main.id, settleWithParent: true, excelPrefix: "대응", ...period } });
  await prisma.projectMember.createMany({
    data: [
      { projectId: main.id, userId: mainPm.id, isPm: true }, { projectId: main.id, userId: mainMember.id },
      { projectId: sub.id, userId: subPm.id, isPm: true }, { projectId: sub.id, userId: subMember.id },
    ],
  });
  const cat = await prisma.category.findFirstOrThrow({ where: { id: { not: "client-pass" } }, orderBy: { order: "asc" } });
  const mk = (projectId: string) => prisma.item.create({ data: { projectId, categoryId: cat.id, name: "가상 야근식대", code: "test-01", needsAttendees: false } });
  const [mainItem, subItem] = await Promise.all([mk(main.id), mk(sub.id)]);
  await prisma.budgetLine.createMany({
    data: [
      { projectId: main.id, itemId: mainItem.id, detail: "가상", unitPrice: 100_000, periods: 12, planned: 1_200_000 },
      { projectId: sub.id, itemId: subItem.id, detail: "가상", unitPrice: 50_000, periods: 12, planned: 600_000 },
    ],
  });
  await prisma.memberItem.createMany({ data: [{ projectId: sub.id, itemId: subItem.id }, { projectId: main.id, itemId: mainItem.id }] });
  const e = await prisma.expense.create({
    data: { projectId: sub.id, payerId: subMember.id, date: new Date("2026-03-10T00:00:00Z"), amount: 10_000, payMethod: "PERSONAL_CARD", itemId: subItem.id, detail: "가상 지출", yearMonth: "2026-03", createdBy: subMember.id },
  });
  Object.assign(ids, { mainPm: mainPm.id, subPm: subPm.id, subMember: subMember.id, main: main.id, sub: sub.id, expense: e.id, subItem: subItem.id });
  closing = await import("@/app/api/projects/[id]/closings/[ym]/[action]/route") as unknown as typeof closing;
  expenseRoute = await import("@/app/api/expenses/[id]/route") as unknown as typeof expenseRoute;
  projectExpenses = await import("@/app/api/projects/[id]/expenses/route") as unknown as typeof projectExpenses;
});

afterAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
  rmSync(TMP, { force: true });
});

describe.skipIf(!has)("메인과 함께 상신 — API", () => {
  it("서브 PM은 서브 단독으로 마감·상신할 수 없다 (403, 메인과 함께 상신 안내)", async () => {
    as(ids.subPm);
    for (const action of ["close", "submit"]) {
      const r = await call(closing.POST, { id: ids.sub, ym: "2026-03", action }, { method: "POST" });
      expect(r.status).toBe(403);
      expect(r.body?.error).toContain("가상 메인과(와) 함께 상신");
    }
  });

  it("메인 PM이 마감하면 서브의 같은 달 지출 수정·삭제·등록이 403, 마감 해제하면 다시 수정 가능", async () => {
    as(ids.mainPm);
    expect((await call(closing.POST, { id: ids.main, ym: "2026-03", action: "close" }, { method: "POST" })).status).toBe(200);

    as(ids.subMember);
    const patch = await call(expenseRoute.PATCH, { id: ids.expense }, { method: "PATCH", body: JSON.stringify({ detail: "가상 수정" }) });
    expect(patch.status).toBe(403);
    expect(patch.body?.error).toContain("마감된 월");
    expect((await call(expenseRoute.DELETE, { id: ids.expense }, { method: "DELETE" })).status).toBe(403);
    const add = await call(projectExpenses.POST, { id: ids.sub }, {
      method: "POST", body: JSON.stringify({ date: "2026-03-12", amount: 7000, itemId: ids.subItem, detail: "가상 추가", payMethod: "PERSONAL_CARD" }),
    });
    expect(add.status).toBe(403);
    // 다른 달(작성중)은 그대로 입력 가능 — 팀원 입력 기한(다음 달 3일)이 지난 달이라 서브 PM으로 (tests/input-deadline-routes.test.ts)
    as(ids.subPm);
    const other = await call(projectExpenses.POST, { id: ids.sub }, {
      method: "POST", body: JSON.stringify({ date: "2026-04-02", amount: 7000, itemId: ids.subItem, detail: "가상 추가", payMethod: "PERSONAL_CARD" }),
    });
    expect(other.status).toBe(201);

    as(ids.mainPm);
    // 마감 해제는 사유 필수 (2026-10-15 결정) — 없으면 400, 있으면 200
    const noReason = await call(closing.POST, { id: ids.main, ym: "2026-03", action: "reopen" }, { method: "POST" });
    expect(noReason.status).toBe(400);
    expect(noReason.body?.error).toContain("마감 해제 사유");
    expect((await call(closing.POST, { id: ids.main, ym: "2026-03", action: "reopen" }, { method: "POST", body: JSON.stringify({ reason: "서브 지출 수정 요청" }) })).status).toBe(200);
    // 마감 해제 뒤 다시 수정 가능 — 2026-03은 팀원 입력 기한이 지났으므로 서브 PM으로 확인
    as(ids.subPm);
    expect((await call(expenseRoute.PATCH, { id: ids.expense }, { method: "PATCH", body: JSON.stringify({ detail: "가상 수정" }) })).status).toBe(200);
  });

  it("서브 팀원은 메인 지출을 볼 수 없고, 메인 PM은 서브 지출을 고칠 수 없다 (조회 전용)", async () => {
    as(ids.subMember);
    expect((await call(projectExpenses.GET, { id: ids.main })).status).toBe(403);
    as(ids.subPm);
    expect((await call(projectExpenses.GET, { id: ids.main })).status).toBe(403);
    as(ids.mainPm);
    expect((await call(projectExpenses.GET, { id: ids.sub })).status).toBe(200);
    expect((await call(expenseRoute.PATCH, { id: ids.expense }, { method: "PATCH", body: JSON.stringify({ detail: "메인 PM 수정" }) })).status).toBe(403);
  });
});
