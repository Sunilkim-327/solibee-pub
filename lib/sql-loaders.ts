// 매 요청 쓰는 조회를 직접 SQL로 (서버 전용) — Prisma 쿼리 컴파일·해석 비용(운영 Workers CPU)을 줄인다.
// 결과 모양·값은 같은 조건의 Prisma 조회와 같다 (tests/sql-loaders.test.ts가 e2e.db에서 대조).
import "server-only";
import { sqlBool, sqlDate, sqlDateReq, sqlInt, sqlIntReq, sqlRows, sqlStr } from "./db";
import { isCurrentMember } from "./membership";
import type { PassCompanyLine } from "./pass-budget";
import type { InputSource } from "./input-capable";
import { settleParentsSql } from "./guarded-sql";
import { mergeSettleClosings } from "./settle-group";

type Row = Record<string, unknown>;

/** "?, ?, ?" (IN 목록) */
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

// ── 사용자 (세션 확인)

export type SessionUserRow = {
  id: string; name: string; loginId: string | null; role: string; active: boolean; sessionVersion: number; mustChangePassword: boolean;
  position: string | null; departmentId: string | null; department: { name: string } | null;
};

export async function sqlSessionUserRow(uid: string): Promise<SessionUserRow | null> {
  const [r] = await sqlRows<Row>(
    `SELECT u."id", u."name", u."loginId", u."role", u."active", u."sessionVersion", u."mustChangePassword", u."position", u."departmentId", d."name" AS "deptName"
     FROM "User" u LEFT JOIN "Department" d ON d."id" = u."departmentId" WHERE u."id" = ? LIMIT 1`,
    [uid],
  );
  if (!r) return null;
  return {
    id: String(r.id), name: String(r.name), loginId: sqlStr(r.loginId), role: String(r.role), active: sqlBool(r.active),
    sessionVersion: sqlIntReq(r.sessionVersion), mustChangePassword: sqlBool(r.mustChangePassword), position: sqlStr(r.position),
    departmentId: sqlStr(r.departmentId), department: r.departmentId != null && r.deptName != null ? { name: String(r.deptName) } : null,
  };
}

// ── 프로젝트 (모든 스칼라 열, prisma/schema.prisma 순서)

export type ProjectRowSql = {
  id: string; name: string; startDate: Date; endDate: Date; fiscalStart: number; code: string | null; parentId: string | null; departmentId: string | null;
  clientPassEnabled: boolean; clientPassName: string | null; passDisplayItems: string | null; clientPassItemIds: string | null;
  seriesId: string | null; round: number | null; closedAt: Date | null; closedBy: string | null; archivedAt: Date | null;
  settleWithParent: boolean; excelPrefix: string | null;
};

const PROJECT_COLS = `"id", "name", "startDate", "endDate", "fiscalStart", "code", "parentId", "settleWithParent", "excelPrefix", "departmentId", "clientPassEnabled", "clientPassName", "passDisplayItems", "clientPassItemIds", "seriesId", "round", "closedAt", "closedBy", "archivedAt"`;

export const toProjectRow = (r: Row): ProjectRowSql => ({
  id: String(r.id), name: String(r.name), startDate: sqlDateReq(r.startDate), endDate: sqlDateReq(r.endDate), fiscalStart: sqlIntReq(r.fiscalStart),
  code: sqlStr(r.code), parentId: sqlStr(r.parentId), settleWithParent: sqlBool(r.settleWithParent), excelPrefix: sqlStr(r.excelPrefix),
  departmentId: sqlStr(r.departmentId), clientPassEnabled: sqlBool(r.clientPassEnabled),
  clientPassName: sqlStr(r.clientPassName), passDisplayItems: sqlStr(r.passDisplayItems), clientPassItemIds: sqlStr(r.clientPassItemIds),
  seriesId: sqlStr(r.seriesId), round: sqlInt(r.round), closedAt: sqlDate(r.closedAt), closedBy: sqlStr(r.closedBy), archivedAt: sqlDate(r.archivedAt),
});

/** prisma.project.findMany({ orderBy: { startDate: "asc" } }) */
export async function sqlAllProjects(): Promise<ProjectRowSql[]> {
  return (await sqlRows<Row>(`SELECT ${PROJECT_COLS} FROM "Project" ORDER BY "startDate" ASC`)).map(toProjectRow);
}

/** prisma.project.findUnique({ where: { id } }) */
export async function sqlProjectById(id: string): Promise<ProjectRowSql | null> {
  const [r] = await sqlRows<Row>(`SELECT ${PROJECT_COLS} FROM "Project" WHERE "id" = ? LIMIT 1`, [id]);
  return r ? toProjectRow(r) : null;
}

// ── 조직

/** prisma.department.findMany({ select: { id, parentId, headId, active } }) */
export async function sqlDepartmentNodes(): Promise<{ id: string; parentId: string | null; headId: string | null; active: boolean }[]> {
  return (await sqlRows<Row>(`SELECT "id", "parentId", "headId", "active" FROM "Department"`)).map((r) => ({
    id: String(r.id), parentId: sqlStr(r.parentId), headId: sqlStr(r.headId), active: sqlBool(r.active),
  }));
}

// ── 팀원

/**
 * 사용자의 현재 팀원 정보 — prisma.projectMember.findMany({ where: { userId, ...currentMemberWhere(today) }, select: { projectId, isPm } })
 * (철수일 조건은 저장 형식이 환경마다 달라 읽은 뒤 같은 기준 isCurrentMember로 거른다)
 */
export async function sqlCurrentMemberships(userId: string, today: Date): Promise<{ projectId: string; isPm: boolean }[]> {
  const rows = await sqlRows<Row>(`SELECT "projectId", "isPm", "leftAt" FROM "ProjectMember" WHERE "userId" = ?`, [userId]);
  return rows.filter((r) => isCurrentMember({ leftAt: sqlDate(r.leftAt) }, today)).map((r) => ({ projectId: String(r.projectId), isPm: sqlBool(r.isPm) }));
}

