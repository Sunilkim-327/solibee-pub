// 상신 엑셀 — 메인 + 메인과 함께 상신하는 서브 합본 (가상의 값, 실제 양식 데이터 아님)
// 월 시트 F열 = "구분명_항목", '프로젝트 운영비' 시트 SUMIF 조건과 글자까지 같은지, 합계·정산 블록·출입증 줄, 이 달 시트만도 같은지
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const base = {
  fiscalStart: 1, code: null, departmentId: null, clientPassEnabled: false, clientPassName: null, clientPassItemIds: null, passDisplayItems: null,
  seriesId: null, round: null, closedAt: null, closedBy: null, archivedAt: null,
};
// 메인 1~3월 / 서브 1~6월 (메인 기간을 넘는 달은 이 메인과 함께 상신하지 않고, 예산은 귀속 개월 비율로)
const main = { ...base, id: "m", name: "가상 운영팀", startDate: d("2026-01-01"), endDate: d("2026-03-31"), parentId: null, settleWithParent: false, excelPrefix: "운영" };
const sub = { ...base, id: "s", name: "가상 대응 과업", startDate: d("2026-01-01"), endDate: d("2026-06-30"), parentId: "m", settleWithParent: true, excelPrefix: "대응" };
const solo = { ...base, id: "x", name: "따로 상신", startDate: d("2026-01-01"), endDate: d("2026-03-31"), parentId: "m", settleWithParent: false, excelPrefix: null };
const projects = [main, sub, solo];

const categories = [{ id: "food", name: "식대", order: 1 }, { id: "ops", name: "운영비", order: 2 }];
const item = (id: string, projectId: string, name: string, categoryId: string, order: number, code: string) => ({
  id, projectId, code, categoryId, name, accountCode: null, keywords: null, perPersonLimit: null, perCaseLimit: null, hardBudget: false, needsAttendees: true,
  order, active: true, isDefault: true, linkedItemId: null, category: categories.find((c) => c.id === categoryId)!,
});
const items = [
  item("mNight", "m", "야근식대", "food", 1, "food-01"),
  item("sNight", "s", "야근식대", "food", 1, "food-01"),
  item("sPm", "s", "PM운영비", "ops", 1, "ops-01"),
  item("xNight", "x", "야근식대", "food", 1, "food-01"),
];
const line = (id: string, projectId: string, itemId: string, unitPrice: number, periods: number, order: number) => ({
  id, projectId, itemId, detail: `가상 ${id}`, unitPrice, periods, planned: unitPrice * periods, bundleItemIds: null, order, changeId: null,
});
const lines = [line("l1", "m", "mNight", 100_000, 3, 1), line("l2", "s", "sNight", 50_000, 6, 1), line("l3", "s", "sPm", 30_000, 3, 2), line("l4", "x", "xNight", 10_000, 3, 1)];
const users = { u1: { name: "가나다", position: "책임" }, u2: { name: "라마바", position: "사원" }, v1: { name: "하위팀원", position: "선임" }, h1: { name: "재무담당", position: null } };
let seq = 0;
const exp = (projectId: string, payerId: keyof typeof users, date: string, amount: number, payMethod: string, itemId: string, isHq = false) => {
  seq++;
  return {
    id: `e${seq}`, projectId, payerId, date: d(date), amount, payMethod, itemId, detail: `가상 세부 ${seq}`, headcount: 1, attendees: "가상",
    merchant: null, hasExternal: false, flags: null, justification: null, isHq, changeId: null, yearMonth: date.slice(0, 7), createdBy: payerId,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)), updatedAt: d("2026-01-01"), payer: users[payerId], item: items.find((i) => i.id === itemId)!,
  };
};
const expenses = [
  exp("m", "u1", "2026-01-05", 12_000, "PERSONAL_CARD", "mNight"),
  exp("s", "v1", "2026-01-06", 8_000, "PERSONAL_CARD", "sNight"),
  exp("m", "u2", "2026-01-07", 9_000, "PERSONAL_CARD", "mNight"),
  exp("s", "v1", "2026-02-03", 20_000, "PERSONAL_CARD", "sPm"),
  exp("s", "h1", "2026-02-10", 30_000, "HQ", "sNight", true),
  exp("s", "v1", "2026-04-02", 77_000, "PERSONAL_CARD", "sNight"), // 메인 기간 밖 → 이 상신에 없음
  exp("x", "u2", "2026-01-09", 5_000, "PERSONAL_CARD", "xNight"), // 따로 상신하는 서브 → 없음
];
const members = [
  { projectId: "m", userId: "u1", isPayer: true, isPm: true, user: { id: "u1", ...users.u1, role: "MANAGER" } },
  { projectId: "m", userId: "u2", isPayer: true, isPm: false, user: { id: "u2", ...users.u2, role: "MEMBER" } },
  { projectId: "s", userId: "v1", isPayer: true, isPm: false, user: { id: "v1", ...users.v1, role: "MEMBER" } },
];
// 출입증 회사 부담 확정분: 서브 → 본사 집행내역 줄 (대응_야근식대)
const passLines = [{
  id: "pl1", projectId: "s", yearMonth: "2026-02", confirmed: true, userId: "v1", date: "2026-02-04", amount: 6_000, decision: "OVERTIME", memberClaim: null,
  onBehalfName: null, usageItemId: "sPass", usageItemName: "출입증 식사", linkedItemId: "sNight", linkedItemName: "야근식대", linkedCategoryName: "식대",
  placeType: "식당", place: null, time: null,
}];

