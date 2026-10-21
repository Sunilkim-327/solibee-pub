// 엑셀 출력 회귀 검사 — 가짜 데이터(실제 양식 데이터 아님)로 워크북을 만들어 시트 구성·셀·수식·서식이 바뀌지 않았는지 확인
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const project = {
  id: "p1", name: "테스트 팀", startDate: d("2026-01-01"), endDate: d("2026-03-31"), fiscalStart: 12, code: null, parentId: null,
  departmentId: null, clientPassEnabled: false, clientPassName: null, clientPassItemIds: null, seriesId: null, round: null,
  closedAt: null, closedBy: null, archivedAt: null,
};
const categories = [
  { id: "food", name: "식대", order: 1 },
  { id: "misc", name: "기타 경비", order: 2 },
  { id: "client-pass", name: "업체 출입증", order: 3 },
];
const item = (id: string, name: string, categoryId: string, order: number, active = true) => ({
  id, projectId: "p1", code: null, categoryId, name, accountCode: categoryId === "food" ? "복리후생비" : null, keywords: null,
  perPersonLimit: null, perCaseLimit: null, hardBudget: false, needsAttendees: true, order, active, isDefault: true, linkedItemId: null,
  category: categories.find((c) => c.id === categoryId)!,
});
const items = [
  item("night", "야근식대", "food", 1), item("snack", "간식비", "food", 2), item("team", "회식*비", "food", 3),
  item("supply", "소모품", "misc", 1), item("old", "폐지 항목", "misc", 2, false), item("pass", "출입증 식사", "client-pass", 1),
];
const line = (id: string, itemId: string, detail: string, unitPrice: number, periods: number, order: number, bundleItemIds: string | null = null) => ({
  id, projectId: "p1", itemId, detail, unitPrice, periods, planned: unitPrice * periods, bundleItemIds, order, changeId: null,
});
const lines = [
  line("l1", "night", "야근 식사 묶음", 300_000, 3, 1, '["snack"]'),
  line("l2", "team", "회식", 100_000, 3, 2),
  line("l3", "supply", "소모품 A", 20_000, 3, 3),
  line("l4", "supply", "소모품 B", 10_000, 3, 4),
];
const users = { u1: { name: "가나다", position: "책임" }, u2: { name: "라마바", position: "선임" }, u3: { name: "사아자", position: null }, h1: { name: "재무담당", position: null } };
let seq = 0;
const exp = (payerId: keyof typeof users, date: string, amount: number, payMethod: string, itemId: string, extra: Partial<{ isHq: boolean; headcount: number; attendees: string }> = {}) => {
  const it = items.find((i) => i.id === itemId)!;
  seq++;
  return {
    id: `e${seq}`, projectId: "p1", payerId, date: d(date), amount, payMethod, itemId, detail: `세부 ${seq}`, headcount: extra.headcount ?? null,
    attendees: extra.attendees ?? null, merchant: null, hasExternal: false, flags: null, justification: null, isHq: extra.isHq ?? false,
    changeId: null, yearMonth: date.slice(0, 7), createdBy: payerId, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)), updatedAt: d("2026-01-01"),
    payer: users[payerId], item: it,
  };
};
const expenses = [
  exp("u1", "2026-01-05", 12_000, "PERSONAL_CARD", "night", { headcount: 2, attendees: "가나다, 라마바" }),
  exp("u2", "2026-01-07", 8_000, "PERSONAL_CARD", "snack"),
  exp("u1", "2026-01-07", 50_000, "SHARED_CARD", "team", { headcount: 5 }),
  exp("h1", "2026-01-20", 30_000, "HQ", "supply", { isHq: true }),
  exp("u3", "2026-02-03", 15_000, "PERSONAL_CARD", "night"),
  exp("u2", "2026-02-10", 9_000, "PERSONAL_CARD", "old"),
  exp("u1", "2026-02-11", 70_000, "PERSONAL_CARD", "team", { headcount: 4, attendees: "외부 거래처" }),
];
/** 출입증 회사 부담 줄 (기본은 없음 — 기준 워크북과 같아야 함) */
let passLines: import("@/lib/pass-budget").PassCompanyLine[] = [];
const passCalls: unknown[] = [];
const members = [
  { projectId: "p1", userId: "u1", isPayer: true, isPm: true, user: { id: "u1", ...users.u1, role: "MANAGER" } },
  { projectId: "p1", userId: "u2", isPayer: true, isPm: false, user: { id: "u2", ...users.u2, role: "MEMBER" } },
];
const closings = [{ id: "c1", projectId: "p1", yearMonth: "2026-01", status: "APPROVED", closedAt: null, submittedAt: null, reviewedAt: null, reviewedBy: null, reviewNote: null }];