/** 프로젝트 팀원 전체 (이전 팀원 포함) + 사용자 정보 — 결제자·참석자·할 일·PM 이름이 함께 쓴다 */
export type ProjectMemberFull = {
  projectId: string; userId: string; isPayer: boolean; isPm: boolean; leftAt: Date | null;
  user: { id: string; name: string; role: string; position: string | null; active: boolean };
};

export async function sqlProjectMembers(projectIds: string[]): Promise<ProjectMemberFull[]> {
  if (!projectIds.length) return [];
  const rows = await sqlRows<Row>(
    `SELECT pm."projectId", pm."userId", pm."isPayer", pm."isPm", pm."leftAt", u."name", u."role", u."position", u."active"
     FROM "ProjectMember" pm JOIN "User" u ON u."id" = pm."userId" WHERE pm."projectId" IN (${marks(projectIds.length)})`,
    projectIds,
  );
  return rows.map((r) => ({
    projectId: String(r.projectId), userId: String(r.userId), isPayer: sqlBool(r.isPayer), isPm: sqlBool(r.isPm), leftAt: sqlDate(r.leftAt),
    user: { id: String(r.userId), name: String(r.name), role: String(r.role), position: sqlStr(r.position), active: sqlBool(r.active) },
  }));
}

// ── 마감·예산·지출 합계

/**
 * prisma.monthlyClosing.findMany({ where: { projectId }, select: { id, yearMonth, status, reviewNote } })
 * — 메인과 함께 상신하는 서브 프로젝트면 그 달 메인의 마감 행이 우선 (lib/settle-group mergeSettleClosings). 한 번의 조회로 함께 읽는다
 */
export async function sqlClosingRows(projectId: string): Promise<{ id: string; yearMonth: string; status: string; reviewNote: string | null }[]> {
  const rows = await sqlRows<Row>(
    `SELECT "id", "yearMonth", "status", "reviewNote", "projectId" FROM "MonthlyClosing" WHERE "projectId" = ? OR "projectId" IN (${settleParentsSql("?")})`,
    [projectId, projectId],
  );
  const list = rows.map((r) => ({ id: String(r.id), yearMonth: String(r.yearMonth), status: String(r.status), reviewNote: sqlStr(r.reviewNote), projectId: String(r.projectId) }));
  const own = list.filter((r) => r.projectId === projectId);
  const merged = own.length === list.length ? own : mergeSettleClosings(own, list.filter((r) => r.projectId !== projectId));
  return merged.map((r) => ({ id: r.id, yearMonth: r.yearMonth, status: r.status, reviewNote: r.reviewNote }));
}

/** prisma.budgetLine.findMany({ where: { projectId }, select: { itemId, planned, periods, bundleItemIds }, orderBy: { order: "asc" } }) */
export async function sqlBudgetLines(projectId: string): Promise<{ itemId: string; planned: number; periods: number; bundleItemIds: string | null }[]> {
  return (await sqlRows<Row>(`SELECT "itemId", "planned", "periods", "bundleItemIds" FROM "BudgetLine" WHERE "projectId" = ? ORDER BY "order" ASC`, [projectId])).map((r) => ({
    itemId: String(r.itemId), planned: sqlIntReq(r.planned), periods: sqlIntReq(r.periods), bundleItemIds: sqlStr(r.bundleItemIds),
  }));
}

/** 프로젝트·항목·월별 지출 합계 — prisma.expense.groupBy({ by: [projectId, itemId, yearMonth], where: { projectId: { in } }, _sum: { amount } }) */
export async function sqlExpenseMonthSums(projectIds: string[]): Promise<{ projectId: string; itemId: string; yearMonth: string; amount: number }[]> {
  if (!projectIds.length) return [];
  const rows = await sqlRows<Row>(
    `SELECT "projectId", "itemId", "yearMonth", SUM("amount") AS "amount" FROM "Expense" WHERE "projectId" IN (${marks(projectIds.length)}) GROUP BY "projectId", "itemId", "yearMonth"`,
    projectIds,
  );
  return rows.map((r) => ({ projectId: String(r.projectId), itemId: String(r.itemId), yearMonth: String(r.yearMonth), amount: sqlInt(r.amount) ?? 0 }));
}

/**
 * 출입증 회사 부담 줄 (회사 부담 결정 또는 미결정 + 팀원 회사 부담 요청, 회사 부담 항목 있음) + 회사 부담 항목·연결 예산 항목 이름
 * — 예산 집행 합산·중복 의심·팀원 내역이 이 한 번의 조회를 함께 쓴다 (lib/pass-budget.ts).
 * 같은 Prisma 조회: passStatementLine.findMany({ where: { statement: { projectId: { in }, yearMonth?: { in } }, userId?, usageItemId: { not: null },
 *   OR: [{ decision: "OVERTIME" }, { decision: null, memberClaim: "OVERTIME" }] }, include: { statement, usageItem } }) (tests/sql-loaders-hot.test.ts)
 * @param o.userId 그 사람 줄만 · o.yearMonths 그 내역 월만
 */