type Where = { projectId?: string | { in: string[] }; yearMonth?: string; active?: boolean; id?: unknown };
const inWhere = (w: Where | undefined, projectId: string | null) => {
  const p = w?.projectId;
  if (p === undefined) return true;
  return typeof p === "string" ? projectId === p : p.in.includes(projectId ?? "");
};
const byOrder = <T extends { order: number }>(xs: T[]) => [...xs].sort((a, b) => a.order - b.order);

vi.mock("@/lib/access", () => ({ audit: async () => {}, HttpError: class HttpError extends Error {} }));
vi.mock("@/lib/sql-loaders", () => ({
  sqlPassCompanyLines: async (ids: string[]) => passLines.filter((l) => ids.includes(l.projectId)),
  sqlProjectMembers: async (ids: string[]) => members.filter((m) => ids.includes(m.projectId)).map((m) => ({ ...m, leftAt: null, user: { ...m.user, active: true } })),
  sqlClosingRows: async () => [],
}));
vi.mock("@/lib/db", () => ({
  toNumber: (v: unknown) => (v == null ? 0 : Number(v)),
  prisma: {
    project: {
      findUniqueOrThrow: async (a: { where: { id: string } }) => projects.find((p) => p.id === a.where.id)!,
      findMany: async () => projects,
    },
    budgetLine: { findMany: async (a: { where?: Where } = {}) => byOrder(lines.filter((l) => inWhere(a.where, l.projectId))) },
    expense: {
      findMany: async (a: { where?: Where } = {}) => [...expenses]
        .sort((x, y) => x.date.getTime() - y.date.getTime() || x.createdAt.getTime() - y.createdAt.getTime())
        .filter((e) => inWhere(a.where, e.projectId) && (typeof a.where?.yearMonth !== "string" || e.yearMonth === a.where.yearMonth)),
    },
    item: {
      findMany: async (a: { where?: Where } = {}) => items.filter((i) => inWhere(a.where, i.projectId))
        .sort((x, y) => x.category.order - y.category.order || x.order - y.order),
    },
    monthlyClosing: { findMany: async () => [], findUnique: async () => null },
    category: {
      findMany: async (a: { include?: { items?: { where?: Where } } } = {}) => byOrder(categories).map((c) => ({
        ...c, items: byOrder(items.filter((i) => i.categoryId === c.id && inWhere(a.include?.items?.where, i.projectId))).map(({ category: _c, ...i }) => i),
      })),
    },
  },
}));

