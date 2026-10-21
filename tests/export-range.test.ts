// 상신 엑셀 출력 범위 (설계 검토(2026-10-14) P0-2 ②) — 가짜 데이터(실제 양식 데이터 아님)
// ym을 지정하면 그 달 이후 월 시트는 양식만 남기고 데이터 줄이 없고, 총괄현황·예산 시트 집계도 같은 범위. 같은 데이터면 같은 파일(SHA-256)
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const project = {
  id: "p1", name: "범위 팀", startDate: d("2026-01-01"), endDate: d("2026-03-31"), fiscalStart: 1, code: null, parentId: null, settleWithParent: false, excelPrefix: null,
  departmentId: null, clientPassEnabled: false, clientPassName: null, clientPassItemIds: null, passDisplayItems: null, seriesId: null, round: null, closedAt: null, closedBy: null, archivedAt: null,
};
const categories = [{ id: "food", name: "식대", order: 1 }];
const items = [{
  id: "night", projectId: "p1", code: null, categoryId: "food", name: "야근식대", accountCode: null, keywords: null, perPersonLimit: null, perCaseLimit: null,
  hardBudget: false, needsAttendees: false, order: 1, active: true, isDefault: true, linkedItemId: null, category: categories[0],
}];
const lines = [{ id: "l1", projectId: "p1", itemId: "night", detail: "야근", unitPrice: 100_000, periods: 3, planned: 300_000, bundleItemIds: null, order: 1, changeId: null }];
const users = { u1: { name: "가나다", position: "책임" } };
let seq = 0;
const exp = (date: string, amount: number) => {
  seq++;
  return {
    id: `e${seq}`, projectId: "p1", payerId: "u1", date: d(date), amount, payMethod: "PERSONAL_CARD", itemId: "night", detail: `세부 ${seq}`, headcount: null, attendees: null,
    merchant: null, hasExternal: false, flags: null, justification: null, isHq: false, changeId: null, yearMonth: date.slice(0, 7), createdBy: "u1",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)), updatedAt: d("2026-01-01"), payer: users.u1, item: items[0],
  };
};
// 1월 10,000 / 2월 20,000 / 3월 40,000 (3월은 2월 상신 시점에는 작성중)
const expenses = [exp("2026-01-05", 10_000), exp("2026-02-05", 20_000), exp("2026-03-05", 40_000)];
const members = [{ projectId: "p1", userId: "u1", isPayer: true, isPm: true, leftAt: null, user: { id: "u1", ...users.u1, role: "MANAGER", active: true } }];
const closings = [
  { id: "c1", projectId: "p1", yearMonth: "2026-01", status: "APPROVED", closedAt: null, submittedAt: null, reviewedAt: null, reviewedBy: null, reviewNote: null, approvalRef: null },
  { id: "c2", projectId: "p1", yearMonth: "2026-02", status: "SUBMITTED", closedAt: null, submittedAt: null, reviewedAt: null, reviewedBy: null, reviewNote: null, approvalRef: null },
];
type Args = { where?: Record<string, unknown>; select?: Record<string, unknown> };
const pick = <T extends Record<string, unknown>>(row: T, select?: Record<string, unknown>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row);

vi.mock("@/lib/access", () => ({ audit: async () => {}, HttpError: class HttpError extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock("@/lib/sql-loaders", () => ({
  sqlPassCompanyLines: async () => [],
  sqlProjectMembers: async () => members,
  sqlClosingRows: async () => closings.map(({ id, yearMonth, status, reviewNote }) => ({ id, yearMonth, status, reviewNote })),
  sqlBudgetLines: async () => lines.map(({ itemId, planned, periods, bundleItemIds }) => ({ itemId, planned, periods, bundleItemIds })),
  sqlExpenseMonthSums: async () => expenses.map((e) => ({ projectId: "p1", itemId: e.itemId, yearMonth: e.yearMonth, amount: e.amount })),
}));
vi.mock("@/lib/db", () => ({
  toNumber: (v: unknown) => (v == null ? 0 : Number(v)),
  prisma: {
    project: { findUniqueOrThrow: async () => project, findUnique: async () => project, findMany: async () => [project] },
    budgetLine: { findMany: async (a: Args = {}) => lines.map((l) => pick(l, a.select)) },
    expense: { findMany: async (a: Args = {}) => expenses.filter((e) => typeof a.where?.yearMonth !== "string" || e.yearMonth === a.where.yearMonth).map((e) => pick(e, a.select)) },
    item: { findMany: async () => items },
    monthlyClosing: {
      findMany: async (a: Args = {}) => closings.map((c) => pick(c, a.select)),
      findUnique: async (a: { where: { projectId_yearMonth: { yearMonth: string } } }) => closings.find((c) => c.yearMonth === a.where.projectId_yearMonth.yearMonth) ?? null,
    },
    projectMember: { findMany: async () => members },
    category: { findMany: async () => categories.map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id).map(({ category: _c, ...i }) => i) })) },
  },
}));