export async function sqlPassCompanyLines(projectIds: string[], o: { userId?: string; yearMonths?: string[] } = {}): Promise<PassCompanyLine[]> {
  if (!projectIds.length || (o.yearMonths && !o.yearMonths.length)) return [];
  // D1 쿼리당 값 상한(100) — 프로젝트가 많으면 나눠 읽는다 (재무 승인 전체 프로젝트 현황)
  if (projectIds.length > 60) {
    const out: PassCompanyLine[] = [];
    for (let i = 0; i < projectIds.length; i += 60) out.push(...(await sqlPassCompanyLines(projectIds.slice(i, i + 60), o)));
    return out;
  }
  const where = [`s."projectId" IN (${marks(projectIds.length)})`, `(l."decision" = ? OR (l."decision" IS NULL AND l."memberClaim" = ?))`];
  const params: string[] = [...projectIds, "OVERTIME", "OVERTIME"];
  if (o.userId) { where.push(`l."userId" = ?`); params.push(o.userId); }
  if (o.yearMonths) { where.push(`s."yearMonth" IN (${marks(o.yearMonths.length)})`); params.push(...o.yearMonths); }
  const rows = await sqlRows<Row>(
    `SELECT l."id", s."projectId", s."yearMonth", s."status", l."userId", l."date", l."amount", l."decision", l."memberClaim", l."onBehalfName",
       l."usageItemId", i."name" AS "itemName", i."perPersonLimit" AS "limit", b."id" AS "linkedId", b."name" AS "linkedName", bc."name" AS "linkedCategoryName", l."placeType", l."sheetName", l."place", l."time",
       l."vendor", u."name" AS "userName", u."position" AS "userPosition"
     FROM "PassStatementLine" l JOIN "PassStatement" s ON s."id" = l."statementId" JOIN "Item" i ON i."id" = l."usageItemId"
     LEFT JOIN "Item" b ON b."id" = i."linkedItemId" LEFT JOIN "Category" bc ON bc."id" = b."categoryId" LEFT JOIN "User" u ON u."id" = l."userId"
     WHERE ${where.join(" AND ")} ORDER BY s."yearMonth" ASC, l."order" ASC, l."id" ASC`,
    params,
  );
  return rows.map((r) => {
    const date = sqlDate(r.date);
    return {
      id: String(r.id), projectId: String(r.projectId), yearMonth: String(r.yearMonth), confirmed: String(r.status) === "CONFIRMED",
      userId: sqlStr(r.userId), date: date ? date.toISOString().slice(0, 10) : null, amount: sqlIntReq(r.amount),
      decision: sqlStr(r.decision), memberClaim: sqlStr(r.memberClaim), onBehalfName: sqlStr(r.onBehalfName),
      usageItemId: String(r.usageItemId), usageItemName: String(r.itemName), limit: sqlInt(r.limit), linkedItemId: sqlStr(r.linkedId), linkedItemName: sqlStr(r.linkedName), linkedCategoryName: sqlStr(r.linkedCategoryName),
      placeType: sqlStr(r.placeType) ?? sqlStr(r.sheetName), place: sqlStr(r.place), time: sqlStr(r.time),
      vendor: sqlStr(r.vendor), userName: sqlStr(r.userName), userPosition: sqlStr(r.userPosition),
    };
  });
}

// ── 지출

/** IN 목록을 D1 쿼리당 값 상한(100)에 맞춰 나눠 조회한 뒤 합친다 */
async function inChunks<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const uniq = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += 90) out.push(...(await run(uniq.slice(i, i + 90))));
  return out;
}

/** 지출 목록용 지출 행 (관계 제외) */
export type ExpenseListBase = {
  id: string; projectId: string; payerId: string; date: Date; amount: number; payMethod: string; itemId: string; detail: string;
  headcount: number | null; attendees: string | null; merchant: string | null; hasExternal: boolean; flags: string | null; justification: string | null;
  isHq: boolean; changeId: string | null; yearMonth: string; createdBy: string;
};

/**
 * 지출 목록 (lib/expenses listExpenses) — Prisma 조회와 같은 조건·같은 정렬 (같은 SQL 모양이라 같은 순서).
 * 관계(결제자·입력자 이름, 항목·분류, 변경 과업)는 id 목록으로 따로 읽는다 (Prisma도 관계를 따로 읽는다).
 * @param ownUserId 본인 건만 (결제자이거나 입력자)
 * @param recent 내가 입력한 건을 최근 입력 순으로 take건
 */
export async function sqlExpenseList(o: { projectIds: string[]; yearMonth?: string; ownUserId?: string; recent?: { userId: string; take: number } }) {
  const where = [`"projectId" IN (${marks(o.projectIds.length)})`];
  const params: (string | number)[] = [...o.projectIds];
  if (o.yearMonth) { where.push(`"yearMonth" = ?`); params.push(o.yearMonth); }
  if (o.ownUserId) { where.push(`("payerId" = ? OR "createdBy" = ?)`); params.push(o.ownUserId, o.ownUserId); }
  if (o.recent) { where.push(`"createdBy" = ?`); params.push(o.recent.userId); }
  const order = o.recent ? `"createdAt" DESC, "date" DESC` : `"isHq" ASC, "date" ASC, "createdAt" ASC`;
  if (o.recent) params.push(o.recent.take);
  const rows = await sqlRows<Row>(
    `SELECT "id", "projectId", "payerId", "date", "amount", "payMethod", "itemId", "detail", "headcount", "attendees", "merchant", "hasExternal", "flags", "justification", "isHq", "changeId", "yearMonth", "createdBy"
     FROM "Expense" WHERE ${where.join(" AND ")} ORDER BY ${order}${o.recent ? " LIMIT ?" : ""}`,
    params,
  );
  const base: ExpenseListBase[] = rows.map((r) => ({
    id: String(r.id), projectId: String(r.projectId), payerId: String(r.payerId), date: sqlDateReq(r.date), amount: sqlIntReq(r.amount), payMethod: String(r.payMethod),
    itemId: String(r.itemId), detail: String(r.detail), headcount: sqlInt(r.headcount), attendees: sqlStr(r.attendees), merchant: sqlStr(r.merchant),
    hasExternal: sqlBool(r.hasExternal), flags: sqlStr(r.flags), justification: sqlStr(r.justification), isHq: sqlBool(r.isHq), changeId: sqlStr(r.changeId),
    yearMonth: String(r.yearMonth), createdBy: String(r.createdBy),
  }));
  // 결제자 + (대신 입력) 입력자 이름을 한 번에
  const userIds = [...base.map((e) => e.payerId), ...base.filter((e) => e.createdBy !== e.payerId).map((e) => e.createdBy)];
  const changeIds = base.map((e) => e.changeId).filter((x): x is string => !!x);
  const [users, items, changes] = await Promise.all([
    inChunks(userIds, (c) => sqlRows<Row>(`SELECT "id", "name", "position" FROM "User" WHERE "id" IN (${marks(c.length)})`, c)),
    inChunks(base.map((e) => e.itemId), (c) => sqlRows<Row>(
      `SELECT i."id", i."name", i."categoryId", c."name" AS "categoryName" FROM "Item" i JOIN "Category" c ON c."id" = i."categoryId" WHERE i."id" IN (${marks(c.length)})`, c)),
    inChunks(changeIds, (c) => sqlRows<Row>(`SELECT "id", "seq", "title" FROM "ContractChange" WHERE "id" IN (${marks(c.length)})`, c)),
  ]);
  return {
    rows: base,
    users: new Map(users.map((u) => [String(u.id), { name: String(u.name), position: sqlStr(u.position) }])),
    items: new Map(items.map((i) => [String(i.id), { name: String(i.name), categoryId: String(i.categoryId), categoryName: String(i.categoryName) }])),
    changes: new Map(changes.map((c) => [String(c.id), { seq: sqlIntReq(c.seq), title: String(c.title) }])),
  };
}

