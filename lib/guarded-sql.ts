// 운영(D1) 조건부 쓰기 SQL — 순수함수.
// D1은 트랜잭션이 없어 '마감 여부 확인 → 저장' 사이에 마감·확정이 끼어들 수 있다.
// 확인 조건을 쓰기 문장 안(WHERE NOT EXISTS …)에 넣어 한 문장으로 처리하고, 영향 행이 0이면 호출부가 거절한다.
// 로컬 SQLite는 Prisma 트랜잭션을 그대로 쓴다.

export type Stmt = { sql: string; params: unknown[] };

/** 지출 수정·삭제를 막는 마감 상태 (lib/closing isLocked와 같음) */
export const LOCKED_STATUSES = ["CLOSED", "SUBMITTED", "APPROVED"] as const;
const lockedList = LOCKED_STATUSES.map((s) => `'${s}'`).join(",");

/**
 * 메인과 함께 상신하는 서브 프로젝트(child)의 메인 후보 id — 직접 상위 + 같은 연속 사업의 다른 연차 (lib/settle-group settleParentIds와 같음).
 * 함께 상신하는 서브가 아니면 빈 결과 (상위가 다시 함께 상신하는 서브여도 빈 결과 — 한 단계만). child는 SQL 식(자리표시자 ? 또는 열)
 */
export const settleParentsSql = (child: string) =>
  `SELECT m."id" FROM "Project" s JOIN "Project" par ON par."id" = s."parentId" JOIN "Project" m ON (m."id" = par."id" OR (par."seriesId" IS NOT NULL AND m."seriesId" = par."seriesId")) WHERE s."id" = ${child} AND s."settleWithParent" = 1 AND NOT (par."parentId" IS NOT NULL AND par."settleWithParent" = 1)`;

/**
 * 그 프로젝트·월이 마감(CLOSED 이상)되지 않았다는 조건 — project·ym은 SQL 식(자리표시자 ? 또는 열).
 * 메인과 함께 상신하는 서브면 그 달 메인의 마감도 잠근다. 자리표시자 순서: ym, project, project
 */
export const monthOpenSql = (project: string, ym: string) =>
  `NOT EXISTS (SELECT 1 FROM "MonthlyClosing" c WHERE c."yearMonth" = ${ym} AND c."status" IN (${lockedList}) AND (c."projectId" = ${project} OR c."projectId" IN (${settleParentsSql(project)})))`;

const cols = (row: Record<string, unknown>) => Object.keys(row);
const q = (c: string) => `"${c}"`;

/** 지출 입력 — 대상 월이 마감되지 않았을 때만 (영향 행 0 = 마감) */
export function guardedExpenseInsert(row: Record<string, unknown> & { projectId: string; yearMonth: string }): Stmt {
  const c = cols(row);
  return {
    sql: `INSERT INTO "Expense" (${c.map(q).join(",")}) SELECT ${c.map(() => "?").join(",")} WHERE ${monthOpenSql("?", "?")}`,
    params: [...c.map((k) => row[k]), row.yearMonth, row.projectId, row.projectId],
  };
}

/** 지출 수정 — 원래 월과 바꿀 월이 모두 마감되지 않았을 때만 */
export function guardedExpenseUpdate(id: string, data: Record<string, unknown>, newYm: string): Stmt {
  const c = cols(data);
  const set = c.length ? c.map((k) => `${q(k)} = ?`).join(", ") : `"id" = "id"`;
  return {
    sql: `UPDATE "Expense" SET ${set} WHERE "id" = ? AND ${monthOpenSql(`"Expense"."projectId"`, `"Expense"."yearMonth"`)} AND ${monthOpenSql(`"Expense"."projectId"`, "?")}`,
    params: [...c.map((k) => data[k]), id, newYm],
  };
}

/** 지출 삭제 — 그 지출의 월이 마감되지 않았을 때만 */
export function guardedExpenseDelete(id: string): Stmt {
  return { sql: `DELETE FROM "Expense" WHERE "id" = ? AND ${monthOpenSql(`"Expense"."projectId"`, `"Expense"."yearMonth"`)}`, params: [id] };
}