// 요청한 칸만 돌려주는 단순 select 흉내 (include·관계는 그대로 둠)
function pick<T extends Record<string, unknown>>(row: T, select?: Record<string, unknown>) {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
}
type Args = { where?: Record<string, unknown>; select?: Record<string, unknown> };
const byOrder = <T extends { order: number }>(xs: T[]) => [...xs].sort((a, b) => a.order - b.order);

vi.mock("@/lib/access", () => ({ audit: async () => {}, HttpError: class HttpError extends Error {} }));

// 직접 SQL 조회(lib/sql-loaders.ts)도 같은 가짜 데이터로 (Prisma 흉내와 같은 결과)
vi.mock("@/lib/sql-loaders", () => ({
  sqlPassCompanyLines: async (ids: string[], o?: unknown) => { passCalls.push([ids, o]); return passLines; },
  sqlProjectMembers: async () => members.map((m) => ({ ...m, leftAt: null, user: { ...m.user, active: true } })),
  sqlClosingRows: async () => closings.map(({ id, yearMonth, status, reviewNote }) => ({ id, yearMonth, status, reviewNote })),
  sqlBudgetLines: async () => byOrder(lines).map(({ itemId, planned, periods, bundleItemIds }) => ({ itemId, planned, periods, bundleItemIds })),
  sqlExpenseMonthSums: async () => {
    const sums = new Map<string, { projectId: string; itemId: string; yearMonth: string; amount: number }>();
    for (const e of expenses) {
      const k = `${e.projectId}|${e.itemId}|${e.yearMonth}`;
      const s = sums.get(k) ?? { projectId: e.projectId, itemId: e.itemId, yearMonth: e.yearMonth, amount: 0 };
      s.amount += e.amount;
      sums.set(k, s);
    }
    return [...sums.values()];
  },
}));

vi.mock("@/lib/db", () => ({
  toNumber: (v: unknown) => (v == null ? 0 : Number(v)),
  prisma: {
    project: {
      findUniqueOrThrow: async () => project,
      findUnique: async () => project,
      findMany: async () => [project],
    },
    budgetLine: { findMany: async (a: Args = {}) => byOrder(lines).map((l) => pick(l, a.select)) },
    expense: {
      findMany: async (a: Args = {}) => {
        const ym = a.where?.yearMonth;
        const list = [...expenses].sort((x, y) => x.date.getTime() - y.date.getTime() || x.createdAt.getTime() - y.createdAt.getTime());
        return list.filter((e) => typeof ym !== "string" || e.yearMonth === ym).map((e) => pick(e, a.select));
      },
    },
    item: { findMany: async () => [...items].sort((a, b) => a.category.order - b.category.order || a.order - b.order) },
    monthlyClosing: {
      findMany: async (a: Args = {}) => closings.map((c) => pick(c, a.select)),
      findUnique: async (a: { where: { projectId_yearMonth: { yearMonth: string } } }) => closings.find((c) => c.yearMonth === a.where.projectId_yearMonth.yearMonth) ?? null,
    },
    projectMember: { findMany: async () => members },
    category: {
      findMany: async () => byOrder(categories)
        .filter((c) => c.id !== "client-pass")
        .map((c) => ({ ...c, items: byOrder(items.filter((i) => i.categoryId === c.id && i.active)).map(({ category: _c, ...i }) => i) })),
    },
  },
}));

/** 워크북 → 비교용 문자열 (시트·셀 값·수식·서식·병합·유효성검사·이름 정의) */
async function dump(buffer: Buffer | ArrayBuffer | Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const sheets = wb.worksheets.map((ws) => ({
    name: ws.name,
    state: ws.state,
    views: ws.views,
    columns: (ws.columns ?? []).map((c) => c.width ?? null),
    merges: Object.keys((ws as unknown as { _merges: Record<string, unknown> })._merges).sort(),
    cells: (() => {
      const out: unknown[] = [];
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        row.eachCell({ includeEmpty: true }, (c, n) => {
          out.push([r, n, row.height ?? null, c.value instanceof Date ? c.value.toISOString() : c.value, c.numFmt ?? null, c.style, c.dataValidation ?? null]);
        });
      });
      return out;
    })(),
  }));
  return JSON.stringify({ sheets, names: wb.definedNames.model, views: wb.views });
}