/** 정산용 지출 칸 — prisma.expense.findMany({ where: { projectId: { in }, yearMonth: { in: months }, payerId? }, select: { amount, payMethod, isHq, payerId, itemId, yearMonth } }) */
export async function sqlSettlementExpenses(projectIds: string[], months: string[], payerId?: string) {
  if (!projectIds.length || !months.length) return [];
  const rows = await sqlRows<Row>(
    `SELECT "amount", "payMethod", "isHq", "payerId", "itemId", "yearMonth" FROM "Expense" WHERE "projectId" IN (${marks(projectIds.length)}) AND "yearMonth" IN (${marks(months.length)})${payerId ? ` AND "payerId" = ?` : ""}`,
    [...projectIds, ...months, ...(payerId ? [payerId] : [])],
  );
  return rows.map((r) => ({ amount: sqlIntReq(r.amount), payMethod: String(r.payMethod), isHq: sqlBool(r.isHq), payerId: String(r.payerId), itemId: String(r.itemId), yearMonth: String(r.yearMonth) }));
}

/**
 * 할 일용 지출 칸 — prisma.expense.findMany({ where: { projectId: { in }, yearMonth: { lte } }, select: { id, projectId, date, itemId, payerId, yearMonth, isHq, payMethod, flags, justification } })
 * (id·날짜·항목: 출입증 중복 의심 계산 / 여러 프로젝트: 메인과 함께 상신하는 서브 포함)
 */
export async function sqlTodoExpenses(projectIds: string[], upToYm: string) {
  if (!projectIds.length) return [];
  const rows = await sqlRows<Row>(
    `SELECT "id", "projectId", "date", "itemId", "payerId", "yearMonth", "isHq", "payMethod", "flags", "justification" FROM "Expense" WHERE "projectId" IN (${marks(projectIds.length)}) AND "yearMonth" <= ?`,
    [...projectIds, upToYm],
  );
  return rows.map((r) => ({
    id: String(r.id), projectId: String(r.projectId), date: sqlDateReq(r.date), itemId: String(r.itemId),
    payerId: String(r.payerId), yearMonth: String(r.yearMonth), isHq: sqlBool(r.isHq), payMethod: String(r.payMethod), flags: sqlStr(r.flags), justification: sqlStr(r.justification),
  }));
}

/** 최근 입력(입력 폼 제안) — prisma.expense.findMany({ where: { projectId, payerId }, orderBy: { createdAt: "desc" }, take, select: { itemId, detail, attendees, headcount, hasExternal, amount } }) */
export async function sqlRecentInputs(projectId: string, payerId: string, take: number) {
  const rows = await sqlRows<Row>(
    `SELECT "itemId", "detail", "attendees", "headcount", "hasExternal", "amount" FROM "Expense" WHERE "projectId" = ? AND "payerId" = ? ORDER BY "createdAt" DESC LIMIT ?`,
    [projectId, payerId, take],
  );
  return rows.map((r) => ({ itemId: String(r.itemId), detail: String(r.detail), attendees: sqlStr(r.attendees), headcount: sqlInt(r.headcount), hasExternal: sqlBool(r.hasExternal), amount: sqlIntReq(r.amount) }));
}

// ── 출입증 내역

const LINE_TEXT = ["holderName", "holderKey", "place", "userId", "memberClaim", "memberNote", "decision", "usageItemId", "decisionSource", "decidedBy",
  "time", "cardNo", "empNo", "company", "item", "sheetName", "placeType", "vendor", "onBehalfName", "collectFrom", "collectNote", "extra", "matchKeys"] as const;

