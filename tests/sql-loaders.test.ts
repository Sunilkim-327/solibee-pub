// 직접 SQL 조회(lib/sql-loaders.ts)가 같은 조건의 Prisma 조회와 같은 결과인지 e2e.db(데모 데이터)에서 대조한다.
// 읽기만 한다. e2e.db가 없으면(처음 받은 저장소 등) 건너뛴다. dev.db는 쓰지 않는다.
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const E2E = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(E2E);
if (has) process.env.DATABASE_URL = "file:./e2e.db";

type Mod = { db: typeof import("@/lib/db"); sql: typeof import("@/lib/sql-loaders") };
let m: Mod;

beforeAll(async () => {
  if (!has) return;
  m = { db: await import("@/lib/db"), sql: await import("@/lib/sql-loaders") };
});
afterAll(async () => {
  if (has) await (m.db.prisma as unknown as { $disconnect(): Promise<void> }).$disconnect();
});

/** 키 순서까지 같은지 (화면으로 넘기는 객체 모양) */
const keysOf = (o: object) => Object.keys(o).join(",");

// 첫 테스트가 Prisma·DB 준비 비용을 떠안아 전체 실행 중 5초를 넘길 때가 있다 (병렬 부하)
describe.skipIf(!has)("직접 SQL 조회 = Prisma 조회 (e2e.db)", { timeout: 20_000 }, () => {
  it("전체 프로젝트 (시작일 순, 모든 스칼라 열)", async () => {
    const [a, b] = await Promise.all([m.db.prisma.project.findMany({ orderBy: { startDate: "asc" } }), m.sql.sqlAllProjects()]);
    expect(b).toEqual(a);
    expect(b.map((p) => p.id)).toEqual(a.map((p) => p.id));
    expect(keysOf(b[0])).toBe(keysOf(a[0]));
    for (const p of a.slice(0, 5)) expect(await m.sql.sqlProjectById(p.id)).toEqual(await m.db.prisma.project.findUnique({ where: { id: p.id } }));
    expect(await m.sql.sqlProjectById("없는-id")).toBeNull();
  });

  it("세션 사용자 행", async () => {
    const users = await m.db.prisma.user.findMany({ select: { id: true } });
    expect(users.length).toBeGreaterThan(0);
    for (const { id } of users) {
      const a = await m.db.prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, loginId: true, role: true, active: true, sessionVersion: true, mustChangePassword: true, position: true, departmentId: true, department: { select: { name: true } } },
      });
      expect(await m.sql.sqlSessionUserRow(id)).toEqual(a);
    }
    expect(await m.sql.sqlSessionUserRow("없는-id")).toBeNull();
  });

  it("조직 노드", async () => {
    const a = await m.db.prisma.department.findMany({ select: { id: true, parentId: true, headId: true, active: true } });
    expect(await m.sql.sqlDepartmentNodes()).toEqual(a);
  });

  it("현재 구성원 정보 (철수일 기준 — 여러 기준일)", async () => {
    const { currentMemberWhere } = await import("@/lib/membership");
    const users = await m.db.prisma.user.findMany({ select: { id: true } });
    const left = await m.db.prisma.projectMember.findMany({ where: { leftAt: { not: null } }, select: { leftAt: true } });
    const days = [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2030, 0, 1)), ...left.map((l) => l.leftAt!)];
    for (const today of days) {
      for (const { id } of users) {
        const a = await m.db.prisma.projectMember.findMany({ where: { userId: id, ...currentMemberWhere(today) }, select: { projectId: true, isPm: true } });
        expect(await m.sql.sqlCurrentMemberships(id, today)).toEqual(a);
      }
    }
  });

  it("프로젝트 구성원 전체 + 사용자", async () => {
    const projects = await m.db.prisma.project.findMany({ select: { id: true } });
    const ids = projects.map((p) => p.id);
    for (const set of [[ids[0]], ids.slice(0, 3), ids]) {
      const a = await m.db.prisma.projectMember.findMany({
        where: { projectId: { in: set } },
        select: { projectId: true, userId: true, isPayer: true, isPm: true, leftAt: true, user: { select: { id: true, name: true, role: true, position: true, active: true } } },
      });
      const b = await m.sql.sqlProjectMembers(set);
      const key = (x: { projectId: string; userId: string }) => `${x.projectId}|${x.userId}`;
      expect([...b].sort((x, y) => key(x).localeCompare(key(y)))).toEqual([...a].sort((x, y) => key(x).localeCompare(key(y))));
    }
    expect(await m.sql.sqlProjectMembers([])).toEqual([]);
  });

  it("마감 행 · 예산 행 · 지출 월 합계", async () => {
    const projects = await m.db.prisma.project.findMany({ select: { id: true } });
    for (const { id } of projects) {
      expect(await m.sql.sqlClosingRows(id)).toEqual(
        await m.db.prisma.monthlyClosing.findMany({ where: { projectId: id }, select: { id: true, yearMonth: true, status: true, reviewNote: true } }),
      );
      expect(await m.sql.sqlBudgetLines(id)).toEqual(
        await m.db.prisma.budgetLine.findMany({ where: { projectId: id }, select: { itemId: true, planned: true, periods: true, bundleItemIds: true }, orderBy: { order: "asc" } }),
      );
    }
    const ids = projects.map((p) => p.id);
    for (const set of [[ids[0]], ids]) {
      const groups = await m.db.prisma.expense.groupBy({ by: ["projectId", "itemId", "yearMonth"], where: { projectId: { in: set } }, _sum: { amount: true } });
      const a = groups.map((g) => ({ projectId: g.projectId, itemId: g.itemId, yearMonth: g.yearMonth, amount: m.db.toNumber(g._sum.amount) }));
      const key = (x: { projectId: string; itemId: string; yearMonth: string }) => `${x.projectId}|${x.itemId}|${x.yearMonth}`;
      const sort = <T extends { projectId: string; itemId: string; yearMonth: string }>(l: T[]) => [...l].sort((x, y) => key(x).localeCompare(key(y)));
      expect(sort(await m.sql.sqlExpenseMonthSums(set))).toEqual(sort(a));
    }
  });

  it("지출 목록 (월·본인·최근 입력) — 정렬·관계까지", async () => {
    const projects = await m.db.prisma.project.findMany({ select: { id: true } });
    const users = await m.db.prisma.user.findMany({ select: { id: true } });
    const ids = projects.map((p) => p.id);
    const months = [...new Set((await m.db.prisma.expense.findMany({ select: { yearMonth: true } })).map((e) => e.yearMonth))].slice(0, 4);
    const cases: { projectIds: string[]; yearMonth?: string; ownUserId?: string; recent?: { userId: string; take: number } }[] = [];
    for (const pid of ids) {
      cases.push({ projectIds: [pid] });
      for (const ym of months) cases.push({ projectIds: [pid], yearMonth: ym }, { projectIds: [pid], yearMonth: ym, ownUserId: users[1]?.id });
    }
    cases.push({ projectIds: ids, yearMonth: months[0] });
    for (const u of users.slice(0, 4)) cases.push({ projectIds: [ids[0]], recent: { userId: u.id, take: 20 } });
    for (const c of cases) {
      const a = await m.db.prisma.expense.findMany({
        where: { projectId: { in: c.projectIds }, ...(c.yearMonth ? { yearMonth: c.yearMonth } : {}), ...(c.ownUserId ? { OR: [{ payerId: c.ownUserId }, { createdBy: c.ownUserId }] } : {}), ...(c.recent ? { createdBy: c.recent.userId } : {}) },
        ...(c.recent ? { take: c.recent.take } : {}),
        include: { payer: { select: { name: true, position: true } }, item: { include: { category: true } }, change: { select: { seq: true, title: true } } },
        orderBy: c.recent ? [{ createdAt: "desc" }, { date: "desc" }] : [{ isHq: "asc" }, { date: "asc" }, { createdAt: "asc" }],
      });
      const b = await m.sql.sqlExpenseList(c);
      expect(b.rows.map((e) => e.id)).toEqual(a.map((e) => e.id));
      a.forEach((e, i) => {
        const r = b.rows[i];
        expect(r).toEqual({ id: e.id, projectId: e.projectId, payerId: e.payerId, date: e.date, amount: e.amount, payMethod: e.payMethod, itemId: e.itemId, detail: e.detail,
          headcount: e.headcount, attendees: e.attendees, merchant: e.merchant, hasExternal: e.hasExternal, flags: e.flags, justification: e.justification, isHq: e.isHq,
          changeId: e.changeId, yearMonth: e.yearMonth, createdBy: e.createdBy });
        expect(b.users.get(e.payerId)).toEqual(e.payer);
        expect(b.items.get(e.itemId)).toEqual({ name: e.item.name, categoryId: e.item.categoryId, categoryName: e.item.category.name });
        expect(e.changeId ? b.changes.get(e.changeId) : null).toEqual(e.change);
      });
      const proxies = a.filter((e) => e.createdBy !== e.payerId).map((e) => e.createdBy);
      for (const u of await m.db.prisma.user.findMany({ where: { id: { in: proxies } }, select: { id: true, name: true } })) expect(b.users.get(u.id)?.name).toBe(u.name);
    }
  });

  it("정산·할 일·최근 입력 지출 칸", async () => {
    const projects = await m.db.prisma.project.findMany({ select: { id: true } });
    const users = await m.db.prisma.user.findMany({ select: { id: true } });
    const months = [...new Set((await m.db.prisma.expense.findMany({ select: { yearMonth: true } })).map((e) => e.yearMonth))].sort();
    for (const { id } of projects) {
      for (const payer of [undefined, users[1]?.id]) {
        const a = await m.db.prisma.expense.findMany({
          where: { projectId: { in: [id] }, yearMonth: { in: months }, ...(payer ? { payerId: payer } : {}) },
          select: { amount: true, payMethod: true, isHq: true, payerId: true, itemId: true, yearMonth: true },
        });
        expect(await m.sql.sqlSettlementExpenses([id], months, payer)).toEqual(a);
      }
      for (const ym of [months[0], months[Math.floor(months.length / 2)], "2099-12"]) {
        const a = await m.db.prisma.expense.findMany({ where: { projectId: { in: [id] }, yearMonth: { lte: ym } }, select: { id: true, projectId: true, date: true, itemId: true, payerId: true, yearMonth: true, isHq: true, payMethod: true, flags: true, justification: true } });
        expect(await m.sql.sqlTodoExpenses([id], ym)).toEqual(a);
      }
      for (const u of users.slice(0, 5)) {
        const a = await m.db.prisma.expense.findMany({ where: { projectId: id, payerId: u.id }, orderBy: { createdAt: "desc" }, take: 20, select: { itemId: true, detail: true, attendees: true, headcount: true, hasExternal: true, amount: true } });
        expect(await m.sql.sqlRecentInputs(id, u.id, 20)).toEqual(a);
      }
    }
  });

  it("출입증 명세 + 모든 줄", async () => {
    const sts = await m.db.prisma.passStatement.findMany({ select: { projectId: true, yearMonth: true } });
    for (const { projectId, yearMonth } of sts) {
      const a = await m.db.prisma.passStatement.findUnique({ where: { projectId_yearMonth: { projectId, yearMonth } }, include: { lines: true } });
      const b = await m.sql.sqlStatementWithLines(projectId, yearMonth);
      expect(b).toEqual(a);
      expect(b!.lines.map((l) => l.id)).toEqual(a!.lines.map((l) => l.id));
      if (a!.lines.length) expect(keysOf(b!.lines[0])).toBe(keysOf(a!.lines[0]));
    }
    expect(await m.sql.sqlStatementWithLines("없는-id", "2026-01")).toBeNull();
  });
});