describe("buildWorkbook (엑셀 양식 회귀)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-02-15T03:00:00Z")); });
  afterAll(() => { vi.useRealTimers(); });

  it("가짜 데이터로 만든 워크북이 기준과 같다", async () => {
    const { buildWorkbook } = await import("@/lib/export");
    const { buffer, filename } = await buildWorkbook("p1", "2026-02");
    // ym 지정 → 상태·시각 접미 (lib/snapshot.ts workbookFilename): 2026-02은 마감 기록이 없어 작성중, 시각은 고정한 시스템 시각(KST 12:00)
    expect(filename).toBe("2026-2026 테스트 팀 운영비(26.02)_작성중_2026-02-15 1200.xlsx");
    const text = await dump(buffer);
    const wb = JSON.parse(text) as { sheets: { name: string }[] };
    expect(wb.sheets.map((s) => s.name)).toMatchSnapshot("sheets");
    expect(createHash("sha256").update(text).digest("hex")).toMatchSnapshot("hash");
    // 파일 바이트까지 같은지 (시각 고정 시 exceljs 출력은 결정적)
    expect(createHash("sha256").update(Buffer.from(buffer)).digest("hex")).toMatchSnapshot("bytes");
  });
});

// ── 출입증 회사 부담 줄 · 이 달 시트만 (가상의 값) ──
const pl = (x: Partial<import("@/lib/pass-budget").PassCompanyLine>): import("@/lib/pass-budget").PassCompanyLine => ({
  id: `pl${Math.random()}`, projectId: "p1", yearMonth: "2026-02", confirmed: true, userId: "u2", date: "2026-02-04", amount: 9_000,
  decision: "OVERTIME", memberClaim: null, onBehalfName: null, usageItemId: "pass", usageItemName: "출입증 식사",
  linkedItemId: "night", linkedItemName: "야근식대", linkedCategoryName: "식대", placeType: "식당", place: null, time: null, ...x,
});

/** 시트의 값·수식 (서식 제외) — r행 c열 */
function grid(ws: ExcelJS.Worksheet) {
  const out: Record<string, unknown> = {};
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (c, n) => {
    const v = c.value as ExcelJS.CellFormulaValue | Date | unknown;
    out[`${r}:${n}`] = v instanceof Date ? v.toISOString() : v && typeof v === "object" && "formula" in (v as object) ? { f: (v as ExcelJS.CellFormulaValue).formula, r: (v as ExcelJS.CellFormulaValue).result } : v;
  }));
  return out;
}
const load = async (buffer: Buffer | ArrayBuffer | Uint8Array) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer as ArrayBuffer); return wb; };

