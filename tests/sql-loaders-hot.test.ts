// 현황·지출 입력 화면의 직접 SQL 조회(lib/sql-loaders.ts)가 예전 Prisma 조회와 같은 결과인지 대조한다.
// e2e.db를 임시 파일로 복사(VACUUM INTO)한 뒤 경계 사례(같은 순서 값·비활성·반려/승인 취소·확정 전 명세·본사 지출·목록 외 결제자)를
// Prisma로 넣고 비교한다. e2e.db·dev.db는 바꾸지 않는다. e2e.db가 없으면 건너뛴다.
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-sqlhot-${process.pid}-${Date.now()}.db`);
if (has) {
  const src = new DatabaseSync(SRC, { readOnly: true });
  src.exec(`VACUUM INTO '${TMP.replace(/'/g, "''")}'`);
  src.close();
  process.env.DATABASE_URL = `file:${TMP.split(path.sep).join("/")}`;
}

type Mod = { db: typeof import("@/lib/db"); sql: typeof import("@/lib/sql-loaders") };
let m: Mod;
let P = ""; // 경계 사례를 넣은 프로젝트
let P2 = ""; // 취합용 다른 프로젝트
let manager = "";
let rejectedIds: string[] = [];

const byKey = <T>(list: T[], key: (x: T) => string) => [...list].sort((a, b) => key(a).localeCompare(key(b)));

beforeAll(async () => {
  if (!has) return;
  m = { db: await import("@/lib/db"), sql: await import("@/lib/sql-loaders") };
  const p = m.db.prisma;
  const projects = await p.project.findMany({ orderBy: { startDate: "asc" }, select: { id: true } });
  const withItems = [];
  for (const x of projects) if (await p.item.count({ where: { projectId: x.id } })) withItems.push(x.id);
  [P, P2] = withItems;
  const users = await p.user.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  manager = users[0].id;
  const items = await p.item.findMany({ where: { projectId: P }, orderBy: { id: "asc" } });
  const cat = items[0].categoryId;

  // 항목: 같은 분류·같은 순서 값(이름으로 정렬), 비활성, 한도 칸
  await p.item.create({ data: { projectId: P, categoryId: cat, name: "가 테스트 항목", order: 0, perPersonLimit: 15000, perCaseLimit: 300000, hardBudget: true, needsAttendees: false } });
  await p.item.create({ data: { projectId: P, categoryId: cat, name: "나 테스트 항목", order: 0, keywords: "a,b", accountCode: "복리후생비" } });
  await p.item.create({ data: { projectId: P, categoryId: cat, name: "다 비활성 항목", order: 0, active: false } });
  // 공통 기본 항목 (projectId 없음)
  await p.item.create({ data: { projectId: null, categoryId: cat, name: "공통 테스트 항목", order: 5 } });

  // 협력 인력: 같은 순서 값·비활성·소속 없음
  for (const [name, company, active, order] of [["홍길동", "협력사A", true, 1], ["김철수", null, true, 1], ["이영희", "협력사B", false, 0], ["박민수", null, true, 0]] as const) {
    await p.projectPartner.create({ data: { projectId: P, name, company, active, order } });
  }

  // 변경계약 과업 (담당자 있음·없음) + 과업 항목
  const c1 = await p.contractChange.create({ data: { projectId: P, seq: 7, title: "테스트 과업 7", signedAt: new Date(), startDate: new Date(), endDate: new Date(), managerId: manager } });
  const c2 = await p.contractChange.create({ data: { projectId: P, seq: 3, title: "테스트 과업 3", signedAt: new Date(), startDate: new Date(), endDate: new Date() } });
  await p.changeItem.create({ data: { changeId: c1.id, itemId: items[0].id } });
  await p.changeItem.create({ data: { changeId: c1.id, itemId: items[1]?.id ?? items[0].id } }).catch(() => undefined);

  // 묶음 예산 행 (입력 항목 근거 대조용)
  await p.budgetLine.create({ data: { projectId: P, itemId: items[0].id, detail: "묶음 테스트", unitPrice: 1000, periods: 1, planned: 1000, order: 99, bundleItemIds: JSON.stringify([items[1]?.id ?? items[0].id]) } });

  // 팀원 노출 항목
  await p.memberItem.createMany({ data: items.slice(0, 2).map((i) => ({ projectId: P, itemId: i.id })) }).catch(() => undefined);

  // 반려 마감: 승인 취소로 돌아온 것 / 반려만 된 것 / 기록 없는 것
  const yms = ["2001-01", "2001-02", "2001-03"];
  rejectedIds = [];
  for (const ym of yms) rejectedIds.push((await p.monthlyClosing.create({ data: { projectId: P, yearMonth: ym, status: "REJECTED" } })).id);
  const t = Date.UTC(2001, 0, 1);
  await p.auditLog.createMany({
    data: [
      { entity: "MonthlyClosing", entityId: rejectedIds[0], action: "reject", userId: manager, createdAt: new Date(t) },
      { entity: "MonthlyClosing", entityId: rejectedIds[0], action: "revoke", userId: manager, createdAt: new Date(t + 1000) },
      { entity: "MonthlyClosing", entityId: rejectedIds[1], action: "revoke", userId: manager, createdAt: new Date(t) },
      { entity: "MonthlyClosing", entityId: rejectedIds[1], action: "reject", userId: manager, createdAt: new Date(t + 1000) },
      { entity: "MonthlyClosing", entityId: rejectedIds[1], action: "submit", userId: manager, createdAt: new Date(t + 2000) },
    ],
  });

  // 확정 전 출입증 명세: 회사 부담 요청(미결정·결정됨)·직원 미확인 줄 / 확정된 명세
  const open = await p.passStatement.create({ data: { projectId: P, yearMonth: "2001-05", fileName: "t.xlsx", uploadedBy: manager } });
  const done = await p.passStatement.create({ data: { projectId: P, yearMonth: "2001-04", fileName: "t.xlsx", uploadedBy: manager, status: "CONFIRMED" } });
  const line = (statementId: string, x: { userId?: string | null; memberClaim?: string | null; decision?: string | null }) =>
    ({ statementId, holderName: "홍", amount: 5000, userId: x.userId ?? null, memberClaim: x.memberClaim ?? null, decision: x.decision ?? null });
  await p.passStatementLine.createMany({
    data: [
      line(open.id, { userId: manager, memberClaim: "OVERTIME" }), line(open.id, { userId: manager, memberClaim: "OVERTIME" }),
      line(open.id, { userId: manager, memberClaim: "OVERTIME", decision: "DEDUCT" }), line(open.id, { userId: null }), line(open.id, { userId: null, memberClaim: "OVERTIME" }),
      line(done.id, { userId: null, memberClaim: "OVERTIME" }),
    ],
  });

  // 지출: 본사 지출(제외 대상)·목록 외 결제자
  const outsider = users[users.length - 1].id;
  for (const [payerId, isHq, amount] of [[manager, true, 70000], [manager, false, 12000], [outsider, false, 33000], [outsider, false, 1]] as const) {
    await p.expense.create({ data: { projectId: P, payerId, date: new Date(Date.UTC(2001, 5, 3)), amount, payMethod: isHq ? "HQ" : "PERSONAL_CARD", itemId: items[0].id, detail: "테스트", isHq, yearMonth: "2001-06", createdBy: manager } });
  }
}, 60_000);