/** 내역 줄 (모든 스칼라 열, prisma/schema.prisma 순서) */
const toPassLine = (r: Row) => ({
  id: String(r.id), statementId: String(r.statementId), date: sqlDate(r.date), holderName: String(r.holderName), holderKey: sqlStr(r.holderKey), place: sqlStr(r.place),
  amount: sqlIntReq(r.amount), userId: sqlStr(r.userId), memberClaim: sqlStr(r.memberClaim), memberNote: sqlStr(r.memberNote), decision: sqlStr(r.decision),
  usageItemId: sqlStr(r.usageItemId), decisionSource: sqlStr(r.decisionSource), decidedBy: sqlStr(r.decidedBy), decidedAt: sqlDate(r.decidedAt), order: sqlIntReq(r.order),
  time: sqlStr(r.time), cardNo: sqlStr(r.cardNo), empNo: sqlStr(r.empNo), company: sqlStr(r.company), item: sqlStr(r.item), sheetName: sqlStr(r.sheetName),
  placeType: sqlStr(r.placeType), vendor: sqlStr(r.vendor), onBehalfName: sqlStr(r.onBehalfName), collectFrom: sqlStr(r.collectFrom), collectedAt: sqlDate(r.collectedAt),
  collectNote: sqlStr(r.collectNote), extra: sqlStr(r.extra), matchKeys: sqlStr(r.matchKeys),
});

/**
 * 그 달 내역 + 모든 줄 — prisma.passStatement.findUnique({ where: { projectId_yearMonth }, include: { lines: true } })
 * (줄이 수천 건일 수 있어 업로드 CPU의 큰 몫 — 직접 SQL로)
 */
export async function sqlStatementWithLines(projectId: string, yearMonth: string) {
  const [st] = await sqlRows<Row>(
    `SELECT "id", "projectId", "yearMonth", "fileName", "uploadedBy", "uploadedAt", "status", "confirmedBy", "confirmedAt" FROM "PassStatement" WHERE "projectId" = ? AND "yearMonth" = ? LIMIT 1`,
    [projectId, yearMonth],
  );
  if (!st) return null;
  const cols = ["id", "statementId", "date", ...LINE_TEXT, "amount", "decidedAt", "order", "collectedAt"].map((c) => `"${c}"`).join(", ");
  const lines = (await sqlRows<Row>(`SELECT ${cols} FROM "PassStatementLine" WHERE "statementId" = ?`, [String(st.id)])).map(toPassLine);
  return {
    id: String(st.id), projectId: String(st.projectId), yearMonth: String(st.yearMonth), fileName: String(st.fileName), uploadedBy: String(st.uploadedBy),
    uploadedAt: sqlDateReq(st.uploadedAt), status: String(st.status), confirmedBy: sqlStr(st.confirmedBy), confirmedAt: sqlDate(st.confirmedAt), lines,
  };
}

/**
 * 내역이 있는 달 (최근 달부터) — userId를 주면 그 사람 줄이 있는 달만.
 * prisma.passStatement.findMany({ where: { projectId, lines?: { some: { userId } } }, select: { yearMonth, status }, orderBy: { yearMonth: "desc" } })
 */
export async function sqlPassStatementMonths(projectId: string, userId?: string): Promise<{ yearMonth: string; status: string }[]> {
  const rows = await sqlRows<Row>(
    `SELECT s."yearMonth", s."status" FROM "PassStatement" s WHERE s."projectId" = ?${userId ? ` AND EXISTS (SELECT 1 FROM "PassStatementLine" l WHERE l."statementId" = s."id" AND l."userId" = ?)` : ""}
     ORDER BY s."yearMonth" DESC`,
    userId ? [projectId, userId] : [projectId],
  );
  return rows.map((r) => ({ yearMonth: String(r.yearMonth), status: String(r.status) }));
}

/**
 * 그 달 내역 + 줄(팀원 이름·회사 부담 항목 이름 포함, 줄 순서) — userId를 주면 그 사람 줄만 (팀원 화면).
 * prisma.passStatement.findUnique({ where: { projectId_yearMonth }, include: { lines: { where: { userId? }, include: { user: { select: { name } }, usageItem: { select: { name } } }, orderBy: { order: "asc" } } } })
 */
export async function sqlPassStatementView(projectId: string, yearMonth: string, userId?: string) {
  const [st] = await sqlRows<Row>(
    `SELECT "id", "projectId", "yearMonth", "fileName", "uploadedBy", "uploadedAt", "status", "confirmedBy", "confirmedAt" FROM "PassStatement" WHERE "projectId" = ? AND "yearMonth" = ? LIMIT 1`,
    [projectId, yearMonth],
  );
  if (!st) return null;
  const cols = ["id", "statementId", "date", ...LINE_TEXT, "amount", "decidedAt", "order", "collectedAt"].map((c) => `l."${c}"`).join(", ");
  const rows = await sqlRows<Row>(
    `SELECT ${cols}, u."name" AS "userName", i."name" AS "usageItemName"
     FROM "PassStatementLine" l LEFT JOIN "User" u ON u."id" = l."userId" LEFT JOIN "Item" i ON i."id" = l."usageItemId"
     WHERE l."statementId" = ?${userId ? ` AND l."userId" = ?` : ""} ORDER BY l."order" ASC, l."id" ASC`,
    userId ? [String(st.id), userId] : [String(st.id)],
  );
  return {
    id: String(st.id), projectId: String(st.projectId), yearMonth: String(st.yearMonth), fileName: String(st.fileName), uploadedBy: String(st.uploadedBy),
    uploadedAt: sqlDateReq(st.uploadedAt), status: String(st.status), confirmedBy: sqlStr(st.confirmedBy), confirmedAt: sqlDate(st.confirmedAt),
    lines: rows.map((r) => ({
      ...toPassLine(r),
      user: r.userName != null ? { name: String(r.userName) } : null,
      usageItem: r.usageItemName != null ? { name: String(r.usageItemName) } : null,
    })),
  };
}

/**
 * 회사 부담으로 고를 수 있는 출입증 항목 (사용 중, 순서 → 이름) —
 * prisma.item.findMany({ where: { projectId, categoryId, active: true }, select: { id, name, perPersonLimit }, orderBy: [{ order: "asc" }, { name: "asc" }] })
 */