describe("출입증 회사 부담 → 상신 엑셀 (본사 집행내역 · 예산 대비 집행)", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-02-15T03:00:00Z"));
    passLines = [
      pl({ amount: 9_000 }), pl({ amount: 6_000, date: "2026-02-05", userId: "u1" }),
      pl({ amount: 50_000, confirmed: false }), // 확정 전 → 엑셀에 없음
      pl({ amount: 4_000, linkedItemId: null, linkedItemName: null, linkedCategoryName: null }), // 연결 없음 → 없음
    ];
  });
  afterAll(() => { passLines = []; vi.useRealTimers(); });

  it("월 시트: 본사 집행내역에 출입증 사용 건마다 한 줄(사용일), 총합계·본사 합계·검증", async () => {
    const { buildWorkbook } = await import("@/lib/export");
    const wb = await load((await buildWorkbook("p1", "2026-02")).buffer);
    const ws = wb.getWorksheet("2월")!;
    const hqHead = 44; // 3 + 개인 40행 + 1
    expect(ws.getCell(`A${hqHead}`).value).toBe("직접경비 본사 집행내역");
    const row = ws.getRow(hqHead + 1).values as unknown[];
    // 사용 건마다 한 줄, 날짜 = 사용일 (이름을 모르는 가상 사용자라 참석자 칸은 비어 있다)
    expect(row.slice(1, 8)).toEqual(["본사", new Date("2026-02-04T00:00:00Z"), 9_000, "본사지출", "식대", "야근식대", "야근식대/업체 출입증"]);
    const row2 = ws.getRow(hqHead + 2).values as unknown[];
    expect(row2.slice(1, 8)).toEqual(["본사", new Date("2026-02-05T00:00:00Z"), 6_000, "본사지출", "식대", "야근식대", "야근식대/업체 출입증"]);
    const res = (a: string) => (ws.getCell(a).value as ExcelJS.CellFormulaValue).result;
    // 2월 카드: 개인 15,000 + 9,000 + 70,000 = 94,000 / 본사 = 출입증 15,000
    expect(res("G3")).toBe(94_000);
    expect(res(`G${hqHead}`)).toBe(15_000);
    expect(res("G2")).toBe(109_000);
    // K:L 블록 본사(=SUMIF "본사") 에 출입증 포함, 팀원별 정산에는 없음, 검증 TRUE
    const kl: Record<string, unknown> = {};
    ws.eachRow((r) => { const k = r.getCell(11).value; if (typeof k === "string") kl[k] = (r.getCell(12).value as ExcelJS.CellFormulaValue)?.result; });
    expect(kl["본사"]).toBe(15_000);
    expect(kl["라마바"]).toBe(9_000);
    expect(kl["계"]).toBe(109_000);
    // 예산 대비 집행: 야근식대(+간식비 묶음) 2월 = 카드 15,000 + 출입증 15,000
    const budget = wb.getWorksheet("프로젝트 운영비(작성금지)")!;
    let found = false;
    budget.eachRow((r) => {
      if (String(r.getCell(3).value).startsWith("야근식대")) {
        found = true;
        expect((r.getCell(11).value as ExcelJS.CellFormulaValue).result).toBe(30_000); // J=12월? 기간 1~3월 → J=1월, K=2월
      }
    });
    expect(found).toBe(true);
    // 총괄현황 월별 총합계도 같은 값
    const sum = wb.getWorksheet("총괄현황")!;
    let total: unknown;
    sum.eachRow((r) => { if (r.getCell(2).value === "2월") r.eachCell((c) => { const v = c.value as ExcelJS.CellFormulaValue; if (v?.formula === "'2월'!G2") total = v.result; }); });
    expect(total).toBe(109_000);
  });

  it("이 달 시트만: 전체 통합문서의 같은 달 시트와 값·수식이 같고, 다른 시트 참조·이름 정의가 없다", async () => {
    const { buildWorkbook, buildMonthSheet } = await import("@/lib/export");
    passCalls.length = 0;
    const single = await buildMonthSheet("p1", "2026-02");
    // 그 달 명세만 조회
    expect(passCalls).toEqual([[["p1"], { yearMonths: ["2026-02"] }]]);
    expect(single.filename).toBe("2026-2026 테스트 팀 운영비(26.02) 2월 시트_작성중.xlsx");
    const one = await load(single.buffer);
    expect(one.worksheets.map((w) => w.name)).toEqual(["2월"]);
    const full = await load((await buildWorkbook("p1", "2026-02")).buffer);
    expect(grid(one.worksheets[0])).toEqual(grid(full.getWorksheet("2월")!));
    // 승인된 달은 파일 이름에 상태
    expect((await buildMonthSheet("p1", "2026-01")).filename).toContain("1월 시트_승인");
    // 다른 시트·이름 참조 없음 (수식·드롭다운)
    expect(one.definedNames.model).toEqual([]);
    const ws = one.worksheets[0];
    ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as ExcelJS.CellFormulaValue;
      if (v && typeof v === "object" && "formula" in v) expect(v.formula).not.toMatch(/!|#REF/);
      const dv = c.dataValidation;
      if (dv?.formulae) for (const f of dv.formulae) expect(f instanceof Date || /^".*"$/.test(String(f))).toBe(true);
    }));
    expect(ws.getCell("D4").dataValidation?.formulae).toEqual(['"개인식법인카드,공용법인카드,본사지출"']);
    expect(ws.getCell("F4").dataValidation?.formulae ?? null).toBeNull();
  });

  it("기간 밖 달은 거절", async () => {
    const { buildMonthSheet } = await import("@/lib/export");
    await expect(buildMonthSheet("p1", "2027-01")).rejects.toThrow();
  });
});