const statementOpenSql = `EXISTS (SELECT 1 FROM "PassStatement" s WHERE s."id" = "PassStatementLine"."statementId" AND s."status" = 'OPEN')`;

/** 출입증 내역 줄 수정 — needsOpen이면 내역이 아직 확정 전일 때만 (확정과 동시에 결정을 바꾸지 못하게) */
export function guardedPassLineUpdate(ids: string[], data: Record<string, unknown>, needsOpen: boolean): Stmt {
  const c = cols(data);
  const set = c.length ? c.map((k) => `${q(k)} = ?`).join(", ") : `"id" = "id"`;
  return {
    sql: `UPDATE "PassStatementLine" SET ${set} WHERE "id" IN (${ids.map(() => "?").join(",")})${needsOpen ? ` AND ${statementOpenSql}` : ""}`,
    params: [...c.map((k) => data[k]), ...ids],
  };
}

/**
 * 출입증 월 확정 — 아직 OPEN일 때만 CONFIRMED로 (영향 행 0 = 이미 확정). 확정은 이 한 문장뿐이다.
 * 따로 정하지 않은 줄은 갱신하지 않는다 — 확정된 내역에서 빈 decision은 본인 부담으로 읽는다(lib/pass-statement applyConfirmedDefaults).
 * (예전의 줄 갱신 배치는 D1 바인딩 한도로 일부만 반영되는 사고가 있어 없앴다, 2026-10)
 */
export function confirmStatementSql(statementId: string, userId: string, now: Date): Stmt {
  return {
    sql: `UPDATE "PassStatement" SET "status" = 'CONFIRMED', "confirmedBy" = ?, "confirmedAt" = ? WHERE "id" = ? AND "status" = 'OPEN'`,
    params: [userId, now, statementId],
  };
}

// ── 출입증 올린 내역 삭제 (확정 전 내역만) ──

const statementIsOpen = (id: string) => ({ sql: `EXISTS (SELECT 1 FROM "PassStatement" s WHERE s."id" = ? AND s."status" = 'OPEN')`, params: [id] });
/** 줄의 구분 (lib/pass-statement splitByScope와 같은 기준: placeType → sheetName → "") */
const lineLabelSql = `COALESCE(NULLIF("placeType", ''), "sheetName", '')`;

/** 한 묶음(업체 + 구분)의 줄 삭제 — 내역이 확정 전일 때만. vendor가 null이면 업체 미지정 줄 */
export function deletePassGroupSql(statementId: string, vendor: string | null, label: string): Stmt {
  const open = statementIsOpen(statementId);
  return {
    sql: `DELETE FROM "PassStatementLine" WHERE "statementId" = ? AND ${vendor === null ? `"vendor" IS NULL` : `"vendor" = ?`} AND ${lineLabelSql} = ? AND ${open.sql}`,
    params: [statementId, ...(vendor === null ? [] : [vendor]), label, ...open.params],
  };
}

/** 그 달 줄 전체 삭제 — 확정 전일 때만 */
export function deletePassLinesSql(statementId: string): Stmt {
  const open = statementIsOpen(statementId);
  return { sql: `DELETE FROM "PassStatementLine" WHERE "statementId" = ? AND ${open.sql}`, params: [statementId, ...open.params] };
}

/** 내역 파일 이름 고치기 (지운 업체의 파일 이름 빼기) — 확정 전일 때만 */
export function updatePassFileNameSql(statementId: string, fileName: string): Stmt {
  return { sql: `UPDATE "PassStatement" SET "fileName" = ? WHERE "id" = ? AND "status" = 'OPEN'`, params: [fileName, statementId] };
}

/** 줄이 남지 않은 확정 전 내역 삭제 (그 달을 '올리기 전'으로) */
export function deleteEmptyStatementSql(statementId: string): Stmt {
  return {
    sql: `DELETE FROM "PassStatement" WHERE "id" = ? AND "status" = 'OPEN' AND NOT EXISTS (SELECT 1 FROM "PassStatementLine" l WHERE l."statementId" = ?)`,
    params: [statementId, statementId],
  };
}