export async function sqlPassItems(projectId: string, categoryId: string): Promise<{ id: string; name: string; perPersonLimit: number | null }[]> {
  const rows = await sqlRows<Row>(
    `SELECT "id", "name", "perPersonLimit" FROM "Item" WHERE "projectId" = ? AND "categoryId" = ? AND "active" = ? ORDER BY "order" ASC, "name" ASC`,
    [projectId, categoryId, true],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), perPersonLimit: sqlInt(r.perPersonLimit) }));
}

/** 그 달 내역의 업체별 줄 수 (정산 기간 시작일 판단) — prisma.passStatementLine.groupBy({ by: ["vendor"], where: { statement: { projectId, yearMonth } }, _count: true }) */
export async function sqlPassVendorCounts(projectId: string, yearMonth: string): Promise<{ vendor: string | null; count: number }[]> {
  const rows = await sqlRows<Row>(
    `SELECT l."vendor", COUNT(*) AS "n" FROM "PassStatementLine" l JOIN "PassStatement" s ON s."id" = l."statementId"
     WHERE s."projectId" = ? AND s."yearMonth" = ? GROUP BY l."vendor"`,
    [projectId, yearMonth],
  );
  return rows.map((r) => ({ vendor: sqlStr(r.vendor), count: sqlIntReq(r.n) }));
}

/** 업체 서식 (최근 저장 순 → 업체 이름) — prisma.passImportProfile.findMany({ where: { projectId }, orderBy: [{ updatedAt: "desc" }, { vendorName: "asc" }] }) */
export async function sqlPassImportProfiles(projectId: string): Promise<{ id: string; projectId: string; vendorName: string; periodStartDay: number; sheets: string; updatedBy: string; updatedAt: Date }[]> {
  const rows = await sqlRows<Row>(
    `SELECT "id", "projectId", "vendorName", "periodStartDay", "sheets", "updatedBy", "updatedAt" FROM "PassImportProfile" WHERE "projectId" = ? ORDER BY "updatedAt" DESC, "vendorName" ASC`,
    [projectId],
  );
  return rows.map((r) => ({
    id: String(r.id), projectId: String(r.projectId), vendorName: String(r.vendorName), periodStartDay: sqlIntReq(r.periodStartDay),
    sheets: String(r.sheets), updatedBy: String(r.updatedBy), updatedAt: sqlDateReq(r.updatedAt),
  }));
}

// ── 로그인

export type LoginUserRow = {
  id: string; role: string; passwordHash: string; authProvider: string; active: boolean; lockedUntil: Date | null; failedLogins: number;
  mustChangePassword: boolean; tempPasswordExpiresAt: Date | null; sessionVersion: number;
};

/** 로그인 아이디 또는 사번으로 — prisma.user.findFirst({ where: { OR: [{ loginId }, { employeeNo }] } }) (로그인에 쓰는 칸만) */
export async function sqlLoginUser(loginId: string, employeeNo: string): Promise<LoginUserRow | null> {
  const [r] = await sqlRows<Row>(
    `SELECT "id", "role", "passwordHash", "authProvider", "active", "lockedUntil", "failedLogins", "mustChangePassword", "tempPasswordExpiresAt", "sessionVersion"
     FROM "User" WHERE ("loginId" = ? OR "employeeNo" = ?) LIMIT 1`,
    [loginId, employeeNo],
  );
  if (!r) return null;
  return {
    id: String(r.id), role: String(r.role), passwordHash: String(r.passwordHash), authProvider: String(r.authProvider), active: sqlBool(r.active),
    lockedUntil: sqlDate(r.lockedUntil), failedLogins: sqlIntReq(r.failedLogins), mustChangePassword: sqlBool(r.mustChangePassword),
    tempPasswordExpiresAt: sqlDate(r.tempPasswordExpiresAt), sessionVersion: sqlIntReq(r.sessionVersion),
  };
}

// ── 마스터·입력 화면 (현황·지출 입력 — 매 요청)

/** 입력 화면 항목 칸 (lib/dto MasterCategory의 항목) */
export type MasterItemSql = {
  id: string; name: string; keywords: string | null; accountCode: string | null; perPersonLimit: number | null; perCaseLimit: number | null;
  hardBudget: boolean; needsAttendees: boolean;
};

/**
 * 분류 + 사용 중 항목 — prisma.category.findMany({ where: { id: { not: excludeId } }, orderBy: [order, name],
 *   include: { items: { where: { active: true, projectId }, orderBy: [order, name] } } }) (lib/master getMaster)
 * (참/거짓 조건은 읽은 뒤 거른다 — 저장 형식 차이와 무관하게)
 */
export async function sqlMasterCategories(projectId: string | null, excludeId: string): Promise<{ id: string; name: string; items: MasterItemSql[] }[]> {
  const [cats, items] = await Promise.all([
    sqlRows<Row>(`SELECT "id", "name" FROM "Category" WHERE "id" <> ? ORDER BY "order" ASC, "name" ASC`, [excludeId]),
    sqlRows<Row>(
      `SELECT "id", "name", "keywords", "accountCode", "perPersonLimit", "perCaseLimit", "hardBudget", "needsAttendees", "categoryId", "active"
       FROM "Item" WHERE ${projectId === null ? `"projectId" IS NULL` : `"projectId" = ?`} ORDER BY "order" ASC, "name" ASC`,
      projectId === null ? [] : [projectId],
    ),
  ]);
  const byCat = new Map<string, MasterItemSql[]>();
  for (const i of items) {
    if (!sqlBool(i.active)) continue;
    const list = byCat.get(String(i.categoryId)) ?? [];
    list.push({
      id: String(i.id), name: String(i.name), keywords: sqlStr(i.keywords), accountCode: sqlStr(i.accountCode), perPersonLimit: sqlInt(i.perPersonLimit),
      perCaseLimit: sqlInt(i.perCaseLimit), hardBudget: sqlBool(i.hardBudget), needsAttendees: sqlBool(i.needsAttendees),
    });
    byCat.set(String(i.categoryId), list);
  }
  return cats.map((c) => ({ id: String(c.id), name: String(c.name), items: byCat.get(String(c.id)) ?? [] }));
}

