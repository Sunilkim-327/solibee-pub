// 팀원 입력 기한(다음 달 3일, 2026-10-15 결정) — 실제 라우트 (tests/settle-routes.test.ts 양식: e2e.db를 임시 파일로 복사해 가상의 프로젝트·사람을 넣고 호출)
// - 팀원: 기한 지난 달 등록·수정·삭제 403 (lib/month-phase inputDeadlineProblem 문구), 이번 달은 그대로
// - 수정으로 날짜를 기한 지난 달로 옮기는 것도 403 (옛 달·새 달 모두 검사)
// - PM: 대신 입력·수정·삭제 그대로 (기한과 무관)
// - 마감된 달은 마감 문구가 먼저
// 오늘 기준 두 달 전 = 항상 기한 지남, 이번 달 = 항상 기한 안 (날짜를 오늘 기준으로 잡아 어느 날 돌려도 같다)
// e2e.db·dev.db는 바꾸지 않는다. e2e.db가 없으면 건너뛴다.
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-deadline-${process.pid}-${Date.now()}.db`);
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
const ids = { pm: "", member: "", project: "", item: "", pastExpense: "", openExpense: "" };
const when = { today: "", thisYm: "", pastYm: "", pastDate: "", pastMessage: "" };
let closing: { POST: Handler };
let expenseRoute: { PATCH: Handler; DELETE: Handler };
let projectExpenses: { POST: Handler };
let as: (userId: string) => void;

const call = async (h: Handler, params: Record<string, string>, init: RequestInit = {}) => {
  const res = await h(new Request("http://localhost/api", { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json().catch(() => null)) as { error?: string; id?: string } | null };
};
const post = (body: Record<string, unknown>) => call(projectExpenses.POST, { id: ids.project }, { method: "POST", body: JSON.stringify({ amount: 7000, itemId: ids.item, detail: "가상 지출", payMethod: "PERSONAL_CARD", ...body }) });
const patch = (id: string, body: Record<string, unknown>) => call(expenseRoute.PATCH, { id }, { method: "PATCH", body: JSON.stringify(body) });
const del = (id: string) => call(expenseRoute.DELETE, { id }, { method: "DELETE" });

beforeAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  const { createSessionToken } = await import("@/lib/session");
  const { addMonths, seoulToday } = await import("@/lib/format");
  const { inputDeadlineProblem } = await import("@/lib/month-phase");
  as = (userId: string) => { token = createSessionToken(userId, 0); };
  when.today = seoulToday();
  when.thisYm = when.today.slice(0, 7);
  when.pastYm = addMonths(when.thisYm, -2);
  when.pastDate = `${when.pastYm}-10`;
  when.pastMessage = inputDeadlineProblem(when.pastYm, when.today)!;

  const user = (name: string, role: string, position: string) => prisma.user.create({ data: { name, role, position, passwordHash: "x", loginId: `${name}-${Date.now()}@test.local` } });
  const [pm, member] = await Promise.all([user("가상기한PM", "MANAGER", "팀장"), user("가상기한팀원", "MEMBER", "사원")]);
  // 기간: 6달 전 ~ 6달 뒤 (진행 중 — 종료 대기 규칙과 무관하게 기한만 본다)
  const project = await prisma.project.create({
    data: { name: "가상 기한", startDate: new Date(`${addMonths(when.thisYm, -6)}-01T00:00:00Z`), endDate: new Date(`${addMonths(when.thisYm, 6)}-28T00:00:00Z`), fiscalStart: 1 },
  });
  await prisma.projectMember.createMany({ data: [{ projectId: project.id, userId: pm.id, isPm: true, isPayer: true }, { projectId: project.id, userId: member.id, isPayer: true }] });
  const cat = await prisma.category.findFirstOrThrow({ where: { id: { not: "client-pass" } }, orderBy: { order: "asc" } });
  const item = await prisma.item.create({ data: { projectId: project.id, categoryId: cat.id, name: "가상 야근식대", code: "ddl-01", needsAttendees: false } });
  await prisma.budgetLine.create({ data: { projectId: project.id, itemId: item.id, detail: "가상", unitPrice: 100_000, periods: 12, planned: 1_200_000 } });
  await prisma.memberItem.create({ data: { projectId: project.id, itemId: item.id } });
  const mk = (date: string) => prisma.expense.create({
    data: { projectId: project.id, payerId: member.id, date: new Date(`${date}T00:00:00Z`), amount: 10_000, payMethod: "PERSONAL_CARD", itemId: item.id, detail: "가상 지출", yearMonth: date.slice(0, 7), createdBy: member.id },
  });
  const [pastExpense, openExpense] = await Promise.all([mk(when.pastDate), mk(when.today)]);
  Object.assign(ids, { pm: pm.id, member: member.id, project: project.id, item: item.id, pastExpense: pastExpense.id, openExpense: openExpense.id });
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

describe.skipIf(!has)("팀원 입력 기한 — API", () => {
  it("팀원은 기한 지난 달에 등록할 수 없고(403, 기한 문구), 이번 달은 등록된다", async () => {
    as(ids.member);
    const late = await post({ date: when.pastDate });
    expect(late.status).toBe(403);
    expect(late.body?.error).toBe(when.pastMessage);
    expect(late.body?.error).toMatch(/입력 기한\(\d+월 \d+일\)이 지났어요/);
    expect((await post({ date: when.today })).status).toBe(201);
  });

  it("PM은 기한 지난 달에 팀원 대신 입력할 수 있다", async () => {
    as(ids.pm);
    const r = await post({ date: when.pastDate, payerId: ids.member });
    expect(r.status).toBe(201);
  });

  it("팀원은 기한 지난 달의 건을 수정·삭제할 수 없다 (403), 이번 달 건은 수정되지만 기한 지난 달로 옮길 수는 없다", async () => {
    as(ids.member);
    const p = await patch(ids.pastExpense, { detail: "가상 수정" });
    expect(p.status).toBe(403);
    expect(p.body?.error).toBe(when.pastMessage);
    const d = await del(ids.pastExpense);
    expect(d.status).toBe(403);
    expect(d.body?.error).toBe(when.pastMessage);
    expect((await patch(ids.openExpense, { detail: "가상 수정" })).status).toBe(200);
    // 날짜를 옛 달로 옮기면 새 달 기준으로 403
    const moved = await patch(ids.openExpense, { date: when.pastDate });
    expect(moved.status).toBe(403);
    expect(moved.body?.error).toBe(when.pastMessage);
  });

  it("PM은 기한 지난 달의 팀원 건을 수정·삭제할 수 있다", async () => {
    as(ids.pm);
    expect((await patch(ids.pastExpense, { detail: "PM 수정" })).status).toBe(200);
    // 금액을 달리해 같은 날·같은 금액 중복 점검(소명 필요 422)을 피한다
    const made = await post({ date: when.pastDate, payerId: ids.member, detail: "지울 건", amount: 9000 });
    expect(made.status).toBe(201);
    expect((await del(made.body!.id!)).status).toBe(200);
  });

  it("마감된 달은 기한 문구보다 마감 문구가 먼저", async () => {
    as(ids.pm);
    expect((await call(closing.POST, { id: ids.project, ym: when.pastYm, action: "close" }, { method: "POST" })).status).toBe(200);
    as(ids.member);
    const r = await patch(ids.pastExpense, { detail: "가상 수정" });
    expect(r.status).toBe(403);
    expect(r.body?.error).toContain("마감된 월");
  });
});