afterAll(async () => {
  if (!has) return;
  await (m.db.prisma as unknown as { $disconnect(): Promise<void> }).$disconnect();
  try { rmSync(TMP, { force: true }); } catch { /* 잠금 해제 전이면 OS 임시 폴더 정리에 맡긴다 */ }
});

describe.skipIf(!has)("현황·지출 입력 직접 SQL = 예전 Prisma 조회", () => {
  it("분류 + 사용 중 항목 (getMaster)", async () => {
    const { PASS_CATEGORY_ID } = await import("@/lib/pass-category");
    for (const projectId of [P, P2, null]) {
      const cats = await m.db.prisma.category.findMany({
        where: { id: { not: PASS_CATEGORY_ID } },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        include: { items: { where: { active: true, projectId }, orderBy: [{ order: "asc" }, { name: "asc" }] } },
      });
      const a = cats.map((c) => ({
        id: c.id, name: c.name,
        items: c.items.map((i) => ({ id: i.id, name: i.name, keywords: i.keywords, accountCode: i.accountCode, perPersonLimit: i.perPersonLimit, perCaseLimit: i.perCaseLimit, hardBudget: i.hardBudget, needsAttendees: i.needsAttendees })),
      }));
      expect(await m.sql.sqlMasterCategories(projectId, PASS_CATEGORY_ID)).toEqual(a);
    }
  });

  it("입력 항목 근거 (예산 행·팀원 지출 항목·과업 담당 항목) — 한 번의 조회", async () => {
    const ids = [P, P2];
    const [lines, mi, ci] = await Promise.all([
      m.db.prisma.budgetLine.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, itemId: true, bundleItemIds: true } }),
      m.db.prisma.memberItem.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, itemId: true } }),
      m.db.prisma.changeItem.findMany({ where: { change: { projectId: { in: ids }, managerId: { not: null } } }, select: { itemId: true, change: { select: { projectId: true, managerId: true } } } }),
    ]);
    const a = [
      ...lines.map((l) => ({ projectId: l.projectId, kind: "budget", itemId: l.itemId, bundleItemIds: l.bundleItemIds, managerId: null })),
      ...mi.map((x) => ({ projectId: x.projectId, kind: "member", itemId: x.itemId, bundleItemIds: null, managerId: null })),
      ...ci.map((x) => ({ projectId: x.change.projectId, kind: "change", itemId: x.itemId, bundleItemIds: null, managerId: x.change.managerId })),
    ];
    const key = (x: { projectId: string; kind: string; itemId: string; bundleItemIds: string | null; managerId: string | null }) => JSON.stringify([x.projectId, x.kind, x.itemId, x.bundleItemIds, x.managerId]);
    const b = await m.sql.sqlInputSources(ids);
    expect(a.some((x) => x.kind === "change") && a.some((x) => x.kind === "member") && a.some((x) => x.bundleItemIds)).toBe(true);
    expect(byKey(b, key)).toEqual(byKey(a, key));
    expect(await m.sql.sqlInputSources([])).toEqual([]);
  });

  it("팀원 노출 항목·개수, 변경계약 과업, 협력 인력", async () => {
    for (const projectId of [P, P2]) {
      const mi = await m.db.prisma.memberItem.findMany({ where: { projectId }, select: { itemId: true } });
      expect(await m.sql.sqlMemberItemIds(projectId)).toEqual(mi.map((x) => x.itemId));
      for (const managerId of [null, manager, "없는-사람"]) {
        const a = await m.db.prisma.contractChange.findMany({
          where: { projectId, ...(managerId ? { managerId } : {}) }, orderBy: { seq: "asc" },
          select: { id: true, seq: true, title: true, items: { select: { itemId: true } } },
        });
        const b = await m.sql.sqlContractChanges(projectId, managerId);
        expect(b.map((c) => ({ ...c, items: byKey(c.items, (i) => i.itemId) }))).toEqual(a.map((c) => ({ ...c, items: byKey(c.items, (i) => i.itemId) })));
      }
      const pa = await m.db.prisma.projectPartner.findMany({ where: { projectId, active: true }, orderBy: { order: "asc" }, select: { name: true, company: true } });
      expect(await m.sql.sqlActivePartners(projectId)).toEqual(pa);
    }
    expect((await m.sql.sqlActivePartners(P)).length).toBe(3);
  });

  it("예산 집계 예산 행·항목(분류 순서 → 항목 순서)·하위 기간", async () => {
    const { DASH_LINE_SELECT, DASH_ITEM_SELECT, DASH_ITEM_ORDER } = await import("@/lib/reports");
    for (const ids of [[P], [P, P2], [P2]]) {
      const lines = await m.db.prisma.budgetLine.findMany({ where: { projectId: { in: ids } }, select: DASH_LINE_SELECT });
      expect(byKey(await m.sql.sqlDashLines(ids), (l) => JSON.stringify(l))).toEqual(byKey(lines, (l) => JSON.stringify(l)));
      const items = await m.db.prisma.item.findMany({ where: { projectId: { in: ids } }, select: DASH_ITEM_SELECT, orderBy: [...DASH_ITEM_ORDER] });
      expect(await m.sql.sqlDashItems(ids)).toEqual(items);
      const periods = await m.db.prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, startDate: true, endDate: true } });
      expect(byKey(await m.sql.sqlProjectPeriods(ids), (x) => x.id)).toEqual(byKey(periods, (x) => x.id));
    }
    expect(await m.sql.sqlDashLines([])).toEqual([]);
    expect(await m.sql.sqlProjectPeriods([])).toEqual([]);
  });

  it("결제자별 그 달 사용 (본사 지출 제외)·사용자 이름·소속", async () => {
    const months = await m.db.prisma.expense.findMany({ where: { projectId: { in: [P, P2] } }, select: { yearMonth: true }, distinct: ["yearMonth"] });
    for (const ids of [[P], [P, P2]]) {
      for (const { yearMonth } of months) {
        const g = await m.db.prisma.expense.groupBy({ by: ["payerId"], where: { projectId: { in: ids }, yearMonth, isHq: false }, _sum: { amount: true }, _count: true });
        const a = g.map((x) => ({ payerId: x.payerId, amount: m.db.toNumber(x._sum.amount), count: x._count }));
        expect(byKey(await m.sql.sqlPayerMonthSums(ids, yearMonth), (x) => x.payerId)).toEqual(byKey(a, (x) => x.payerId));
      }
    }
    const june = await m.sql.sqlPayerMonthSums([P], "2001-06");
    expect(june.find((x) => x.payerId === manager)).toEqual({ payerId: manager, amount: 12000, count: 1 });
    const ids = (await m.db.prisma.user.findMany({ select: { id: true } })).map((u) => u.id);
    const a = await m.db.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, position: true, department: { select: { name: true } } } });
    expect(byKey(await m.sql.sqlUserInfo(ids), (u) => u.id)).toEqual(byKey(a, (u) => u.id));
    expect(await m.sql.sqlUserInfo([])).toEqual([]);
  });

  it("할 일: 확정 전 출입증 명세 (예전 pendingPassChecks)", async () => {
    const projects = (await m.db.prisma.project.findMany({ select: { id: true } })).map((x) => x.id);
    for (const projectId of projects) {
      const rows = await m.db.prisma.passStatement.findMany({
        where: { projectId, status: "OPEN" },
        select: { id: true, yearMonth: true, _count: { select: { lines: { where: { decision: null, memberClaim: "OVERTIME" } } } } },
        orderBy: { yearMonth: "asc" },
      });
      const unmatched = await m.db.prisma.passStatementLine.groupBy({ by: ["statementId"], where: { statementId: { in: rows.map((r) => r.id) }, userId: null }, _count: true });
      const um = new Map(unmatched.map((u) => [u.statementId, u._count]));
      const a = rows.map((r) => ({ ym: r.yearMonth, count: r._count.lines, unmatched: um.get(r.id) ?? 0 }));
      expect(await m.sql.sqlPendingPassChecks(projectId)).toEqual(a);
    }
    expect((await m.sql.sqlPendingPassChecks(P)).find((x) => x.ym === "2001-05")).toEqual({ ym: "2001-05", count: 3, unmatched: 2 });
  });

  it("마감 반려·승인 취소 기록 → 승인 취소로 돌아온 달", async () => {
    const all = (await m.db.prisma.monthlyClosing.findMany({ where: { status: "REJECTED" }, select: { id: true } })).map((c) => c.id);
    for (const ids of [rejectedIds, all, []]) {
      const a = await m.db.prisma.auditLog.findMany({
        where: { entity: "MonthlyClosing", entityId: { in: ids }, action: { in: ["reject", "revoke"] } },
        orderBy: { createdAt: "desc" },
        select: { entityId: true, action: true },
      });
      const b = await m.sql.sqlClosingReviewLogs(ids);
      // 마감마다 가장 최근 기록(승인 취소 판정에 쓰는 값)이 같아야 한다
      const latest = (list: { entityId: string; action: string }[]) => { const r = new Map<string, string>(); for (const l of list) if (!r.has(l.entityId)) r.set(l.entityId, l.action); return [...r].sort(); };
      expect(latest(b)).toEqual(latest(a));
      expect(byKey(b, (x) => x.entityId + x.action)).toEqual(byKey(a, (x) => x.entityId + x.action));
    }
    const { revokedClosingIds } = await import("@/lib/closing-server");
    expect([...(await revokedClosingIds(rejectedIds))]).toEqual([rejectedIds[0]]);
  });

  it("메인과 함께 상신하는 서브: 마감 행(메인 우선)·할 일 지출(서브 포함)·프로젝트 칸이 Prisma 조회와 같다", async () => {
    const p = m.db.prisma;
    const { mergeSettleClosings } = await import("@/lib/settle-group");
    // 가상: 연속 사업 1·2차 메인 + 1차에 연결된 함께 상신 서브(연차를 걸침) + 따로 상신하는 서브
    const series = await p.projectSeries.create({ data: { name: "가상 연속 사업" } });
    const r1 = await p.project.create({ data: { name: "가상 메인 1차", seriesId: series.id, round: 1, startDate: new Date(Date.UTC(2003, 0, 1)), endDate: new Date(Date.UTC(2003, 11, 31)), fiscalStart: 1, excelPrefix: "운영" } });
    const r2 = await p.project.create({ data: { name: "가상 메인 2차", seriesId: series.id, round: 2, startDate: new Date(Date.UTC(2004, 0, 1)), endDate: new Date(Date.UTC(2004, 11, 31)), fiscalStart: 1 } });
    const sub = await p.project.create({ data: { name: "가상 대응", parentId: r1.id, settleWithParent: true, excelPrefix: "대응", startDate: new Date(Date.UTC(2003, 6, 1)), endDate: new Date(Date.UTC(2004, 5, 30)), fiscalStart: 7 } });
    const solo = await p.project.create({ data: { name: "가상 따로", parentId: r1.id, startDate: new Date(Date.UTC(2003, 0, 1)), endDate: new Date(Date.UTC(2003, 11, 31)), fiscalStart: 1 } });
    const close = (projectId: string, yearMonth: string, status: string) => p.monthlyClosing.create({ data: { projectId, yearMonth, status, reviewNote: status === "REJECTED" ? "가상 사유" : null } });
    await close(sub.id, "2003-07", "APPROVED"); // 함께 상신 설정 전 서브 자신의 마감
    await close(sub.id, "2003-08", "CLOSED");
    await close(r1.id, "2003-08", "SUBMITTED");
    await close(r1.id, "2003-09", "REJECTED");
    await close(r2.id, "2004-02", "CLOSED");
    await close(solo.id, "2003-10", "CLOSED");
    for (const id of [sub.id, solo.id, r1.id, r2.id]) {
      const own = await p.monthlyClosing.findMany({ where: { projectId: id }, select: { id: true, yearMonth: true, status: true, reviewNote: true } });
      // Prisma: 서브의 메인 후보 = 직접 상위 + 그 연속 사업의 연차 (함께 상신하는 서브일 때만)
      const node = await p.project.findUniqueOrThrow({ where: { id }, select: { parentId: true, settleWithParent: true } });
      const parents = node.parentId && node.settleWithParent
        ? await p.monthlyClosing.findMany({
          where: { project: { OR: [{ id: node.parentId }, { series: { is: { projects: { some: { id: node.parentId } } } } }] } },
          select: { id: true, yearMonth: true, status: true, reviewNote: true },
        })
        : [];
      const expected = parents.length ? mergeSettleClosings(own, parents) : own;
      expect(byKey(await m.sql.sqlClosingRows(id), (c) => c.yearMonth)).toEqual(byKey(expected, (c) => c.yearMonth));
    }
    expect((await m.sql.sqlClosingRows(sub.id)).map((c) => `${c.yearMonth}:${c.status}`)).toEqual(["2003-07:APPROVED", "2003-08:SUBMITTED", "2003-09:REJECTED", "2004-02:CLOSED"]);
    // 할 일 지출: 메인 + 서브 (IN)
    for (const ym of ["2001-06", "2099-12"]) {
      const a = await p.expense.findMany({ where: { projectId: { in: [P, P2] }, yearMonth: { lte: ym } }, select: { id: true, projectId: true, date: true, itemId: true, payerId: true, yearMonth: true, isHq: true, payMethod: true, flags: true, justification: true } });
      expect(byKey(await m.sql.sqlTodoExpenses([P, P2], ym), (e) => e.id)).toEqual(byKey(a, (e) => e.id));
    }
    expect(await m.sql.sqlTodoExpenses([], "2099-12")).toEqual([]);
    // 프로젝트 칸 (함께 상신·엑셀 구분명)
    expect(await m.sql.sqlProjectById(sub.id)).toEqual(await p.project.findUnique({ where: { id: sub.id } }));
    expect((await m.sql.sqlAllProjects()).find((x) => x.id === sub.id)).toMatchObject({ settleWithParent: true, excelPrefix: "대응", parentId: r1.id });
  });
});