/** PM이 팀원에게 노출한 항목 — prisma.memberItem.findMany({ where: { projectId }, select: { itemId } }) */
export async function sqlMemberItemIds(projectId: string): Promise<string[]> {
  return (await sqlRows<Row>(`SELECT "itemId" FROM "MemberItem" WHERE "projectId" = ?`, [projectId])).map((r) => String(r.itemId));
}

/** 변경계약 과업 — prisma.contractChange.findMany({ where: { projectId, managerId? }, orderBy: { seq: "asc" }, select: { id, seq, title, items: { select: { itemId } } } }) */
export async function sqlContractChanges(projectId: string, managerId: string | null): Promise<{ id: string; seq: number; title: string; items: { itemId: string }[] }[]> {
  const rows = await sqlRows<Row>(
    `SELECT "id", "seq", "title" FROM "ContractChange" WHERE "projectId" = ?${managerId ? ` AND "managerId" = ?` : ""} ORDER BY "seq" ASC`,
    managerId ? [projectId, managerId] : [projectId],
  );
  if (!rows.length) return [];
  const links = await inChunks(rows.map((r) => String(r.id)), (c) => sqlRows<Row>(`SELECT "changeId", "itemId" FROM "ChangeItem" WHERE "changeId" IN (${marks(c.length)})`, c));
  const itemsOf = new Map<string, { itemId: string }[]>();
  for (const l of links) itemsOf.set(String(l.changeId), [...(itemsOf.get(String(l.changeId)) ?? []), { itemId: String(l.itemId) }]);
  return rows.map((r) => ({ id: String(r.id), seq: sqlIntReq(r.seq), title: String(r.title), items: itemsOf.get(String(r.id)) ?? [] }));
}

/** 참석자 칩용 협력 인력 — prisma.projectPartner.findMany({ where: { projectId, active: true }, orderBy: { order: "asc" }, select: { name, company } }) */
export async function sqlActivePartners(projectId: string): Promise<{ name: string; company: string | null }[]> {
  // 순서 값만으로 정렬하므로 같은 순서 값끼리의 순서도 Prisma와 같도록 조건까지 같은 모양으로 (참/거짓은 sqlParam이 저장 형식 1/0으로)
  const rows = await sqlRows<Row>(`SELECT "name", "company" FROM "ProjectPartner" WHERE "projectId" = ? AND "active" = ? ORDER BY "order" ASC`, [projectId, true]);
  return rows.map((r) => ({ name: String(r.name), company: sqlStr(r.company) }));
}

// ── 현황 (예산 집계·할 일·팀원별 사용)

/** 예산 집계용 예산 행 — prisma.budgetLine.findMany({ where: { projectId: { in } }, select: DASH_LINE_SELECT }) (lib/reports getDashboard) */
export async function sqlDashLines(projectIds: string[]): Promise<{ projectId: string; itemId: string; planned: number; periods: number; bundleItemIds: string | null }[]> {
  if (!projectIds.length) return [];
  const rows = await sqlRows<Row>(`SELECT "projectId", "itemId", "planned", "periods", "bundleItemIds" FROM "BudgetLine" WHERE "projectId" IN (${marks(projectIds.length)})`, projectIds);
  return rows.map((r) => ({ projectId: String(r.projectId), itemId: String(r.itemId), planned: sqlIntReq(r.planned), periods: sqlIntReq(r.periods), bundleItemIds: sqlStr(r.bundleItemIds) }));
}

/** 예산 집계용 항목 (분류 순서 → 항목 순서) — prisma.item.findMany({ where: { projectId: { in } }, select: DASH_ITEM_SELECT, orderBy: DASH_ITEM_ORDER }) */
export async function sqlDashItems(projectIds: string[]): Promise<{ id: string; name: string; code: string | null; projectId: string | null; categoryId: string; active: boolean; accountCode: string | null; category: { name: string } }[]> {
  if (!projectIds.length) return [];
  const rows = await sqlRows<Row>(
    `SELECT i."id", i."name", i."code", i."projectId", i."categoryId", i."active", i."accountCode", c."name" AS "categoryName"
     FROM "Item" i JOIN "Category" c ON c."id" = i."categoryId" WHERE i."projectId" IN (${marks(projectIds.length)})
     ORDER BY c."order" ASC, c."name" ASC, i."order" ASC, i."name" ASC`,
    projectIds,
  );
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), code: sqlStr(r.code), projectId: sqlStr(r.projectId), categoryId: String(r.categoryId), active: sqlBool(r.active),
    accountCode: sqlStr(r.accountCode), category: { name: String(r.categoryName) },
  }));
}

/** 취합 하위 프로젝트 기간 — prisma.project.findMany({ where: { id: { in } }, select: { id, startDate, endDate } }) */
export async function sqlProjectPeriods(ids: string[]): Promise<{ id: string; startDate: Date; endDate: Date }[]> {
  const rows = await inChunks(ids, (c) => sqlRows<Row>(`SELECT "id", "startDate", "endDate" FROM "Project" WHERE "id" IN (${marks(c.length)})`, c));
  return rows.map((r) => ({ id: String(r.id), startDate: sqlDateReq(r.startDate), endDate: sqlDateReq(r.endDate) }));
}

/**
 * 입력 항목의 근거 (lib/input-capable) — 한 번의 조회로 세 가지를 함께 읽는다:
 * prisma.budgetLine.findMany({ where: { projectId: { in } }, select: { projectId, itemId, bundleItemIds } })
 * + prisma.memberItem.findMany({ where: { projectId: { in } }, select: { projectId, itemId } })
 * + prisma.changeItem.findMany({ where: { change: { projectId: { in }, managerId: { not: null } } }, select: { itemId, change: { select: { projectId, managerId } } } })
 */
