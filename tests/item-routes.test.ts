// 항목 API — 유니크 제약(P1-8)·삭제/비활성 정책(P1-7) 실제 라우트 (e2e.db를 임시 파일로 복사해 가상의 프로젝트·사람을 넣고 호출한다)
// - 같은 프로젝트에 같은 이름·코드 생성 → 409 (앱 검사 문구 = DB 제약 문구)
// - DB 유니크 색인 자체도 같은 프로젝트·같은 이름을 막는다 (P2002)
// - 삭제: 지출·출입증·예산 행 같은 기록성 참조가 있으면 409 { inUse }, 팀원 항목·과업 항목 같은 설정성 참조만 있으면 함께 지우고 삭제
// e2e.db·dev.db는 바꾸지 않는다. e2e.db가 없으면 건너뛴다.
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-items-${process.pid}-${Date.now()}.db`);
if (has) {
  const src = new DatabaseSync(SRC, { readOnly: true });
  src.exec(`VACUUM INTO '${TMP.replace(/'/g, "''")}'`);
  src.close();
  // e2e.db에 아직 새 스키마가 반영되지 않았어도 테스트가 같은 제약 아래서 돌게 (prisma/d1/0011과 같은 SQL, 있으면 그대로)
  const tmp = new DatabaseSync(TMP);
  tmp.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Item_projectId_name_key" ON "Item"("projectId", "name");
    CREATE UNIQUE INDEX IF NOT EXISTS "Item_projectId_code_key" ON "Item"("projectId", "code");`);
  tmp.close();
  process.env.DATABASE_URL = `file:${TMP.split(path.sep).join("/")}`;
}

let token: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "opex_session" && token ? { value: token } : undefined) }),
  headers: async () => new Headers(),
}));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ids = { hq: "", pm: "", project: "", category: "" };
let itemsRoute: { POST: Handler };
let itemRoute: { PATCH: Handler; DELETE: Handler };
let db: typeof import("@/lib/db").prisma;

const json = async (h: Handler, params: Record<string, string>, init: RequestInit = {}) => {
  const res = await h(new Request("http://localhost/api", { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};
const post = (body: Record<string, unknown>) => json(itemsRoute.POST, {}, { method: "POST", body: JSON.stringify(body) });
const patch = (id: string, body: Record<string, unknown>) => json(itemRoute.PATCH, { id }, { method: "PATCH", body: JSON.stringify(body) });
const del = (id: string) => json(itemRoute.DELETE, { id }, { method: "DELETE" });
const newItem = (name: string, code: string) => db.item.create({ data: { projectId: ids.project, categoryId: ids.category, name, code, needsAttendees: false } });

beforeAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  db = prisma;
  const { createSessionToken } = await import("@/lib/session");
  const user = (name: string, role: string) => prisma.user.create({ data: { name, role, position: "책임", passwordHash: "x", loginId: `${name}-${Date.now()}@test.local` } });
  const [hq, pm] = await Promise.all([user("가상재무항목", "HQ"), user("가상PM항목", "MANAGER")]);
  const project = await prisma.project.create({ data: { name: "가상 항목 제약", startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), fiscalStart: 1 } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: pm.id, isPm: true, isPayer: true } });
  const cat = await prisma.category.findFirstOrThrow({ where: { id: { not: "client-pass" } }, orderBy: { order: "asc" } });
  Object.assign(ids, { hq: hq.id, pm: pm.id, project: project.id, category: cat.id });
  token = createSessionToken(hq.id, 0);
  itemsRoute = await import("@/app/api/master/items/route") as unknown as typeof itemsRoute;
  itemRoute = await import("@/app/api/master/items/[id]/route") as unknown as typeof itemRoute;
}, 60_000);

afterAll(async () => {
  if (!has) return;
  await db.$disconnect();
  rmSync(TMP, { force: true });
});

describe.skipIf(!has)("항목 유니크 제약 — API", () => {
  it("같은 프로젝트에 같은 이름 → 409 '이미 같은 이름의 항목이 있습니다: ○○', 같은 코드(대소문자 무시) → 409", async () => {
    const a = await post({ projectId: ids.project, categoryId: ids.category, name: "가상 유니크A", code: "uq-01" });
    expect(a.status).toBe(201);
    const dupName = await post({ projectId: ids.project, categoryId: ids.category, name: "가상 유니크A", code: "uq-02" });
    expect(dupName.status).toBe(409);
    expect(dupName.body?.error).toBe("이미 같은 이름의 항목이 있습니다: 가상 유니크A");
    const dupCode = await post({ projectId: ids.project, categoryId: ids.category, name: "가상 유니크B", code: "UQ-01" });
    expect(dupCode.status).toBe(409);
    expect(dupCode.body?.error).toBe("이미 같은 코드의 항목이 있습니다: UQ-01");
    // 다른 프로젝트(공통 항목)에는 같은 이름을 만들 수 있다 — 제약은 프로젝트 안에서만
    const other = await db.project.create({ data: { name: "가상 다른 프로젝트", startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), fiscalStart: 1 } });
    const okElsewhere = await post({ projectId: other.id, categoryId: ids.category, name: "가상 유니크A", code: "uq-01" });
    expect(okElsewhere.status).toBe(201);
  });

  it("수정으로 다른 항목과 같은 이름·코드로 바꾸면 409 (생성과 같은 문구)", async () => {
    const b = await post({ projectId: ids.project, categoryId: ids.category, name: "가상 유니크B", code: "uq-02" });
    expect(b.status).toBe(201);
    const id = b.body!.id as string;
    const byName = await patch(id, { name: "가상 유니크A" });
    expect(byName.status).toBe(409);
    expect(byName.body?.error).toBe("이미 같은 이름의 항목이 있습니다: 가상 유니크A");
    const byCode = await patch(id, { code: "uq-01" });
    expect(byCode.status).toBe(409);
    expect(byCode.body?.error).toBe("이미 같은 코드의 항목이 있습니다: uq-01");
    // 자기 자신의 이름으로 저장하는 건 허용
    expect((await patch(id, { name: "가상 유니크B", code: "uq-02" })).status).toBe(200);
  });

  it("DB 유니크 색인이 앱 검사를 지나친 중복도 막는다 (P2002) — 공통 항목(projectId null)은 색인이 안 걸려 앱 검사만", async () => {
    await expect(newItem("가상 유니크A", "uq-09")).rejects.toMatchObject({ code: "P2002" });
    await expect(newItem("가상 유니크Z", "uq-01")).rejects.toMatchObject({ code: "P2002" });
    // 같은 프로젝트에 code null은 여럿 가능
    await db.item.create({ data: { projectId: ids.project, categoryId: ids.category, name: "가상 코드없음1", needsAttendees: false } });
    await db.item.create({ data: { projectId: ids.project, categoryId: ids.category, name: "가상 코드없음2", needsAttendees: false } });
    // 공통 항목은 라우트가 409
    const c1 = await post({ projectId: null, categoryId: ids.category, name: "가상 공통 유니크", code: "cuq-01" });
    expect(c1.status).toBe(201);
    const c2 = await post({ projectId: null, categoryId: ids.category, name: "가상 공통 유니크", code: "cuq-02" });
    expect(c2.status).toBe(409);
    expect(c2.body?.error).toBe("이미 같은 이름의 항목이 있습니다: 가상 공통 유니크");
  });
});

describe.skipIf(!has)("항목 삭제 정책 — 기록이 참조하면 409, 설정성 참조만 있으면 삭제", () => {
  it("지출 기록이 있으면 409 { inUse } — 항목은 남는다", async () => {
    const it1 = await newItem("가상 삭제-지출", "del-01");
    await db.expense.create({ data: { projectId: ids.project, payerId: ids.pm, date: new Date("2026-03-10T00:00:00Z"), amount: 12_000, payMethod: "PERSONAL_CARD", itemId: it1.id, detail: "가상", yearMonth: "2026-03", createdBy: ids.pm } });
    const r = await del(it1.id);
    expect(r.status).toBe(409);
    expect(r.body?.inUse).toBe(true);
    expect(r.body?.error).toContain("사용 기록이 있어 삭제할 수 없습니다");
    expect(r.body?.error).toContain("지출 1건");
    expect(r.body?.error).toContain("'사용 안 함'으로 바꾸세요");
    expect(await db.item.findUnique({ where: { id: it1.id } })).not.toBeNull();
  });

  it("예산 행이 있으면 409 { inUse } (예산 행을 지우지 않는다)", async () => {
    const it2 = await newItem("가상 삭제-예산", "del-02");
    await db.budgetLine.create({ data: { projectId: ids.project, itemId: it2.id, detail: "가상", unitPrice: 100_000, periods: 12, planned: 1_200_000 } });
    const r = await del(it2.id);
    expect(r.status).toBe(409);
    expect(r.body?.inUse).toBe(true);
    expect(r.body?.error).toContain("예산 1행");
    expect(await db.budgetLine.count({ where: { itemId: it2.id } })).toBe(1);
    expect(await db.item.findUnique({ where: { id: it2.id } })).not.toBeNull();
  });

  it("출입증 명세 줄(usageItemId)이 참조하면 409", async () => {
    const it3 = await newItem("가상 삭제-출입증", "del-03");
    const st = await db.passStatement.create({ data: { projectId: ids.project, yearMonth: "2026-04", fileName: "가상.xlsx", uploadedBy: ids.pm } });
    await db.passStatementLine.create({ data: { statementId: st.id, holderName: "가상", amount: 8_000, userId: ids.pm, usageItemId: it3.id } });
    const r = await del(it3.id);
    expect(r.status).toBe(409);
    expect(r.body?.error).toContain("출입증 사용 1건");
  });

  it("팀원 입력 항목·과업 항목·묶음 참조만 있으면 함께 정리하고 삭제", async () => {
    const it4 = await newItem("가상 삭제-설정만", "del-04");
    const rep = await newItem("가상 묶음 대표", "del-05");
    await db.memberItem.create({ data: { projectId: ids.project, itemId: it4.id } });
    const change = await db.contractChange.create({ data: { projectId: ids.project, seq: 1, title: "가상 과업", signedAt: new Date("2026-02-01T00:00:00Z"), startDate: new Date("2026-02-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z") } });
    await db.changeItem.create({ data: { changeId: change.id, itemId: it4.id } });
    const line = await db.budgetLine.create({ data: { projectId: ids.project, itemId: rep.id, detail: "가상 묶음", unitPrice: 50_000, periods: 12, planned: 600_000, bundleItemIds: JSON.stringify([it4.id]) } });
    const r = await del(it4.id);
    expect(r.status).toBe(200);
    expect(await db.item.findUnique({ where: { id: it4.id } })).toBeNull();
    expect(await db.memberItem.count({ where: { itemId: it4.id } })).toBe(0);
    expect(await db.changeItem.count({ where: { itemId: it4.id } })).toBe(0);
    // 다른 항목의 묶음에서 빠지고 그 예산 행은 남는다
    const after = await db.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(after.bundleItemIds).toBeNull();
    const log = await db.auditLog.findFirst({ where: { entity: "Item", entityId: it4.id, action: "delete" } });
    expect(log).not.toBeNull();
    expect(JSON.parse(log!.data!)).toMatchObject({ unbundled: [line.id] });
  });

  it("이월 관계: 원본 과업이 지워지면 carriedFromId가 비워진다 (SetNull)", async () => {
    const src = await db.contractChange.create({ data: { projectId: ids.project, seq: 2, title: "가상 원본", signedAt: new Date("2026-02-01T00:00:00Z"), startDate: new Date("2026-02-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z") } });
    const carried = await db.contractChange.create({ data: { projectId: ids.project, seq: 3, title: "가상 이월", signedAt: new Date("2026-02-01T00:00:00Z"), startDate: new Date("2026-02-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), carriedFromId: src.id } });
    const withRel = await db.contractChange.findUniqueOrThrow({ where: { id: carried.id }, include: { carriedFrom: true } });
    expect(withRel.carriedFrom?.id).toBe(src.id);
    await db.contractChange.delete({ where: { id: src.id } });
    expect((await db.contractChange.findUniqueOrThrow({ where: { id: carried.id } })).carriedFromId).toBeNull();
  });
});