// ── 출장비 구역 (그 달에 출장비 지출이 있을 때만) — 가상의 값 ──
describe("출장비 구역", () => {
  const tripCat = { id: "trip", name: "출장비", order: 4 };
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-02-15T03:00:00Z"));
    categories.push(tripCat);
    items.push(item("ktx", "출장 교통", "trip", 1));
    expenses.push(
      exp("u2", "2026-02-12", 59_800, "PERSONAL_CARD", "ktx"), // 개인카드 출장비 → 출장비 구역
      exp("h1", "2026-02-13", 120_000, "HQ", "ktx", { isHq: true }), // 본사 결제 출장비 → 본사 집행내역
    );
  });
  afterAll(() => { categories.pop(); items.pop(); expenses.splice(-2); vi.useRealTimers(); });

  const res = (ws: ExcelJS.Worksheet, a: string) => (ws.getCell(a).value as ExcelJS.CellFormulaValue).result;
  const fx = (ws: ExcelJS.Worksheet, a: string) => (ws.getCell(a).value as ExcelJS.CellFormulaValue).formula;

  it("출장비가 있는 달: 개인 집행내역과 본사 집행내역 사이에 구역, 총합계·검증·SUMIF는 한 번만", async () => {
    const { buildWorkbook } = await import("@/lib/export");
    const wb = await load((await buildWorkbook("p1", "2026-02")).buffer);
    const ws = wb.getWorksheet("2월")!;
    // 개인 40행(4~43) → 44행 출장비 구역 제목 → 45~60행(16행) → 61행 본사 집행내역
    expect(ws.getCell("A44").value).toBe("출장비(신청서/보고서 품의 필수)");
    expect(fx(ws, "G44")).toBe("SUM(C45:C60)");
    expect(ws.getCell("A61").value).toBe("직접경비 본사 집행내역");
    expect(fx(ws, "G2")).toBe("G3+G61+G44");
    expect((ws.getRow(45).values as unknown[]).slice(1, 7)).toEqual(["라마바", new Date("2026-02-12T00:00:00Z"), 59_800, "개인식법인카드", "출장비", "출장 교통"]);
    // 본사 결제 출장비는 본사 집행내역에
    expect((ws.getRow(62).values as unknown[]).slice(1, 7)).toEqual(["본사", new Date("2026-02-13T00:00:00Z"), 120_000, "본사지출", "출장비", "출장 교통"]);
    expect(res(ws, "G3")).toBe(94_000); // 출장비 제외 개인
    expect(res(ws, "G44")).toBe(59_800);
    expect(res(ws, "G61")).toBe(120_000);
    expect(res(ws, "G2")).toBe(94_000 + 59_800 + 120_000);
    // 오른쪽 정산: 결제자 SUMIF는 열 전체라 출장비 행도 그 사람 정산에 (한 번)
    const kl: Record<string, unknown> = {};
    ws.eachRow((r) => { const k = r.getCell(11).value; if (typeof k === "string") kl[k] = (r.getCell(12).value as ExcelJS.CellFormulaValue)?.result; });
    expect(kl["라마바"]).toBe(9_000 + 59_800);
    expect(kl["계"]).toBe(273_800);
    let check: unknown; ws.eachRow((r) => { const v = r.getCell(12).value as ExcelJS.CellFormulaValue; if (v?.formula?.startsWith("G2=")) check = v.result; });
    expect(check).toBe(true);
    // 예산 시트: 항목 SUMIF(F열)로 구역 상관없이 한 번 — 출장 교통 2월 = 59,800 + 120,000
    const budget = wb.getWorksheet("프로젝트 운영비(작성금지)")!;
    let v: unknown; budget.eachRow((r) => { if (r.getCell(3).value === "출장 교통") v = (r.getCell(11).value as ExcelJS.CellFormulaValue).result; });
    expect(v).toBe(179_800);
    // 출장비가 없는 달은 구역 없이 기존 양식 (1월)
    const jan = wb.getWorksheet("1월")!;
    expect(fx(jan, "G2")).toBe("G3+G44");
    expect(jan.getCell("A44").value).toBe("직접경비 본사 집행내역");
    let janTravel = false; jan.eachRow((r) => { if (String(r.getCell(1).value).startsWith("출장비")) janTravel = true; });
    expect(janTravel).toBe(false);
  });

  it("이 달 시트만도 같은 구역 (전체 통합문서와 같다)", async () => {
    const { buildWorkbook, buildMonthSheet } = await import("@/lib/export");
    const one = await load((await buildMonthSheet("p1", "2026-02")).buffer);
    const full = await load((await buildWorkbook("p1", "2026-02")).buffer);
    expect(grid(one.worksheets[0])).toEqual(grid(full.getWorksheet("2월")!));
    expect(fx(one.worksheets[0], "G2")).toBe("G3+G61+G44");
  });
});