export async function sqlInputSources(projectIds: string[]): Promise<InputSource[]> {
  if (!projectIds.length) return [];
  const m = marks(projectIds.length);
  const rows = await sqlRows<Row>(
    `SELECT 'budget' AS "kind", "projectId", "itemId", "bundleItemIds", NULL AS "managerId" FROM "BudgetLine" WHERE "projectId" IN (${m})
     UNION ALL SELECT 'member', "projectId", "itemId", NULL, NULL FROM "MemberItem" WHERE "projectId" IN (${m})
     UNION ALL SELECT 'change', cc."projectId", ci."itemId", NULL, cc."managerId" FROM "ChangeItem" ci JOIN "ContractChange" cc ON cc."id" = ci."changeId"
       WHERE cc."projectId" IN (${m}) AND cc."managerId" IS NOT NULL`,
    [...projectIds, ...projectIds, ...projectIds],
  );
  return rows.map((r) => ({
    projectId: String(r.projectId), kind: String(r.kind) as InputSource["kind"], itemId: String(r.itemId),
    bundleItemIds: sqlStr(r.bundleItemIds), managerId: sqlStr(r.managerId),
  }));
}

/**
 * 결제자별 그 달 사용 (본사 지출 제외) — prisma.expense.groupBy({ by: ["payerId"], where: { projectId: { in }, yearMonth, isHq: false }, _sum: { amount }, _count: true })
 * (참/거짓 조건은 isHq로도 묶어 읽은 뒤 거른다 — 본사 지출 제외 후에는 결제자마다 한 행)
 */
export async function sqlPayerMonthSums(projectIds: string[], yearMonth: string): Promise<{ payerId: string; amount: number; count: number }[]> {
  if (!projectIds.length) return [];
  const rows = await sqlRows<Row>(
    `SELECT "payerId", "isHq", SUM("amount") AS "amount", COUNT(*) AS "n" FROM "Expense"
     WHERE "projectId" IN (${marks(projectIds.length)}) AND "yearMonth" = ? GROUP BY "payerId", "isHq"`,
    [...projectIds, yearMonth],
  );
  return rows.filter((r) => !sqlBool(r.isHq)).map((r) => ({ payerId: String(r.payerId), amount: sqlInt(r.amount) ?? 0, count: sqlIntReq(r.n) }));
}

/** 사용자 이름·직급·소속 — prisma.user.findMany({ where: { id: { in } }, select: { id, name, position, department: { select: { name } } } }) */
export async function sqlUserInfo(ids: string[]): Promise<{ id: string; name: string; position: string | null; department: { name: string } | null }[]> {
  const rows = await inChunks(ids, (c) => sqlRows<Row>(
    `SELECT u."id", u."name", u."position", u."departmentId", d."name" AS "deptName" FROM "User" u LEFT JOIN "Department" d ON d."id" = u."departmentId" WHERE u."id" IN (${marks(c.length)})`, c));
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), position: sqlStr(r.position), department: r.departmentId != null && r.deptName != null ? { name: String(r.deptName) } : null }));
}

/** 할 일: 확정 전 출입증 내역별 회사 부담 요청(미결정)·팀원 미확인 줄 수 — lib/pass-statement-server pendingPassChecks와 같은 결과 (오래된 달부터) */
export async function sqlPendingPassChecks(projectId: string): Promise<{ ym: string; count: number; unmatched: number }[]> {
  const rows = await sqlRows<Row>(
    `SELECT s."yearMonth",
       (SELECT COUNT(*) FROM "PassStatementLine" l WHERE l."statementId" = s."id" AND l."decision" IS NULL AND l."memberClaim" = ?) AS "claims",
       (SELECT COUNT(*) FROM "PassStatementLine" l WHERE l."statementId" = s."id" AND l."userId" IS NULL) AS "unmatched"
     FROM "PassStatement" s WHERE s."projectId" = ? AND s."status" = ? ORDER BY s."yearMonth" ASC`,
    ["OVERTIME", projectId, "OPEN"],
  );
  return rows.map((r) => ({ ym: String(r.yearMonth), count: sqlIntReq(r.claims), unmatched: sqlIntReq(r.unmatched) }));
}

/**
 * 마감 반려·승인 취소 기록 (최근 것부터) — prisma.auditLog.findMany({ where: { entity: "MonthlyClosing", entityId: { in }, action: { in: [reject, revoke] } },
 *   orderBy: { createdAt: "desc" }, select: { entityId, action } }) (마감 id마다 가장 최근 기록만 쓰므로 나눠 읽어도 결과가 같다)
 */
/** 마감의 가장 최근 처리 기록 data (예: 마감 때 남긴 총합계 — 상신 전 변경 감지). 없으면 null */
export async function sqlLastClosingLogData(closingId: string, action: string): Promise<string | null> {
  const rows = await sqlRows<Row>(
    `SELECT "data" FROM "AuditLog" WHERE "entity" = ? AND "entityId" = ? AND "action" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
    ["MonthlyClosing", closingId, action],
  );
  return rows.length ? sqlStr(rows[0].data) : null;
}

export async function sqlClosingReviewLogs(closingIds: string[]): Promise<{ entityId: string; action: string }[]> {
  const rows = await inChunks(closingIds, (c) => sqlRows<Row>(
    `SELECT "entityId", "action" FROM "AuditLog" WHERE "entity" = ? AND "entityId" IN (${marks(c.length)}) AND "action" IN (?, ?) ORDER BY "createdAt" DESC`,
    ["MonthlyClosing", ...c, "reject", "revoke"]));
  return rows.map((r) => ({ entityId: String(r.entityId), action: String(r.action) }));
}