const load = async (buffer: Uint8Array) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer as unknown as ArrayBuffer); return wb; };
// 수식 칸의 계산 결과 (exceljs는 0을 비워 두고 읽으므로 없으면 0)
const result = (v: ExcelJS.CellValue) => (v && typeof v === "object" && "formula" in v ? (v as ExcelJS.CellFormulaValue).result ?? 0 : v);

describe("출력 범위 (ym 지정)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-03-15T03:00:00Z")); });
  afterAll(() => { vi.useRealTimers(); });

  it("2월 지정: 3월 시트는 양식만(데이터 줄 없음), 총괄현황 3월 행 0, 예산 지출은 1~2월만", async () => {
    const { buildWorkbook } = await import("@/lib/export");
    const { buffer, filename, status } = await buildWorkbook("p1", "2026-02");
    expect(status).toBe("SUBMITTED");
    expect(filename).toBe("2026-2026 범위 팀 운영비(26.02)_상신_2026-03-15 1200.xlsx");
    const wb = await load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["총괄현황", "프로젝트 운영비(작성금지)", "1월", "2월", "3월", "유효성검사_편집삭제금지", "데이터시트"]);
    const feb = wb.getWorksheet("2월")!;
    const mar = wb.getWorksheet("3월")!;
    expect(feb.getCell("C4").value).toBe(20_000);
    expect(result(feb.getCell("G2").value)).toBe(20_000);
    // 3월: 머리글·구역 제목은 양식대로, 데이터 줄 없음, 총합계 0
    expect(mar.getCell("A1").value).toBe("결제자");
    expect(mar.getCell("A3").value).toBe("직접경비 개인 집행내역");
    expect(mar.getCell("A4").value).toBeNull();
    expect(mar.getCell("C4").value).toBeNull();
    expect(result(mar.getCell("G2").value)).toBe(0);
    // 총괄현황 월별 집행 현황: 1월 10,000 / 2월 20,000 / 3월 0, 합계 30,000 (총합계 열 = 결제자 1 + 공용 + 본사 다음)
    const sum = wb.getWorksheet("총괄현황")!;
    const totalCol = 3 + 1 + 2; // C=결제자, D=공용법인카드, E=본사, F=총합계
    expect([20, 21, 22].map((r) => result(sum.getCell(r, totalCol).value))).toEqual([10_000, 20_000, 0]);
    expect(result(sum.getCell(23, totalCol).value)).toBe(30_000);
    // 예산 시트: 지출 = 1~2월, 3월 열 0
    const budget = wb.getWorksheet("프로젝트 운영비(작성금지)")!;
    expect(result(budget.getCell("H3").value)).toBe(30_000);
    expect(result(budget.getCell("L3").value)).toBe(0);
    expect(result(budget.getCell("I3").value)).toBe(270_000);
  });

  it("ym 없음: 전체 (3월 데이터 포함, 기존 파일 이름)", async () => {
    const { buildWorkbook } = await import("@/lib/export");
    const { buffer, filename, status } = await buildWorkbook("p1");
    expect(status).toBeUndefined();
    expect(filename).toBe("2026-2026 범위 팀 운영비(26.03).xlsx");
    const wb = await load(buffer);
    expect(wb.getWorksheet("3월")!.getCell("C4").value).toBe(40_000);
    expect(result(wb.getWorksheet("프로젝트 운영비(작성금지)")!.getCell("H3").value)).toBe(70_000);
  });

  it("승인된 달·현재 데이터 버전 파일 이름, 기간 밖 달은 400", async () => {
    const { buildWorkbook, loadWorkbookData } = await import("@/lib/export");
    expect((await buildWorkbook("p1", "2026-01")).filename).toContain("_승인본_");
    expect((await buildWorkbook("p1", "2026-01", { live: true })).filename).toContain("_수정본_현재_");
    expect((await buildWorkbook("p1", "2026-03")).filename).toContain("_작성중_");
    await expect(loadWorkbookData("p1", "2027-01")).rejects.toThrow("프로젝트 기간");
  });

  it("같은 데이터는 같은 파일 — renderWorkbook 두 번의 SHA-256이 같다 (스냅샷 대조 가능)", async () => {
    const { loadWorkbookData, renderWorkbook } = await import("@/lib/export");
    const { sha256Hex } = await import("@/lib/snapshot-server");
    const data = await loadWorkbookData("p1", "2026-02");
    const a = await renderWorkbook(data);
    const b = await renderWorkbook(data);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    // 범위가 다르면 다른 파일
    expect(sha256Hex(await renderWorkbook(await loadWorkbookData("p1", "2026-01")))).not.toBe(sha256Hex(a));
  });
});