// 출입증 회사 부담 줄 (예산 집행 합산·중복 의심·팀원 내역) — 현황·지출 입력이 함께 쓰는 직접 SQL
describe.skipIf(!has)("출입증 회사 부담 줄 직접 SQL = Prisma 조회", () => {
  let other = "";
  beforeAll(async () => {
    const p = m.db.prisma;
    const items = await p.item.findMany({ where: { projectId: P, categoryId: { not: "client-pass" } }, orderBy: { id: "asc" } });
    await p.category.upsert({ where: { id: "client-pass" }, create: { id: "client-pass", name: "업체 출입증", order: 900 }, update: {} });
    const linked = await p.item.create({ data: { projectId: P, categoryId: "client-pass", name: "가상 야근식대(출입증)", linkedItemId: items[0].id } });
    const loose = await p.item.create({ data: { projectId: P, categoryId: "client-pass", name: "가상 커피(출입증)" } });
    const users = await p.user.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 3 });
    other = users[1]?.id ?? manager;
    const open = await p.passStatement.create({ data: { projectId: P, yearMonth: "2001-07", fileName: "t.xlsx", uploadedBy: manager } });
    const done = await p.passStatement.create({ data: { projectId: P, yearMonth: "2001-08", fileName: "t.xlsx", uploadedBy: manager, status: "CONFIRMED" } });
    const ln = (statementId: string, order: number, x: Record<string, unknown>) => ({ statementId, order, holderName: "가상", amount: 1000 + order, userId: manager, date: new Date(Date.UTC(2001, 6, order + 1)), ...x });
    await p.passStatementLine.createMany({
      data: [
        ln(open.id, 1, { decision: "OVERTIME", usageItemId: linked.id }),
        ln(open.id, 2, { memberClaim: "OVERTIME", usageItemId: linked.id, userId: other }),
        ln(open.id, 3, { decision: "DEDUCT", memberClaim: "OVERTIME", usageItemId: linked.id }), // 제외
        ln(open.id, 4, { memberClaim: "OVERTIME" }), // 항목 없음 → 제외
        ln(open.id, 5, { decision: "OVERTIME", usageItemId: loose.id, date: null, placeType: "카페", time: "15:00:00" }),
        ln(done.id, 1, { decision: "OVERTIME", usageItemId: linked.id, onBehalfName: "외부 가상" }),
        ln(done.id, 2, { decision: "OVERTIME", usageItemId: linked.id, sheetName: "식당" }),
        ln(done.id, 3, { decision: "DEDUCT", usageItemId: linked.id }), // 제외
      ],
    });
  }, 60_000);

  /** 같은 조건의 Prisma 조회 → 같은 모양 */
  async function viaPrisma(ids: string[], o: { userId?: string; yearMonths?: string[] } = {}) {
    const p = m.db.prisma;
    const rows = await p.passStatementLine.findMany({
      where: {
        statement: { projectId: { in: ids }, ...(o.yearMonths ? { yearMonth: { in: o.yearMonths } } : {}) },
        ...(o.userId ? { userId: o.userId } : {}),
        usageItemId: { not: null },
        OR: [{ decision: "OVERTIME" }, { decision: null, memberClaim: "OVERTIME" }],
      },
      include: { statement: true, usageItem: true, user: true },
      orderBy: [{ statement: { yearMonth: "asc" } }, { order: "asc" }, { id: "asc" }],
    });
    const linkIds = [...new Set(rows.map((r) => r.usageItem!.linkedItemId).filter((x): x is string => !!x))];
    const links = new Map((await p.item.findMany({ where: { id: { in: linkIds } }, include: { category: true } })).map((i) => [i.id, i]));
    return rows.map((r) => {
      const b = r.usageItem!.linkedItemId ? links.get(r.usageItem!.linkedItemId) : undefined;
      return {
        id: r.id, projectId: r.statement.projectId, yearMonth: r.statement.yearMonth, confirmed: r.statement.status === "CONFIRMED",
        userId: r.userId, date: r.date ? r.date.toISOString().slice(0, 10) : null, amount: r.amount, decision: r.decision, memberClaim: r.memberClaim,
        onBehalfName: r.onBehalfName, usageItemId: r.usageItemId!, usageItemName: r.usageItem!.name, limit: r.usageItem!.perPersonLimit,
        linkedItemId: b?.id ?? null, linkedItemName: b?.name ?? null, linkedCategoryName: b?.category.name ?? null,
        placeType: r.placeType ?? r.sheetName, place: r.place, time: r.time,
        vendor: r.vendor, userName: r.user?.name ?? null, userPosition: r.user?.position ?? null,
      };
    });
  }

  it("전체·사람별·명세 월별이 같다", async () => {
    for (const ids of [[P], [P, P2], [P2]]) {
      expect(await m.sql.sqlPassCompanyLines(ids)).toEqual(await viaPrisma(ids));
      for (const userId of [manager, other]) {
        for (const yearMonths of [undefined, ["2001-07"], ["2001-07", "2001-08"], ["2099-01"]]) {
          expect(await m.sql.sqlPassCompanyLines(ids, { userId, yearMonths })).toEqual(await viaPrisma(ids, { userId, yearMonths }));
        }
      }
    }
    expect(await m.sql.sqlPassCompanyLines([])).toEqual([]);
    expect(await m.sql.sqlPassCompanyLines([P], { yearMonths: [] })).toEqual([]);
  });

  it("경계 사례: 본인 부담·항목 없음은 빠지고, 연결 없는 항목은 연결 칸이 비고, 구분은 시트 이름으로", async () => {
    const list = (await m.sql.sqlPassCompanyLines([P], { yearMonths: ["2001-07", "2001-08"] })).filter((l) => l.usageItemName.startsWith("가상"));
    expect(list.map((l) => [l.yearMonth, l.amount, l.confirmed])).toEqual([
      ["2001-07", 1001, false], ["2001-07", 1002, false], ["2001-07", 1005, false], ["2001-08", 1001, true], ["2001-08", 1002, true],
    ]);
    expect(list[2]).toMatchObject({ linkedItemId: null, linkedItemName: null, date: null, placeType: "카페" });
    expect(list[4]).toMatchObject({ placeType: "식당", linkedCategoryName: expect.any(String) });
    // 예산 집행: 확정분(외부인 대납 포함) 2건, 확정 전(결정·요청) 연결 항목 2건
    const { passBudgetSpend } = await import("@/lib/pass-budget");
    const r = passBudgetSpend(list);
    expect(r.confirmedRows).toEqual([{ projectId: P, itemId: list[0].linkedItemId, yearMonth: "2001-08", amount: 2003, count: 2 }]);
    expect(r.pendingByItem).toEqual({ [list[0].linkedItemId!]: 2003 });
  });
});

