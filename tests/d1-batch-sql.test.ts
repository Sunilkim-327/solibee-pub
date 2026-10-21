import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { d1Value, deleteByIdStatements, insertStatements, newRowId } from "@/lib/db";

// d1Batch로 보내는 SQL (운영 D1 전용 경로)을 SQLite에서 실제로 실행해 확인한다
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE "T" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "amount" BIGINT NOT NULL, "note" TEXT, "on" INTEGER NOT NULL, "at" TEXT)`);
  return d;
}
const run = (d: DatabaseSync, stmts: { sql: string; params: unknown[] }[]) => {
  for (const s of stmts) d.prepare(s.sql).run(...(s.params.map(d1Value) as (string | number | null)[]));
};

describe("D1 일괄 SQL", () => {
  it("여러 행 INSERT는 쿼리당 값 100개 이하로 나뉘고 모든 행이 그대로 들어간다", () => {
    const rows = Array.from({ length: 95 }, (_, i) => ({ id: newRowId("b"), projectId: "p1", amount: 1000 * i, note: i % 2 ? null : `n${i}`, on: i % 3 === 0, at: new Date(Date.UTC(2026, 0, 1 + i)) }));
    const stmts = insertStatements("T", rows);
    expect(stmts.every((s) => s.params.length <= 100)).toBe(true);
    expect(stmts).toHaveLength(Math.ceil(95 / Math.floor(100 / 6)));
    const d = db();
    run(d, stmts);
    const got = d.prepare(`SELECT * FROM "T" ORDER BY "amount"`).all() as Record<string, unknown>[];
    expect(got).toHaveLength(95);
    expect(got[2]).toEqual({ id: rows[2].id, projectId: "p1", amount: 2000, note: "n2", on: 0, at: "2026-01-03T00:00:00.000+00:00" });
    expect(got[3].on).toBe(1);
  });

  it("빈 목록이면 문이 없다", () => {
    expect(insertStatements("T", [])).toEqual([]);
    expect(deleteByIdStatements("T", [])).toEqual([]);
  });

  it("id 목록 DELETE는 100개씩 나뉜다", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `r${i}`, projectId: "p", amount: i, note: null, on: false, at: null }));
    const d = db();
    run(d, insertStatements("T", rows));
    const del = deleteByIdStatements("T", rows.slice(0, 230).map((r) => r.id));
    expect(del.map((s) => s.params.length)).toEqual([100, 100, 30]);
    run(d, del);
    expect((d.prepare(`SELECT COUNT(*) AS n FROM "T"`).get() as { n: number }).n).toBe(20);
  });
});
