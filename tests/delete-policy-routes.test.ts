// 삭제 vs 비활성 정책 — 실제 라우트 (tests/submit-guard-routes.test.ts 양식: e2e.db를 임시 파일로 복사해 가상의 프로젝트·사람을 넣고 호출)
// 설계 검토(2026-10-14) P1-7: "기록이 참조하면 삭제 대신 비활성/철수일, 참조 없을 때만 삭제"
// - 협력 인력 PUT: 명단에서 뺀 사람 중 지출 참석자에 기록이 있으면 active=false로 남기고(kept), 없으면 삭제
// - 팀원 PUT: 지출 결제자·출입증 내역 줄(외부인 대신 처리한 줄 포함)이 있는 사람은 삭제 불가(400), 철수일로는 가능, 기록 없는 사람은 삭제
// e2e.db·dev.db는 바꾸지 않는다. e2e.db가 없으면 건너뛴다.
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-delpolicy-${process.pid}-${Date.now()}.db`);
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
const ids = { pm: "", m1: "", m2: "", project: "", partnerA: "", partnerB: "", line: "" };
let partnersRoute: { PUT: Handler };
let membersRoute: { PUT: Handler };
let db: typeof import("@/lib/db").prisma;

const put = async (h: Handler, body: unknown) => {
  const res = await h(new Request("http://localhost/api", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ids.project }) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

beforeAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  db = prisma;
  const { createSessionToken } = await import("@/lib/session");
  token = undefined;
  const user = (name: string, role: string) => prisma.user.create({ data: { name, role, position: "책임", passwordHash: "x", loginId: `${name}-${Date.now()}@test.local` } });
  const [pm, m1, m2] = await Promise.all([user("가상PM삭제정책", "MANAGER"), user("가상팀원기록있음", "MEMBER"), user("가상팀원기록없음", "MEMBER")]);
  const project = await prisma.project.create({ data: { name: "가상 삭제 정책", startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), fiscalStart: 1 } });
  await prisma.projectMember.createMany({ data: [
    { projectId: project.id, userId: pm.id, isPm: true, isPayer: true },
    { projectId: project.id, userId: m1.id, isPm: false, isPayer: true },
    { projectId: project.id, userId: m2.id, isPm: false, isPayer: true },
  ] });
  const cat = await prisma.category.findFirstOrThrow({ where: { id: { not: "client-pass" } }, orderBy: { order: "asc" } });
  const item = await prisma.item.create({ data: { projectId: project.id, categoryId: cat.id, name: "가상 회식", code: "del-01", needsAttendees: true } });
  const [a, b] = await Promise.all([
    prisma.projectPartner.create({ data: { projectId: project.id, name: "협력가", company: "가나테크", order: 0 } }),
    prisma.projectPartner.create({ data: { projectId: project.id, name: "협력나", company: null, order: 1 } }),
  ]);
  // m1이 결제한 지출, 참석자에 협력가(가나테크)만 기록
  await prisma.expense.create({
    data: { projectId: project.id, payerId: m1.id, date: new Date("2026-03-10T00:00:00Z"), amount: 30_000, payMethod: "PERSONAL_CARD", itemId: item.id, detail: "가상 회식", attendees: `${pm.name}, 협력가(가나테크)`, headcount: 2, yearMonth: "2026-03", createdBy: m1.id },
  });
  // m2는 출입증 내역에서 외부인 대신 처리한 줄만 있음
  const st = await prisma.passStatement.create({ data: { projectId: project.id, yearMonth: "2026-03", fileName: "가상.xlsx", uploadedBy: pm.id } });
  const line = await prisma.passStatementLine.create({ data: { statementId: st.id, holderName: "외부인", amount: 5000, userId: m2.id, onBehalfName: "외부인" } });
  Object.assign(ids, { pm: pm.id, m1: m1.id, m2: m2.id, project: project.id, partnerA: a.id, partnerB: b.id, line: line.id });
  token = createSessionToken(pm.id, 0);
  partnersRoute = await import("@/app/api/projects/[id]/partners/route") as unknown as typeof partnersRoute;
  membersRoute = await import("@/app/api/projects/[id]/members/route") as unknown as typeof membersRoute;
}, 60_000);

afterAll(async () => {
  if (!has) return;
  await db.$disconnect();
  rmSync(TMP, { force: true });
});

describe.skipIf(!has)("삭제 vs 비활성 정책 — API", () => {
  it("협력 인력: 명단에서 뺀 사람 중 참석자 기록이 있으면 '사용 안 함'으로 남고(kept), 없으면 삭제", async () => {
    const r = await put(partnersRoute.PUT, { partners: [] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, kept: ["협력가(가나테크)"] });
    const rows = await db.projectPartner.findMany({ where: { projectId: ids.project } });
    expect(rows.map((p) => [p.name, p.active])).toEqual([["협력가", false]]);
    // 기록이 없어진 뒤(지출 참석자 변경) 다시 빼면 삭제
    await db.expense.updateMany({ where: { projectId: ids.project }, data: { attendees: "가상PM삭제정책" } });
    expect(await put(partnersRoute.PUT, { partners: [] })).toMatchObject({ status: 200, body: { kept: [] } });
    expect(await db.projectPartner.count({ where: { projectId: ids.project } })).toBe(0);
  });

  it("팀원: 지출 결제자·출입증 줄이 있는 사람은 삭제 400, 철수일로는 200, 기록 없는 사람은 삭제", async () => {
    const only = (...userIds: string[]) => ({ members: userIds.map((userId) => ({ userId, isPayer: true })) });
    const r1 = await put(membersRoute.PUT, only(ids.pm, ids.m2));
    expect(r1.status).toBe(400);
    expect(String(r1.body?.error)).toContain("가상팀원기록있음");
    // 외부인 대신 처리한 출입증 줄(onBehalfName)도 기록으로 본다
    const r2 = await put(membersRoute.PUT, only(ids.pm, ids.m1));
    expect(r2.status).toBe(400);
    expect(String(r2.body?.error)).toContain("가상팀원기록없음");
    // 철수일로는 남길 수 있다
    const r3 = await put(membersRoute.PUT, { members: [{ userId: ids.pm, isPayer: true }, { userId: ids.m1, isPayer: true, leftAt: "2026-03-31" }, { userId: ids.m2, isPayer: true }] });
    expect(r3.status).toBe(200);
    const m1 = await db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: ids.project, userId: ids.m1 } } });
    expect(m1.leftAt?.toISOString().slice(0, 10)).toBe("2026-03-31");
    // 줄을 지우면 m2는 기록이 없어 삭제된다
    await db.passStatementLine.delete({ where: { id: ids.line } });
    const r4 = await put(membersRoute.PUT, { members: [{ userId: ids.pm, isPayer: true }, { userId: ids.m1, isPayer: true, leftAt: "2026-03-31" }] });
    expect(r4.status).toBe(200);
    expect((await db.projectMember.findMany({ where: { projectId: ids.project } })).map((m) => m.userId).sort()).toEqual([ids.m1, ids.pm].sort());
  });
});