const load = async (buffer: Buffer | ArrayBuffer | Uint8Array) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer as ArrayBuffer); return wb; };
type FV = ExcelJS.CellFormulaValue;
const res = (ws: ExcelJS.Worksheet, a: string) => (ws.getCell(a).value as FV).result;
/** 월 시트 지출 줄: [A, F, C] */
function monthRows(ws: ExcelJS.Worksheet) {
  const out: { a: string; f: string; c: number; d: string }[] = [];
  ws.eachRow((r, n) => { if (n >= 4 && typeof r.getCell(3).value === "number") out.push({ a: String(r.getCell(1).value), f: String(r.getCell(6).value), c: r.getCell(3).value as number, d: String(r.getCell(4).value) }); });
  return out;
}
function grid(ws: ExcelJS.Worksheet) {
  const out: Record<string, unknown> = {};
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (c, n) => {
    const v = c.value as FV | Date | unknown;
    out[`${r}:${n}`] = v instanceof Date ? v.toISOString() : v && typeof v === "object" && "formula" in (v as object) ? { f: (v as FV).formula, r: (v as FV).result } : v;
  }));
  return out;
}

describe("상신 엑셀: 메인 + 함께 상신하는 서브", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-03-15T03:00:00Z")); });
  afterAll(() => { vi.useRealTimers(); });

  it("월 시트: 메인·서브 지출을 한 시트에, F열 = 구분명_항목, 정산 블록에 서브 팀원, 기간 밖·따로 상신 서브는 없음", async () => {
    const { buildWorkbook } = await import("@/lib/export");
    const { buffer, filename } = await buildWorkbook("m", "2026-02");
    expect(filename).toBe("2026-2026 가상 운영팀 운영비(26.02)_작성중_2026-03-15 1200.xlsx");
    const wb = await load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["총괄현황", "프로젝트 운영비(작성금지)", "1월", "2월", "3월", "유효성검사_편집삭제금지", "데이터시트"]);
    const jan = wb.getWorksheet("1월")!;
    expect(monthRows(jan)).toEqual([
      { a: "가나다", f: "운영_야근식대", c: 12_000, d: "개인식법인카드" },
      { a: "하위팀원", f: "대응_야근식대", c: 8_000, d: "개인식법인카드" },
      { a: "라마바", f: "운영_야근식대", c: 9_000, d: "개인식법인카드" },
    ]);
    // 정산 블록: 결제자(직급 → 성명, 서브 팀원 포함) · 계 · 검증
    const kl: Record<string, unknown> = {};
    jan.eachRow((r) => { const k = r.getCell(11).value; if (typeof k === "string") kl[k] = (r.getCell(12).value as FV)?.result; });
    expect(kl).toMatchObject({ 가나다: 12_000, 하위팀원: 8_000, 라마바: 9_000, 계: 29_000 });
    expect(res(jan, "G2")).toBe(29_000);
    // 2월: 서브 본사 지출 + 서브 출입증 회사 부담(본사 집행내역, 구분명 붙음)
    const feb = wb.getWorksheet("2월")!;
    const febRows = monthRows(feb);
    expect(febRows).toEqual([
      { a: "하위팀원", f: "대응_PM운영비", c: 20_000, d: "개인식법인카드" },
      // 본사 집행내역은 날짜순: 출입증 2/4 → 본사 지출 2/10
      { a: "본사", f: "대응_야근식대", c: 6_000, d: "본사지출" },
      { a: "본사", f: "대응_야근식대", c: 30_000, d: "본사지출" },
    ]);
    expect(res(feb, "G2")).toBe(56_000);
    // 3월에 4월 지출(메인 기간 밖)·따로 상신 서브 지출은 어디에도 없다
    for (const ws of [jan, feb, wb.getWorksheet("3월")!]) for (const r of monthRows(ws)) expect([77_000, 5_000]).not.toContain(r.c);
    // 유효성검사 목록: 구분명 붙은 항목
    const valid = wb.getWorksheet("유효성검사_편집삭제금지")!;
    const names: string[] = [];
    valid.eachRow((r) => { const v = r.getCell(2).value; if (typeof v === "string") names.push(v); });
    expect(names).toEqual(expect.arrayContaining(["운영_야근식대", "대응_야근식대", "대응_PM운영비"]));
  });

  it("프로젝트 운영비 시트: 메인 행 다음 서브 행, SUMIF 조건 = 월 시트 F열 글자, 결과 = 그 글자의 합, 총합계·총괄현황 서브 포함", async () => {
    const { buildWorkbook } = await import("@/lib/export");
    const wb = await load((await buildWorkbook("m", "2026-02")).buffer);
    const budget = wb.getWorksheet("프로젝트 운영비(작성금지)")!;
    const rows: { r: number; c: string; g: unknown }[] = [];
    budget.eachRow((row, n) => { if (n >= 3 && typeof row.getCell(3).value === "string" && row.getCell(2).value !== "총합계") rows.push({ r: n, c: String(row.getCell(3).value), g: row.getCell(7).value }); });
    expect(rows.map((x) => x.c)).toEqual(["운영_야근식대", "대응_야근식대", "대응_PM운영비"]);
    // 메인: 단가 × 기간 수식 / 서브(6개월): 메인 기간(1~3월) 귀속분 — 야근식대 300,000 → 150,000, PM운영비 90,000 → 45,000 (값)
    expect((rows[0].g as FV).formula).toBe(`E${rows[0].r}*F${rows[0].r}`);
    expect([rows[1].g, rows[2].g]).toEqual([150_000, 45_000]);
    const months = ["1월", "2월", "3월"];
    for (const x of rows) {
      months.forEach((m, i) => {
        const v = budget.getCell(x.r, 10 + i).value as FV;
        // 조건은 셀 참조($C행) — 그 셀 글자가 월 시트 F열과 같다
        expect(v.formula).toBe(`SUMIF('${m}'!$F:$F,$C${x.r},'${m}'!$C:$C)`);
        const sum = monthRows(wb.getWorksheet(m)!).filter((r) => r.f === x.c).reduce((a, r) => a + r.c, 0);
        expect(v.result ?? 0).toBe(sum); // 0은 결과 없이 저장될 수 있다
      });
    }
    // 총합계: 계획 = 300,000 + 150,000 + 45,000, 집행 = 1~3월 전체
    let total: ExcelJS.Row | null = null;
    budget.eachRow((row) => { if (row.getCell(2).value === "총합계") total = row; });
    expect(((total as unknown as ExcelJS.Row).getCell(7).value as FV).result).toBe(495_000);
    expect(((total as unknown as ExcelJS.Row).getCell(8).value as FV).result).toBe(29_000 + 56_000);
    const summary = wb.getWorksheet("총괄현황")!;
    expect(res(summary, "H14")).toBe(495_000);
    let feb: unknown;
    summary.eachRow((r) => { if (r.getCell(2).value === "2월") r.eachCell((c) => { const v = c.value as FV; if (v?.formula === "'2월'!G2") feb = v.result; }); });
    expect(feb).toBe(56_000);
  });

  it("이 달 시트만: 전체 통합문서의 같은 달 시트와 값·수식이 같다 (서브 포함)", async () => {
    const { buildWorkbook, buildMonthSheet } = await import("@/lib/export");
    const one = await load((await buildMonthSheet("m", "2026-02")).buffer);
    const full = await load((await buildWorkbook("m", "2026-02")).buffer);
    expect(grid(one.worksheets[0])).toEqual(grid(full.getWorksheet("2월")!));
  });

  it("서브 단독으로 내려받으면 서브 지출만 (구분명 붙음)", async () => {
    const { buildMonthSheet } = await import("@/lib/export");
    const ws = (await load((await buildMonthSheet("s", "2026-01")).buffer)).worksheets[0];
    expect(monthRows(ws)).toEqual([{ a: "하위팀원", f: "대응_야근식대", c: 8_000, d: "개인식법인카드" }]);
  });
});