// 팀원 내 지출 내역의 출입증 탭 (현황 — Prisma 없이 도는 화면): 명세 월·명세 줄·회사 부담 항목·업체별 줄 수·업체 서식
describe.skipIf(!has)("출입증 탭(내 지출 내역) 직접 SQL = Prisma 조회", () => {
  let other = "";
  beforeAll(async () => {
    const p = m.db.prisma;
    await p.category.upsert({ where: { id: "client-pass" }, create: { id: "client-pass", name: "업체 출입증", order: 900 }, update: {} });
    // 회사 부담 항목: 같은 순서 값(이름순)·비활성·한도
    const item = await p.item.create({ data: { projectId: P, categoryId: "client-pass", name: "가 가상 야근(출입증)", order: 0, perPersonLimit: 12000 } });
    await p.item.create({ data: { projectId: P, categoryId: "client-pass", name: "나 가상 간식(출입증)", order: 0 } });
    await p.item.create({ data: { projectId: P, categoryId: "client-pass", name: "다 가상 중지(출입증)", order: 0, active: false } });
    const users = await p.user.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 3 });
    other = users[2]?.id ?? users[1]?.id ?? manager;
    const st = await p.passStatement.create({ data: { projectId: P, yearMonth: "2001-09", fileName: "t.xlsx", uploadedBy: manager, confirmedBy: other } });
    const ln = (order: number, x: Record<string, unknown>) => ({ statementId: st.id, order, holderName: "가상", amount: 2000 + order, userId: manager, date: new Date(Date.UTC(2001, 8, order + 1)), ...x });
    await p.passStatementLine.createMany({
      data: [
        ln(1, { vendor: "가상업체A", memberClaim: "OVERTIME", usageItemId: item.id, memberNote: "가상 사유", time: "19:10:00", placeType: "식당", extra: JSON.stringify([{ label: "메뉴", value: "가상" }]) }),
        ln(2, { vendor: "가상업체A", decision: "DEDUCT" }),
        ln(3, { vendor: "가상업체B", userId: other, decision: "OVERTIME", usageItemId: item.id, decisionSource: "PM" }),
        ln(4, { vendor: null, userId: null, date: null }),
        ln(4, { vendor: "가상업체A", onBehalfName: "외부 가상", collectFrom: "외부 가상" }), // 같은 순서 값
      ],
    });
    // 업체 서식: 최근 저장 순 → 업체 이름
    const t = new Date(Date.UTC(2001, 8, 30));
    for (const [vendorName, periodStartDay, updatedAt] of [["가상업체B", 21, t], ["가상업체A", 1, t], ["가상업체C", 5, new Date(t.getTime() - 1000)]] as const) {
      await p.passImportProfile.create({ data: { projectId: P, vendorName, periodStartDay, sheets: "[]", updatedBy: manager, updatedAt } });
    }
  }, 60_000);

  it("명세 월: 전체 / 그 사람 줄이 있는 달만 (최근 달부터)", async () => {
    for (const projectId of [P, P2]) {
      for (const userId of [undefined, manager, other, "없는-사람"]) {
        const a = await m.db.prisma.passStatement.findMany({
          where: { projectId, ...(userId ? { lines: { some: { userId } } } : {}) },
          select: { yearMonth: true, status: true },
          orderBy: { yearMonth: "desc" },
        });
        expect(await m.sql.sqlPassStatementMonths(projectId, userId)).toEqual(a);
      }
    }
    expect((await m.sql.sqlPassStatementMonths(P, other)).map((x) => x.yearMonth)).toContain("2001-09");
  });

  it("그 달 명세 + 줄(직원·회사 부담 항목 이름): 전체 / 본인 줄만", async () => {
    const months = (await m.db.prisma.passStatement.findMany({ where: { projectId: P }, select: { yearMonth: true } })).map((x) => x.yearMonth);
    for (const yearMonth of [...months, "2099-01"]) {
      for (const userId of [undefined, manager, other]) {
        const a = await m.db.prisma.passStatement.findUnique({
          where: { projectId_yearMonth: { projectId: P, yearMonth } },
          include: { lines: { where: userId ? { userId } : {}, include: { user: { select: { name: true } }, usageItem: { select: { name: true } } }, orderBy: [{ order: "asc" }] } },
        });
        const b = await m.sql.sqlPassStatementView(P, yearMonth, userId);
        if (!a) { expect(b).toBeNull(); continue; }
        const { lines, ...st } = a;
        expect(b && { ...b, lines: byKey(b.lines, (l) => l.id) }).toEqual({ ...st, lines: byKey(lines, (l) => l.id) });
        // 줄 순서 (같은 순서 값은 id 순)
        expect(b!.lines.map((l) => l.order)).toEqual([...b!.lines.map((l) => l.order)].sort((x, y) => x - y));
      }
    }
    const mine = await m.sql.sqlPassStatementView(P, "2001-09", manager);
    expect(mine!.lines.map((l) => [l.amount, l.usageItem?.name ?? null, l.user?.name != null])).toEqual([
      [2001, "가 가상 야근(출입증)", true], [2002, null, true], [2004, null, true],
    ]);
  });

  it("회사 부담 항목(사용 중, 순서 → 이름)·업체별 줄 수·업체 서식(최근 저장 → 이름)", async () => {
    for (const projectId of [P, P2]) {
      const items = await m.db.prisma.item.findMany({
        where: { projectId, categoryId: "client-pass", active: true },
        select: { id: true, name: true, perPersonLimit: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      });
      expect(await m.sql.sqlPassItems(projectId, "client-pass")).toEqual(items);
      const profiles = await m.db.prisma.passImportProfile.findMany({ where: { projectId }, orderBy: [{ updatedAt: "desc" }, { vendorName: "asc" }] });
      expect(await m.sql.sqlPassImportProfiles(projectId)).toEqual(profiles);
      for (const yearMonth of ["2001-05", "2001-09", "2099-01"]) {
        const g = await m.db.prisma.passStatementLine.groupBy({ by: ["vendor"], where: { statement: { projectId, yearMonth } }, _count: true });
        const a = g.map((x) => ({ vendor: x.vendor, count: x._count }));
        expect(byKey(await m.sql.sqlPassVendorCounts(projectId, yearMonth), (x) => x.vendor ?? "")).toEqual(byKey(a, (x) => x.vendor ?? ""));
      }
    }
    expect((await m.sql.sqlPassItems(P, "client-pass")).filter((i) => /^[가나다] 가상/.test(i.name)).map((i) => i.name)).toEqual(["가 가상 야근(출입증)", "나 가상 간식(출입증)"]);
    expect((await m.sql.sqlPassImportProfiles(P)).map((x) => x.vendorName)).toEqual(["가상업체A", "가상업체B", "가상업체C"]);
    expect(byKey(await m.sql.sqlPassVendorCounts(P, "2001-09"), (x) => x.vendor ?? "")).toEqual([{ vendor: null, count: 1 }, { vendor: "가상업체A", count: 3 }, { vendor: "가상업체B", count: 1 }]);
  });

  it("팀원 출입증 탭 조회 (loadMyPassMonth): 요청 달 → 이번 달 → 가장 최근 달, 본인 줄만", async () => {
    const { loadMyPassMonth } = await import("@/lib/pass-statement-server");
    const user = { id: manager, role: "MEMBER", readOnly: false } as unknown as Parameters<typeof loadMyPassMonth>[0];
    const months = (await m.sql.sqlPassStatementMonths(P, manager)).map((x) => x.yearMonth).sort();
    const asked = await loadMyPassMonth(user, P, "2099-12", "2001-09");
    expect(asked.ym).toBe("2001-09");
    expect(asked.months).toEqual(months);
    expect(asked.mine.map((l) => l.amount)).toEqual([2001, 2002, 2004]);
    expect(asked.mine.every((l) => l.userId === manager)).toBe(true);
    expect(asked.data?.statement.status).toBe("OPEN");
    // 가장 많이 쓴 업체(가상업체A)의 정산 시작일
    expect(asked.startDay).toBe(1);
    // 없는 달을 고르면 가장 최근에 올라온 달
    expect((await loadMyPassMonth(user, P, "2099-12", "2098-01")).ym).toBe(months[months.length - 1]);
    // 이번 달에 명세가 있으면 이번 달
    expect((await loadMyPassMonth(user, P, "2001-05")).ym).toBe("2001-05");
    // 다른 사람 줄은 빠진다
    const otherView = await loadMyPassMonth({ ...user, id: other } as typeof user, P, "2001-09");
    expect(otherView.mine.map((l) => l.amount)).toEqual([2003]);
  });
});
