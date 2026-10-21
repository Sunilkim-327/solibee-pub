import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { d1Value } from "@/lib/db";
import {
  confirmStatementSql, deleteEmptyStatementSql, deletePassGroupSql, deletePassLinesSql, guardedExpenseDelete, guardedExpenseInsert, guardedExpenseUpdate, guardedPassLineUpdate, updatePassFileNameSql, type Stmt,
} from "@/lib/guarded-sql";
import { fileNameAfterDelete } from "@/lib/pass-statement";

// 운영(D1) 조건부 쓰기 SQL을 SQLite에서 실제로 실행해 확인 (가상 데이터)
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE "Project" ("id" TEXT PRIMARY KEY, "parentId" TEXT, "seriesId" TEXT, "settleWithParent" BOOLEAN NOT NULL DEFAULT false);
    INSERT INTO "Project" ("id") VALUES ('p1');
    CREATE TABLE "MonthlyClosing" ("id" TEXT PRIMARY KEY, "projectId" TEXT, "yearMonth" TEXT, "status" TEXT);
    CREATE TABLE "Expense" ("id" TEXT PRIMARY KEY, "projectId" TEXT, "yearMonth" TEXT, "amount" INTEGER, "date" TEXT, "isHq" INTEGER, "updatedAt" TEXT);
    CREATE TABLE "PassStatement" ("id" TEXT PRIMARY KEY, "status" TEXT, "confirmedBy" TEXT, "confirmedAt" TEXT);
    CREATE TABLE "PassStatementLine" ("id" TEXT PRIMARY KEY, "statementId" TEXT, "decision" TEXT, "collectNote" TEXT, "userId" TEXT);
  `);
  return d;
}
const run = (d: DatabaseSync, s: Stmt) => Number(d.prepare(s.sql).run(...(s.params.map(d1Value) as (string | number | null)[])).changes);
const close = (d: DatabaseSync, ym: string, status = "CLOSED") => d.prepare(`INSERT INTO "MonthlyClosing" VALUES (?, 'p1', ?, ?)`).run(`c-${ym}`, ym, status);
const row = (id: string, ym: string) => ({ id, projectId: "p1", yearMonth: ym, amount: 9000, date: new Date(`${ym}-03T00:00:00Z`), isHq: false, updatedAt: new Date() });

describe("D1 조건부 쓰기 — 마감된 달에는 쓰지 않는다", () => {
  it("추가: 마감 전이면 1행, 마감(CLOSED·SUBMITTED·APPROVED)이면 0행 / 작성중·반려 달은 추가", () => {
    const d = db();
    close(d, "2026-09");
    close(d, "2026-08", "REJECTED");
    expect(run(d, guardedExpenseInsert(row("e1", "2026-10")))).toBe(1);
    expect(run(d, guardedExpenseInsert(row("e2", "2026-09")))).toBe(0);
    expect(run(d, guardedExpenseInsert(row("e3", "2026-08")))).toBe(1);
    expect((d.prepare(`SELECT "date", "isHq" FROM "Expense" WHERE "id" = 'e1'`).get() as { date: string; isHq: number })).toEqual({ date: "2026-10-03T00:00:00.000+00:00", isHq: 0 });
  });

  it("수정: 원래 달·옮길 달 중 하나라도 마감이면 0행", () => {
    const d = db();
    run(d, guardedExpenseInsert(row("e1", "2026-10")));
    run(d, guardedExpenseInsert(row("e2", "2026-07")));
    close(d, "2026-09");
    close(d, "2026-07", "APPROVED");
    expect(run(d, guardedExpenseUpdate("e1", { amount: 5000, updatedAt: new Date() }, "2026-10"))).toBe(1);
    expect(run(d, guardedExpenseUpdate("e1", { yearMonth: "2026-09" }, "2026-09"))).toBe(0); // 마감된 달로 옮기기
    expect(run(d, guardedExpenseUpdate("e2", { amount: 1 }, "2026-07"))).toBe(0); // 승인된 달의 지출
    expect((d.prepare(`SELECT "amount", "yearMonth" FROM "Expense" WHERE "id" = 'e1'`).get() as { amount: number; yearMonth: string })).toEqual({ amount: 5000, yearMonth: "2026-10" });
  });

  it("삭제: 그 지출의 달이 마감이면 0행", () => {
    const d = db();
    run(d, guardedExpenseInsert(row("e1", "2026-10")));
    run(d, guardedExpenseInsert(row("e2", "2026-09")));
    close(d, "2026-09", "SUBMITTED");
    expect(run(d, guardedExpenseDelete("e1"))).toBe(1);
    expect(run(d, guardedExpenseDelete("e2"))).toBe(0);
  });

  it("출입증 줄: 확정된 명세의 결정은 바꾸지 않고(0행), 수금 기록은 확정 후에도", () => {
    const d = db();
    d.exec(`INSERT INTO "PassStatement" ("id", "status") VALUES ('s1', 'OPEN'), ('s2', 'CONFIRMED');
            INSERT INTO "PassStatementLine" VALUES ('l1', 's1', NULL, NULL, NULL), ('l2', 's2', NULL, NULL, NULL), ('l3', 's1', NULL, NULL, NULL);`);
    expect(run(d, guardedPassLineUpdate(["l1"], { decision: "DEDUCT" }, true))).toBe(1);
    expect(run(d, guardedPassLineUpdate(["l2"], { decision: "DEDUCT" }, true))).toBe(0);
    expect(run(d, guardedPassLineUpdate(["l2"], { collectNote: "받음" }, false))).toBe(1);
    expect(run(d, guardedPassLineUpdate(["l1", "l2", "l3"], { userId: "u1" }, true))).toBe(2);
  });

  it("월 확정 문장: OPEN일 때만 CONFIRMED(1행), 줄은 건드리지 않는다 — 이미 확정된 명세면 0행", () => {
    const d = db();
    d.exec(`INSERT INTO "PassStatement" ("id", "status") VALUES ('s1', 'OPEN'), ('s2', 'CONFIRMED');
            INSERT INTO "PassStatementLine" VALUES ('l1', 's1', NULL, NULL, 'u1'), ('l2', 's1', 'OVERTIME', NULL, 'u1'), ('l3', 's2', NULL, NULL, 'u1');`);
    const now = new Date("2026-10-14T01:00:00Z");
    // 확정 전 명세: 확정 1행, 빈 결정 줄은 그대로 NULL (확정된 내역의 빈 값은 읽을 때 본인 부담으로 채운다 — applyConfirmedDefaults)
    expect(run(d, confirmStatementSql("s1", "pm", now))).toBe(1);
    expect(d.prepare(`SELECT "status", "confirmedBy" FROM "PassStatement" WHERE "id" = 's1'`).get()).toEqual({ status: "CONFIRMED", confirmedBy: "pm" });
    expect(d.prepare(`SELECT "decision" FROM "PassStatementLine" WHERE "id" = 'l1'`).get()).toEqual({ decision: null });
    expect(d.prepare(`SELECT "decision" FROM "PassStatementLine" WHERE "id" = 'l2'`).get()).toEqual({ decision: "OVERTIME" });
    // 이미 확정된 명세: 확정도 줄 결정 갱신(needsOpen)도 0행
    expect(run(d, confirmStatementSql("s2", "pm", now))).toBe(0);
    expect(run(d, confirmStatementSql("s1", "other", now))).toBe(0);
    expect(run(d, guardedPassLineUpdate(["l1", "l3"], { decision: "DEDUCT" }, true))).toBe(0);
  });
});

describe("D1 조건부 쓰기 — 메인과 함께 상신하는 서브 (가상 데이터)", () => {
  // main1·main2: 같은 연속 사업의 1차·2차 / sub: main1에 연결, 함께 상신 / solo: 따로 상신하는 서브
  function gdb() {
    const d = db();
    d.exec(`INSERT INTO "Project" VALUES ('main1', NULL, 's', 0), ('main2', NULL, 's', 0), ('sub', 'main1', NULL, 1), ('solo', 'main1', NULL, 0);`);
    return d;
  }
  const closeOf = (d: DatabaseSync, p: string, ym: string, status = "CLOSED") => d.prepare(`INSERT INTO "MonthlyClosing" VALUES (?, ?, ?, ?)`).run(`c-${p}-${ym}`, p, ym, status);
  const subRow = (id: string, ym: string, projectId = "sub") => ({ ...row(id, ym), projectId });

  it("메인의 마감이 서브의 같은 달 지출 추가·수정·삭제를 막는다 (다른 연차의 달 포함), 따로 상신하는 서브는 그대로", () => {
    const d = gdb();
    expect(run(d, guardedExpenseInsert(subRow("e1", "2026-09")))).toBe(1);
    expect(run(d, guardedExpenseInsert(subRow("e2", "2026-12")))).toBe(1);
    closeOf(d, "main1", "2026-09");
    closeOf(d, "main2", "2026-12", "SUBMITTED");
    closeOf(d, "main1", "2026-10", "REJECTED");
    expect(run(d, guardedExpenseInsert(subRow("e3", "2026-09")))).toBe(0);
    expect(run(d, guardedExpenseInsert(subRow("e4", "2026-12")))).toBe(0); // 2차 기간의 달은 2차 마감이 잠근다
    expect(run(d, guardedExpenseInsert(subRow("e5", "2026-10")))).toBe(1); // 반려는 열림
    expect(run(d, guardedExpenseUpdate("e1", { amount: 1 }, "2026-09"))).toBe(0);
    expect(run(d, guardedExpenseUpdate("e5", { yearMonth: "2026-09" }, "2026-09"))).toBe(0); // 잠긴 달로 옮기기
    expect(run(d, guardedExpenseDelete("e2"))).toBe(0);
    expect(run(d, guardedExpenseDelete("e5"))).toBe(1);
    // 따로 상신하는 서브·메인 자신은 자기 마감만
    expect(run(d, guardedExpenseInsert(subRow("s1", "2026-09", "solo")))).toBe(1);
    expect(run(d, guardedExpenseInsert(subRow("m1", "2026-12", "main1")))).toBe(1);
    expect(run(d, guardedExpenseInsert(subRow("m2", "2026-09", "main1")))).toBe(0);
  });
});

describe("출입증 올린 내역 삭제 SQL (확정 전만, 남은 줄 없으면 명세도)", () => {
  function pdb() {
    const d = new DatabaseSync(":memory:");
    d.exec(`
      CREATE TABLE "PassStatement" ("id" TEXT PRIMARY KEY, "status" TEXT, "fileName" TEXT);
      CREATE TABLE "PassStatementLine" ("id" TEXT PRIMARY KEY, "statementId" TEXT, "vendor" TEXT, "placeType" TEXT, "sheetName" TEXT);
      INSERT INTO "PassStatement" VALUES ('s1', 'OPEN', 'A: a.xlsx + B: b.csv'), ('s2', 'CONFIRMED', 'A: a.xlsx');
      INSERT INTO "PassStatementLine" VALUES
        ('a1', 's1', 'A', '식당', '식당'), ('a2', 's1', 'A', '카페', 'Sheet1'), ('b1', 's1', 'B', '식당', 'Sheet1'),
        ('n1', 's1', NULL, NULL, '구분없음'), ('c1', 's2', 'A', '식당', '식당');
    `);
    return d;
  }
  const left = (d: DatabaseSync, st: string) => (d.prepare(`SELECT "id" FROM "PassStatementLine" WHERE "statementId" = ? ORDER BY "id"`).all(st) as { id: string }[]).map((r) => r.id);
  const hasStatement = (d: DatabaseSync, id: string) => !!d.prepare(`SELECT 1 FROM "PassStatement" WHERE "id" = ?`).get(id);

  it("묶음(업체 + 구분)만 지운다 — 다른 업체의 같은 구분·업체 미지정 줄은 그대로", () => {
    const d = pdb();
    expect(run(d, deletePassGroupSql("s1", "A", "식당"))).toBe(1);
    expect(left(d, "s1")).toEqual(["a2", "b1", "n1"]);
    expect(run(d, deletePassGroupSql("s1", null, "구분없음"))).toBe(1); // 업체 미지정 줄 (구분이 비면 시트 이름)
    expect(run(d, deleteEmptyStatementSql("s1"))).toBe(0); // 아직 줄이 남음
    expect(hasStatement(d, "s1")).toBe(true);
  });

  it("확정된 명세는 지우지 않는다 (0행)", () => {
    const d = pdb();
    expect(run(d, deletePassGroupSql("s2", "A", "식당"))).toBe(0);
    expect(run(d, deletePassLinesSql("s2"))).toBe(0);
    expect(run(d, deleteEmptyStatementSql("s2"))).toBe(0);
    expect(left(d, "s2")).toEqual(["c1"]);
  });

  it("그 달 전체를 지우면 명세도 지워 '올리기 전'으로, 파일 이름은 남은 업체만", () => {
    const d = pdb();
    expect(run(d, updatePassFileNameSql("s1", fileNameAfterDelete("A: a.xlsx + B: b.csv", ["A"])))).toBe(1);
    expect((d.prepare(`SELECT "fileName" FROM "PassStatement" WHERE "id" = 's1'`).get() as { fileName: string }).fileName).toBe("A: a.xlsx");
    expect(run(d, deletePassLinesSql("s1"))).toBe(4);
    expect(run(d, deleteEmptyStatementSql("s1"))).toBe(1);
    expect(hasStatement(d, "s1")).toBe(false);
    expect(fileNameAfterDelete("옛파일.xlsx + B: b.csv", [])).toBe("옛파일.xlsx");
  });
});