describe("DB 값 읽기 (D1·SQLite 형식)", () => {
  it("날짜: D1 글자·SQLite 밀리초·기본값 형식", async () => {
    const { sqlDate } = await import("@/lib/db");
    const iso = "2026-03-31T00:00:00.000Z";
    expect(sqlDate("2026-03-31T00:00:00.000+00:00")?.toISOString()).toBe(iso);
    expect(sqlDate(Date.parse(iso))?.toISOString()).toBe(iso);
    expect(sqlDate(BigInt(Date.parse(iso)))?.toISOString()).toBe(iso);
    expect(sqlDate("2026-03-31 00:00:00")?.toISOString()).toBe(iso); // CURRENT_TIMESTAMP 기본값
    expect(sqlDate("2026-03-31")?.toISOString()).toBe(iso);
    expect(sqlDate("2026-03-31T09:00:00+09:00")?.toISOString()).toBe(iso);
    expect(sqlDate("2026-03-31T09:00:00+0900")?.toISOString()).toBe(iso);
    expect(sqlDate(null)).toBeNull();
  });
  it("참/거짓·정수", async () => {
    const { sqlBool, sqlInt } = await import("@/lib/db");
    expect([sqlBool(1), sqlBool(0), sqlBool(true), sqlBool("1"), sqlBool("false"), sqlBool(BigInt(1))]).toEqual([true, false, true, true, false, true]);
    expect([sqlInt(3), sqlInt(BigInt(5000000000)), sqlInt("7"), sqlInt(null)]).toEqual([3, 5000000000, 7, null]);
  });
});
