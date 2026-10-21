// 기존 상신 양식 엑셀 출력 (docs/PLAN.md PART 2 §6)
// 시트 구성·셀 배치·수식은 기존 양식(sample/ 참고용 파일)의 "구조"를 따른다. 값은 모두 DB에서 온다.
//   총괄현황 | 프로젝트 운영비(작성금지) | 12월, 26.1월 … | 유효성검사_편집삭제금지 | 데이터시트(숨김)
import "server-only";
import ExcelJS from "exceljs";
import { HttpError, audit, type SessionUser } from "./access";
import { prisma } from "./db";
import { currentYearMonth, excelSheetName, formatDate, projectMonths } from "./format";
import { colLetter } from "./pass-statement";
import { DASH_ITEM_ORDER, DASH_ITEM_SELECT, buildDashboard, getClosings, getPayers } from "./reports";
import { settle } from "./settlement";
import { sqlPassCompanyLines } from "./sql-loaders";
import { passBudgetSpend, passExcelRows } from "./pass-budget";
import { servedInMonth } from "./membership";
import { CLOSING_LABEL, PAY_METHOD_EXCEL_LABEL, PAY_METHODS, parseClosingStatus } from "./types";
import { closingStatusIn } from "./closing";
import { workbookFilename } from "./snapshot";
import { PASS_CATEGORY_ID } from "./pass-category";
import { proRate } from "./lifecycle";
import { excelItemName, settleChildIds } from "./settle-group";
import type { PassCompanyLine } from "./pass-budget";
import { MONTH_HEAD, TRAVEL_SECTION, monthSheetData, passRowDate, payerLabels, type MonthSheetData, type MonthSheetRow } from "./month-sheet";
export { monthSheetData, passRowDate, payerLabels, type MonthSheetData, type MonthSheetRow };

// ── 양식 서식 ─────────────────────────────────────────
const FONT = "맑은 고딕";
const ACC = '_-* #,##0_-;-* #,##0_-;_-* "-"_-;_-@_-'; // 회계 서식 (0은 "-")
const WON = '"₩"#,##0';
const DATE_FMT = "yyyy-mm-dd"; // 설계서 §6: 시리얼 숫자 금지, yyyy-mm-dd
const C_HEAD = "FFCDB4DB"; // 컬럼 헤더
const C_SECTION = "FFD9D0DE"; // 섹션 제목·정산 블록
const C_TOTAL = "FF9DF7E5"; // 총합계
const C_LABEL = "FF7030A0"; // 유효성검사 "분류" 라벨
const C_SUMMARY = "FFDDEBF7"; // 총괄현황 헤더

const SHEET_BUDGET = "프로젝트 운영비(작성금지)";
const SHEET_VALID = "유효성검사_편집삭제금지";
const SHEET_DATA = "데이터시트";

// 월 시트 기본 행 수 (양식: 개인 40행, 본사 21행, 결제자 10칸)
const PERSONAL_ROWS = 40;
const HQ_ROWS = 21;
const PAYER_SLOTS = 10;

const thin = { style: "thin" as const };
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

// ── 내보내기 공통 (출입증 명세·사용 내역 엑셀) ─────────────────
/** 얇은 테두리 상자 */
const BOX: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
/** 머리글 채움 */
const HEAD_FILL: ExcelJS.Fill = fill(C_HEAD);
/** 머리글 행 서식: 채움·굵게·테두리·가운데 */
export const headRow = (row: ExcelJS.Row) => row.eachCell((c) => { c.fill = HEAD_FILL; c.font = { bold: true }; c.border = BOX; c.alignment = { horizontal: "center" }; });
/** 1~n열 테두리 */
export const boxRow = (row: ExcelJS.Row, n: number) => { for (let c = 1; c <= n; c++) row.getCell(c).border = BOX; };

/** 엑셀 파일 응답 + 다운로드 이력 (참석자 등 개인정보가 들어 있는 파일) */
export async function xlsxDownload(
  user: Pick<SessionUser, "id">,
  x: {
    projectId: string; entityId: string; filename: string; buffer: Buffer | ArrayBuffer | Uint8Array;
    /** 감사 기록 data에 더 남길 값 (예: 스냅샷 id·SHA-256) */
    data?: Record<string, unknown>;
    /** 응답 헤더 추가 (예: X-Snapshot) */
    headers?: Record<string, string>;
  },
) {
  await audit(user, { projectId: x.projectId, entity: "Export", entityId: x.entityId, action: "download", data: { filename: x.filename, ...x.data } });
  // exceljs writeBuffer()는 Node Buffer(Uint8Array) — 그대로 보내고, ArrayBuffer만 뷰로 감싼다 (복사 없음)
  const body = (x.buffer instanceof Uint8Array ? x.buffer : new Uint8Array(x.buffer)) as Uint8Array<ArrayBuffer>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 개인 정보가 든 파일 — 캐시에 남기지 않음
      "Cache-Control": "no-store, private",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(x.filename)}`,
      ...x.headers,
    },
  });
}

/**
 * SUMIF 조건 문자열: 와일드카드(* ? ~)는 ~로 이스케이프, 비교 연산자(< > =)로 시작하면 "="를 붙여 그대로 비교
 * (수식 안 문자열 따옴표 처리는 하지 않음 — sumifText 사용)
 */
export function sumifCriteria(s: string): string {
  const t = s.replace(/[~*?]/g, "~$&");
  return /^[<>=]/.test(t) ? `=${t}` : t;
}
/** 수식 안 SUMIF 조건 리터럴: "…" */
export const sumifText = (s: string) => `"${sumifCriteria(s).replace(/"/g, '""')}"`;
/** 셀 값을 그대로 SUMIF 조건으로 써도 되는지 (와일드카드·비교 연산자 없음) */
const plainCriteria = (s: string) => sumifCriteria(s) === s;
const center: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };

/** 계산 결과를 함께 기록한 수식 (열자마자 값이 보이고, 엑셀에서 수정하면 재계산) */
const f = (formula: string, result: number | boolean | string) => ({ formula, result }) as ExcelJS.CellFormulaValue;

/** 1부터 시작하는 열 번호 → 열 문자 (1 → A, 27 → AA) */
const col = (n: number) => colLetter(n - 1);

const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

function style(
  cell: ExcelJS.Cell,
  o: { fill?: string; bold?: boolean; fmt?: string; align?: Partial<ExcelJS.Alignment>; border?: boolean; size?: number },
) {
  if (o.fill) cell.fill = fill(o.fill);
  cell.font = { name: FONT, size: o.size ?? 10, bold: !!o.bold };
  if (o.fmt) cell.numFmt = o.fmt;
  if (o.align) cell.alignment = o.align;
  if (o.border) cell.border = BOX;
}

/** 병합 + 값 + 서식 (병합 범위 전체에 테두리·채움) */
function block(ws: ExcelJS.Worksheet, range: string, value: ExcelJS.CellValue, o: Parameters<typeof style>[1]) {
  const [a, b] = range.split(":");
  if (b) ws.mergeCells(range);
  ws.getCell(a).value = value;
  const first = ws.getCell(a);
  const last = ws.getCell(b ?? a);
  for (let r = Number(first.row); r <= Number(last.row); r++) {
    for (let c = Number(first.col); c <= Number(last.col); c++) style(ws.getCell(r, c), o);
  }
}

/** 엑셀 이름 정의로 쓸 수 있는 분류명인지 (INDIRECT 종속 드롭다운용) */
const isValidName = (s: string) => /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(s) && !/^[A-Za-z]{1,3}\d+$/.test(s);


// ── 월 시트 (전체 통합문서·한 달 시트 공통) ─────────────────────────
// 데이터 계산(개인·출장비·본사 줄, 정산, 팀원별 정산금액 칸)은 lib/month-sheet.ts — 재무팀 검토 화면과 같은 계산을 쓴다.
// 원본 '프로젝트 운영비' 시트가 월 시트를 SUMIF('<월>'!$F:$F, 항목, '<월>'!$C:$C)로 합산하므로 F열 = 항목, C열 = 금액을 지킨다.
const MONTH_WIDTHS = [14.45, 14.45, 14.45, 14.45, 14.45, 14.45, 42.2, 5.45, 48, 3.8, 14, 12];
/** 출장비 구역 기본 행 수 (원본 양식의 빈 출장비 구역과 같게) */
const TRAVEL_ROWS = 16;
const RIGHT: Partial<ExcelJS.Alignment> = { horizontal: "right", vertical: "middle" };
const MIDDLE: Partial<ExcelJS.Alignment> = { vertical: "middle" };
const MIDDLE_SHRINK: Partial<ExcelJS.Alignment> = { vertical: "middle", shrinkToFit: true };
const CENTER_SHRINK: Partial<ExcelJS.Alignment> = { ...center, shrinkToFit: true };
/** 월 시트 집행내역 줄의 열별 서식·정렬 (A~I) — 행마다 다시 만들지 않는다 */
const ROW_FORMATS: readonly (readonly [string | undefined, Partial<ExcelJS.Alignment>])[] = [
  [ACC, center],
  [DATE_FMT, center],
  [WON, RIGHT],
  [undefined, center],
  [undefined, CENTER_SHRINK],
  [undefined, CENTER_SHRINK],
  [undefined, MIDDLE_SHRINK],
  ["0_);[Red](0)", MIDDLE],
  [undefined, MIDDLE_SHRINK],
];

/**
 * 입력 드롭다운 — 전체 통합문서는 유효성검사 시트의 이름 정의(날짜·결제방법·분류·INDIRECT(분류)),
 * 한 달 시트(단독 파일)는 다른 시트를 참조하지 않게 날짜 범위·직접 목록으로 (항목 목록은 분류에 따라 바뀌는 INDIRECT라 넣지 않음)
 */
export type MonthValidation =
  | { kind: "names" }
  | { kind: "inline"; methods: string[]; categories: string[]; start: Date; end: Date };

/** 직접 목록 수식 ("a,b,c") — 엑셀 한도(255자)를 넘거나 쉼표가 든 값이 있으면 null (드롭다운 없이) */
export function inlineList(values: string[]): string | null {
  if (!values.length || values.some((v) => v.includes(",") || v.includes('"'))) return null;
  const s = `"${values.join(",")}"`;
  return s.length - 2 <= 255 ? s : null;
}

/** 월 시트 그리기 (전체 통합문서·한 달 시트가 이 함수 하나를 쓴다) */
export function writeMonthSheet(ws: ExcelJS.Worksheet, m: MonthSheetData, validation: MonthValidation) {
  const { personal, travel, hq, st } = m;
  ws.columns = MONTH_WIDTHS.map((width) => ({ width }));

  const pEnd = 3 + Math.max(PERSONAL_ROWS, personal.length);
  // 출장비 구역: 그 달에 출장비 지출이 있을 때만 (개인 집행내역과 본사 집행내역 사이, 원본 양식과 같은 자리)
  const travelHead = travel.length ? pEnd + 1 : null;
  const tEnd = travelHead !== null ? travelHead + Math.max(TRAVEL_ROWS, travel.length) : pEnd;
  const hqHead = tEnd + 1;
  const hEnd = hqHead + Math.max(HQ_ROWS, hq.length);

  // 1행: 컬럼 헤더
  ws.getRow(1).height = 27.75;
  MONTH_HEAD.forEach((h, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = h;
    style(cell, { fill: C_HEAD, bold: true, align: { ...center, wrapText: true }, border: true });
  });

  // 개인 집행내역 합계 = 정산의 개인(비본사) 합계 − 출장비 구역 (출장비는 구역 소계로, 총합계에는 한 번만)
  const pSum = st.personal - m.travelSum;
  const hSum = st.hq;

  // 2~3행: 총합계, 개인 집행내역 / 본사 집행내역 섹션
  ws.getRow(2).height = ws.getRow(3).height = 19.5;
  block(ws, "A2:F2", "총  합 계", { fill: C_TOTAL, bold: true, align: center, border: true });
  block(ws, "G2", f(travelHead !== null ? `G3+G${hqHead}+G${travelHead}` : `G3+G${hqHead}`, pSum + hSum + m.travelSum), { fill: C_TOTAL, bold: true, fmt: WON, border: true });
  block(ws, "A3:F3", "직접경비 개인 집행내역", { fill: C_SECTION, bold: true, align: center, border: true });
  block(ws, "G3", f(`SUM(C4:C${pEnd})`, pSum), { fill: C_SECTION, bold: true, fmt: WON, border: true });
  if (travelHead !== null) {
    block(ws, `A${travelHead}:F${travelHead}`, TRAVEL_SECTION, { fill: C_SECTION, bold: true, align: center, border: true });
    block(ws, `G${travelHead}`, f(`SUM(C${travelHead + 1}:C${tEnd})`, m.travelSum), { fill: C_SECTION, bold: true, fmt: WON, border: true });
  }
  block(ws, `A${hqHead}:F${hqHead}`, "직접경비 본사 집행내역", { fill: C_SECTION, bold: true, align: center, border: true });
  block(ws, `G${hqHead}`, f(`SUM(C${hqHead + 1}:C${hEnd})`, hSum), { fill: C_SECTION, bold: true, fmt: WON, border: true });

  const inline = validation.kind === "inline"
    ? { methods: inlineList(validation.methods), categories: inlineList(validation.categories) }
    : null;
  const writeRows = (list: MonthSheetRow[], start: number, end: number) => {
    for (let r = start; r <= end; r++) {
      const e = list[r - start];
      const row = ws.getRow(r);
      if (e) row.values = [e.label, e.date, e.amount, e.method, e.category, e.item, e.detail, e.headcount, e.attendees];
      ROW_FORMATS.forEach(([fmt, align], i) => style(row.getCell(i + 1), { fmt, align, border: true }));
      if (validation.kind === "names") {
        // 입력 드롭다운 (유효성검사 시트의 이름 정의 참조)
        row.getCell(2).dataValidation = { type: "list", allowBlank: true, formulae: ["날짜"] };
        row.getCell(4).dataValidation = { type: "list", allowBlank: true, formulae: ["결제방법"] };
        row.getCell(5).dataValidation = { type: "list", allowBlank: true, formulae: ["분류"] };
        row.getCell(6).dataValidation = { type: "list", allowBlank: true, formulae: [`INDIRECT($E${r})`] };
      } else {
        // 단독 파일: 다른 시트를 참조하지 않는 드롭다운만
        row.getCell(2).dataValidation = { type: "date", operator: "between", allowBlank: true, formulae: [validation.start, validation.end] };
        if (inline?.methods) row.getCell(4).dataValidation = { type: "list", allowBlank: true, formulae: [inline.methods] };
        if (inline?.categories) row.getCell(5).dataValidation = { type: "list", allowBlank: true, formulae: [inline.categories] };
      }
    }
  };
  writeRows(personal, 4, pEnd);
  if (travelHead !== null) writeRows(travel, travelHead + 1, tEnd);
  writeRows(hq, hqHead + 1, hEnd);

  // 오른쪽 블록 K:L — 팀원별 정산금액
  block(ws, "K1:L1", "팀원별 정산금액", { fill: C_SECTION, bold: true, align: center, border: true });
  block(ws, "K2", "결제자", { fill: C_SECTION, bold: true, align: center, border: true });
  block(ws, "L2", "금액", { fill: C_SECTION, bold: true, align: center, border: true });

  const slots = Math.max(PAYER_SLOTS, m.slots.length);
  for (let i = 0; i < slots; i++) {
    const r = 3 + i;
    const p = m.slots[i];
    block(ws, `K${r}`, p ? p.label : null, { align: center, border: true });
    block(ws, `L${r}`, f(`+SUMIF($A:$A,K${r},$C:$C)`, p ? p.amount : 0), { fmt: ACC, border: true });
  }
  const sharedRow = 3 + slots;
  const hqRow = sharedRow + 1;
  const sumRow = hqRow + 1;
  block(ws, `K${sharedRow}`, "공용법인카드", { align: center, border: true });
  block(ws, `L${sharedRow}`, f(`+SUMIF($A:$A,K${sharedRow},$C:$C)`, st.sharedCard), { fmt: ACC, border: true });
  block(ws, `K${hqRow}`, "본사", { align: center, border: true });
  block(ws, `L${hqRow}`, f(`+SUMIF($A:$A,K${hqRow},$C:$C)`, st.hq), { fmt: ACC, border: true });
  const blockTotal = Object.values(st.byPayer).reduce((a, b) => a + b, 0) + st.sharedCard + st.hq;
  block(ws, `K${sumRow}`, "계", { fill: C_SECTION, bold: true, align: center, border: true });
  block(ws, `L${sumRow}`, f(`SUM(L3:L${hqRow})`, blockTotal), { fill: C_SECTION, bold: true, fmt: ACC, border: true });
  block(ws, `L${sumRow + 1}`, f(`G2=L${sumRow}`, st.isValid), { align: center });
}


/** 함께 상신 묶음 계산에 쓰는 프로젝트 칸 */
const SETTLE_NODE_SELECT = { id: true, name: true, parentId: true, seriesId: true, startDate: true, endDate: true, settleWithParent: true, excelPrefix: true } as const;

/**
 * 상신 묶음: 메인 + 메인과 함께 상신하는 서브 (lib/settle-group.ts). 서브가 없으면 ids = [메인] (기존 양식 그대로)
 */
async function exportGroup(projectId: string) {
  const nodes = await prisma.project.findMany({ select: SETTLE_NODE_SELECT });
  const kids = settleChildIds(nodes, projectId).map((id) => nodes.find((n) => n.id === id)!);
  const ids = [projectId, ...kids.map((k) => k.id)];
  return { kids, ids, where: kids.length ? { in: ids } : projectId };
}

type PrefixOf = (projectId: string) => string | null | undefined;

/** 월 시트 지출의 항목 이름 = 구분명_항목 (구분명이 없으면 같은 객체 그대로) */
function prefixed<E extends { projectId: string; item: { name: string } }>(list: E[], prefixOf: PrefixOf): E[] {
  return list.map((e) => { const p = prefixOf(e.projectId); return p ? { ...e, item: { ...e.item, name: excelItemName(p, e.item.name) } } : e; });
}
/** 출입증 회사 부담 줄(본사 집행내역)의 연결 예산 항목 이름 = 구분명_항목 */
function prefixedPass(lines: PassCompanyLine[], prefixOf: PrefixOf): PassCompanyLine[] {
  return lines.map((l) => { const p = prefixOf(l.projectId); return p && l.linkedItemName ? { ...l, linkedItemName: excelItemName(p, l.linkedItemName) } : l; });
}

/** 전체 통합문서 데이터 (DB 조회 + 계산) — renderWorkbook이 그린다. 스냅샷 저장·다운로드가 같은 두 함수를 쓴다 */
export type WorkbookData = Awaited<ReturnType<typeof loadWorkbookData>>;

/**
 * 전체 통합문서에 필요한 데이터를 읽고 계산한다.
 * @param ym 출력 범위의 마지막 달 — 지정하면 그 달 이후의 지출·출입증은 넣지 않는다 (월 시트는 양식대로 비어 있고, 총괄현황·예산 시트 집계도 같은 범위).
 *           없으면 전체 (기존 동작). 상신·승인 스냅샷은 항상 지정한다 (P0-2 ②)
 */
export async function loadWorkbookData(projectId: string, ym?: string) {
  const group = await exportGroup(projectId);
  // 대시보드 계산과 시트 작성에 필요한 데이터를 한 번에 읽는다 (예산 행·지출은 같은 조회를 함께 씀)
  const [project, allExpenses, payers, categories, allLines, allItems, closings, rawPass] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.expense.findMany({
      where: { projectId: group.where },
      include: { payer: { select: { name: true } }, item: { include: { category: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    // 결제자: 함께 상신하는 서브 팀원 포함 (직급 → 성명)
    getPayers(group.kids.length ? group.ids : projectId),
    prisma.category.findMany({
      where: { id: { not: PASS_CATEGORY_ID } },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: { items: { where: { active: true, projectId: group.where }, orderBy: [{ order: "asc" }, { name: "asc" }] } },
    }),
    prisma.budgetLine.findMany({ where: { projectId: group.where }, orderBy: { order: "asc" } }),
    prisma.item.findMany({ where: { projectId: group.where }, select: DASH_ITEM_SELECT, orderBy: [...DASH_ITEM_ORDER] }),
    getClosings(projectId),
    // 출입증 회사 부담 — 확정분(연결 예산 항목)은 본사 집행내역 줄·예산 대비 집행에 (lib/pass-budget.ts)
    sqlPassCompanyLines(group.ids),
  ]);
  const now = currentYearMonth();
  const at = new Date();
  const months = projectMonths(project.startDate, project.endDate);
  if (ym && !months.includes(ym)) throw new HttpError(400, "프로젝트 기간의 월이 아닙니다.");
  const inMonths = new Set(months);
  /** 출력 범위: 이 연차 기간 안 + (ym 지정 시) 그 달까지 */
  const inRange = (m: string) => inMonths.has(m) && (!ym || m <= ym);
  // 엑셀 구분명 (메인·서브) — 월 시트 F열과 예산 시트 SUMIF 조건이 같은 글자
  const prefixById = new Map<string, string | null | undefined>([[projectId, project.excelPrefix], ...group.kids.map((k) => [k.id, k.excelPrefix] as [string, string | null])]);
  const prefixOf: PrefixOf = (id) => prefixById.get(id);
  // 서브 지출·출입증은 이 프로젝트(연차) 기간의 달만
  const expenses = allExpenses.filter((e) => (e.projectId === projectId && (!ym || e.yearMonth <= ym)) || inRange(e.yearMonth));
  const passLines = rawPass.filter((l) => (l.projectId === projectId && (!ym || l.yearMonth <= ym)) || inRange(l.yearMonth));
  const passConfirmed = passBudgetSpend(passLines).confirmedRows;
  // 예산 대비 집행 = 카드 지출 + 출입증 확정분 (현황·예산 화면과 같은 기준) — 메인 / 서브(구분)마다 따로 (같은 항목도 구분별 행)
  const ofProject = <T extends { projectId: string | null }>(list: T[], id: string) => (group.kids.length ? list.filter((x) => x.projectId === id) : list);
  const lines = ofProject(allLines, projectId);
  const dash = buildDashboard({ project, children: [], lines, expenses: [...ofProject(expenses, projectId), ...ofProject(passConfirmed, projectId)], items: ofProject(allItems, projectId), closings, now });
  const parts = [
    { id: projectId, dash, lines, exact: false },
    ...group.kids.map((k) => {
      const kidLines = ofProject(allLines, k.id);
      // 서브 기간이 이 연차를 넘으면 예산을 귀속 개월 비율로 (현황 취합과 같은 기준)
      const prorated = kidLines.map((l) => ({ ...l, planned: proRate(l.planned, k, project) }));
      return {
        id: k.id,
        dash: buildDashboard({
          project: { id: k.id, startDate: project.startDate, endDate: project.endDate }, children: [], lines: prorated,
          expenses: [...ofProject(expenses, k.id), ...ofProject(passConfirmed, k.id)], items: ofProject(allItems, k.id), closings, now,
        }),
        lines: kidLines,
        /** 단가 × 기간이 계획과 같을 때만 계획 칸을 수식으로 (귀속 비율로 나눈 계획은 값) */
        exact: true,
      };
    }),
  ];
  const { allPayers, labelOf } = payerLabels(payers, expenses);
  // 월 시트에 쓰는 지출·출입증 줄 (항목 이름 = 구분명_항목)
  const sheetExpenses = prefixed(expenses, prefixOf);
  const sheetPass = prefixedPass(passLines, prefixOf);

  // ── 월별 시트 데이터 (lib/month-sheet.ts — 한 달 시트 내려받기·재무 검토 화면과 같은 계산) ─────────────────
  // 이전 팀원은 철수한 달까지만 결제자 칸에 (lib/membership.ts)
  const payersIn = (ym: string) => payers.filter((p) => servedInMonth(p, ym));
  // 월별 지출 (원래 순서 유지) — 월마다 전체를 다시 거르지 않게 한 번에 나눈다
  const expensesOf = new Map<string, typeof sheetExpenses>(months.map((ym) => [ym, []]));
  for (const e of sheetExpenses) expensesOf.get(e.yearMonth)?.push(e);
  // 월별 정산 (lib/settlement.ts settle — 화면 정산과 같은 규칙, 출입증 확정분은 본사 집행). 엑셀에는 수식과 함께 계산 결과로 기록
  const monthData = Object.fromEntries(months.map((ym) => [ym, monthSheetData({
    ym, expenses: expensesOf.get(ym)!, pass: passExcelRows(sheetPass, ym), payersIn: payersIn(ym), labelOf, passDate: passRowDate(ym, project.endDate),
    passVendor: project.clientPassName ?? undefined,
  })]));
  const settlements = Object.fromEntries(months.map((ym) => [ym, monthData[ym].st]));
  // 지정한 달의 마감 상태 (파일 이름·스냅샷) — 없으면 작성중
  const status = ym ? closingStatusIn(closings, ym) : undefined;
  return { project, group, months, ym, status, at, prefixOf, categories, payers, allPayers, labelOf, monthData, settlements, parts, passLines };
}

/** 데이터로 전체 통합문서를 그린다 (순수 — DB 조회 없음). 같은 데이터면 같은 파일 (스냅샷 SHA-256 대조 가능) */
export async function renderWorkbook(d: WorkbookData): Promise<Buffer> {
  const { project, group, months, categories, allPayers, labelOf, monthData, settlements, parts, prefixOf } = d;
  const projectId = project.id;
  const activeYm = d.ym;
  const sheetOf = (ym: string) => excelSheetName(ym, months[0]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "운영비 정산 웹앱";
  wb.created = d.at;
  wb.calcProperties.fullCalcOnLoad = true; // 열 때 수식 전체 재계산

  const summary = wb.addWorksheet("총괄현황", { views: [{ showGridLines: false }] });
  const budget = wb.addWorksheet(SHEET_BUDGET, {
    views: [{ state: "frozen", xSplit: 4, ySplit: 2, showGridLines: false }],
  });
  const monthSheets = months.map((ym) =>
    wb.addWorksheet(sheetOf(ym), { views: [{ state: "frozen", ySplit: 1 }] }),
  );
  const valid = wb.addWorksheet(SHEET_VALID);
  const data = wb.addWorksheet(SHEET_DATA, { state: "hidden" });

  // ── 데이터시트 (숨김): 총괄현황 제목 등에서 참조 ───────────────────
  const period = `${formatDate(project.startDate)} ~ ${formatDate(project.endDate)}`;
  data.getColumn(1).width = 12;
  data.getColumn(2).width = 28;
  data.getCell("A1").value = "팀명";
  data.getCell("B1").value = project.name;
  data.getCell("A2").value = "수행기간";
  data.getCell("B2").value = period;
  data.getCell("A7").value = "분담률1";
  data.getCell("B7").value = 1; // 복수 프로젝트 분담은 2차 범위 — 현재 100%
  data.getCell("A8").value = "분담률2";
  data.getCell("B8").value = 0;
  data.getCell("B7").numFmt = data.getCell("B8").numFmt = "0%";

  // ── 유효성검사_편집삭제금지: 분류/항목/결제방법/날짜 목록 + 이름 정의 ──────────
  valid.columns = Array.from({ length: 10 }, (_, i) => ({ width: i === 4 ? 18 : 15.5 }));
  style(valid.getCell("A1"), { fill: C_LABEL });
  valid.getCell("A1").value = "분류";
  valid.getCell("A1").font = { name: FONT, size: 10, color: { argb: "FFFFFFFF" } };
  categories.forEach((c, i) => {
    const cell = valid.getCell(1, 2 + i);
    cell.value = c.name;
    style(cell, { fill: C_HEAD });
  });
  if (categories.length) wb.definedNames.add(`${q(SHEET_VALID)}!$B$1:${col(1 + categories.length)}$1`, "분류");

  let vr = 2;
  for (const c of categories) {
    if (c.items.length === 0) continue;
    const first = vr;
    style(valid.getCell(vr, 1), { fill: C_HEAD });
    valid.getCell(vr, 1).value = c.name;
    // 함께 상신하는 서브 항목도 구분명을 붙여 (메인 → 서브 순, 같은 이름은 한 번)
    const names = group.kids.length
      ? [...new Set(group.ids.flatMap((id) => c.items.filter((it) => it.projectId === id).map((it) => excelItemName(prefixOf(id), it.name))))]
      : c.items.map((it) => excelItemName(prefixOf(projectId), it.name));
    for (const name of names) valid.getCell(vr++, 2).value = name;
    if (isValidName(c.name)) wb.definedNames.add(`${q(SHEET_VALID)}!$B${first}:$B${vr - 1}`, c.name);
  }
  const methodRow = vr;
  style(valid.getCell(methodRow, 1), { fill: C_HEAD });
  valid.getCell(methodRow, 1).value = "결제방법";
  PAY_METHODS.forEach((m, i) => (valid.getCell(methodRow, 2 + i).value = PAY_METHOD_EXCEL_LABEL[m]));
  wb.definedNames.add(`${q(SHEET_VALID)}!$B${methodRow}:${col(1 + PAY_METHODS.length)}${methodRow}`, "결제방법");

  const dateHead = methodRow + 2;
  style(valid.getCell(dateHead, 1), { fill: C_HEAD });
  valid.getCell(dateHead, 1).value = "날짜";
  let dr = dateHead + 1;
  for (let t = project.startDate.getTime(); t <= project.endDate.getTime(); t += 86400000) {
    const cell = valid.getCell(dr++, 1);
    cell.value = new Date(t);
    cell.numFmt = DATE_FMT;
  }
  wb.definedNames.add(`${q(SHEET_VALID)}!$A${dateHead + 1}:$A${Math.max(dateHead + 1, dr - 1)}`, "날짜");

  // ── 월별 시트 (writeMonthSheet — 한 달 시트 내려받기와 같은 함수) ─────────────────
  months.forEach((ym, idx) => writeMonthSheet(monthSheets[idx], monthData[ym], { kind: "names" }));

  // ── 프로젝트 운영비(작성금지): 예산 대비 집행 ───────────────────
  const mStart = 10; // J열부터 월 컬럼
  const mEnd = mStart + months.length - 1;
  budget.columns = [
    { width: 13.5 }, { width: 13.5 }, { width: 17.2 }, { width: 56.8 }, { width: 11.2 }, { width: 5.5 },
    { width: 12.2 }, { width: 12.2 }, { width: 12.2 }, ...months.map(() => ({ width: 11 })),
  ];
  block(budget, "B1", "■ 프로젝트 운영비(내부)", { bold: true, size: 16 });
  const bHead = ["분류", "분류", "항목", "상세내역", "단가", "기간", "계획", "지출", "잔액", ...months.map(sheetOf)];
  bHead.forEach((h, i) => {
    const cell = budget.getCell(2, i + 1);
    cell.value = h;
    // A열은 상위 분류(회계계정) — 양식처럼 서식 없는 헤더
    style(cell, i === 0 ? { align: center, border: true } : { fill: C_HEAD, bold: true, align: center, border: true });
  });

  // 메인 예산 행 → 함께 상신하는 서브(구분) 예산 행 (원본 양식처럼 같은 분류 구조, 항목 이름에 구분명)
  let br = 3;
  for (const part of parts) {
    // 항목별 예산 행 (원래 순서) — 행마다 전체 예산 행을 다시 거르지 않게 한 번에 나눈다
    const linesOf = new Map<string, typeof part.lines>();
    for (const l of part.lines) { const list = linesOf.get(l.itemId); if (list) list.push(l); else linesOf.set(l.itemId, [l]); }
    for (const row of part.dash.rows) {
      const own = linesOf.get(row.itemId) ?? [];
      const single = own.length === 1 && (!part.exact || own[0].unitPrice * own[0].periods === row.planned);
      const prefix = prefixOf(part.id);
      const itemName = excelItemName(prefix, row.itemName);
      const r = budget.getRow(br);
      r.values = [
        row.accountCode ?? "",
        row.categoryName,
        itemName,
        own.map((l) => l.detail).join(" / "),
        single ? own[0].unitPrice : null,
        single ? own[0].periods : null,
        single ? f(`E${br}*F${br}`, row.planned) : row.planned,
        f(`SUM(${col(mStart)}${br}:${col(mEnd)}${br})`, row.spent),
        f(`G${br}-H${br}`, row.remaining),
        ...months.map((ym, i) =>
          row.bundleItemNames.length
            ? f([row.baseItemName, ...row.bundleItemNames].map((n) => `SUMIF(${q(sheetOf(ym))}!$F:$F,${sumifText(excelItemName(prefix, n))},${q(sheetOf(ym))}!$C:$C)`).join("+"), row.months[i])
            // 항목명에 와일드카드·비교 연산자가 있으면 셀 참조 대신 이스케이프한 조건
            : f(`SUMIF(${q(sheetOf(ym))}!$F:$F,${plainCriteria(itemName) ? `$C${br}` : sumifText(itemName)},${q(sheetOf(ym))}!$C:$C)`, row.months[i]),
        ),
      ];
      for (let c = 1; c <= mEnd; c++) {
        const money = c === 5 || c >= 7;
        style(r.getCell(c), {
          fmt: money ? ACC : undefined,
          align: c <= 3 ? center : c === 4 ? { vertical: "middle", wrapText: true } : { vertical: "middle" },
          border: true,
        });
      }
      br++;
    }
  }
  const lastLine = br - 1;
  const sumCol = (c: number, result: number) =>
    lastLine >= 3 ? f(`SUM(${col(c)}3:${col(c)}${lastLine})`, result) : 0;
  block(budget, `B${br}:F${br}`, "총합계", { fill: C_HEAD, bold: true, align: center, border: true });
  block(budget, `A${br}`, null, { border: true });
  // 합계: 메인 + 서브 (서브가 없으면 메인 그대로)
  const sumParts = (pick: (d: (typeof parts)[number]["dash"]) => number) => parts.reduce((a, p) => a + pick(p.dash), 0);
  const planned = sumParts((d) => d.totals.planned);
  const totals = [planned, sumParts((d) => d.totals.spent), sumParts((d) => d.totals.remaining), ...months.map((_, i) => sumParts((d) => d.trend[i].amount))];
  totals.forEach((v, i) => block(budget, `${col(7 + i)}${br}`, sumCol(7 + i, v), { fill: C_HEAD, bold: true, fmt: ACC, border: true }));
  const budgetTotalRow = br;

  // ── 총괄현황: 수행(예정)내역 매출/원가 요약 (기존 양식 틀, 운영비는 자동 연결) ──────
  summary.columns = [5.3, 18.7, 12.3, 22, 12.3, 11.7, 20, 10.2, 21.7].map((width) => ({ width }));
  block(summary, "B3:I3", f(`CONCATENATE("(",${SHEET_DATA}!$B$1,")"," 수행(예정)내역")`, `(${project.name}) 수행(예정)내역`), {
    bold: true, size: 14, align: center,
  });
  block(summary, "B4:I4", f(`CONCATENATE("수행기간 : ",${SHEET_DATA}!$B$2)`, `수행기간 : ${period}`), { align: center });
  const head = { fill: C_SUMMARY, bold: true, align: center, border: true };
  block(summary, "B7:D8", "매출 세부내역", head);
  block(summary, "E7:I7", "원가 세부내역", head);
  block(summary, "E8:F8", "구 분", head);
  block(summary, "G8", "MM", head);
  block(summary, "H8:I8", "금액", head);
  // 매출 측: 웹앱에 매출 데이터가 없으므로 입력란만 제공
  block(summary, "B9:B14", null, { align: center, border: true });
  for (let r = 9; r <= 14; r++) {
    block(summary, `C${r}`, null, { border: true });
    block(summary, `D${r}`, null, { fmt: ACC, border: true });
  }
  // 원가 측: 인건비·외주비·인프라는 입력란, 사업운영경비는 운영비 계획 합계 연결
  block(summary, "E9:E11", "인건비", { align: center, border: true });
  block(summary, "F9", "정규직", { align: center, border: true });
  block(summary, "F10", "계약직", { align: center, border: true });
  block(summary, "F11", "합계", { align: center, border: true });
  block(summary, "G9", null, { fmt: "0.00", border: true });
  block(summary, "G10", null, { fmt: "0.00", border: true });
  block(summary, "G11", f("SUM(G9:G10)", 0), { fmt: "0.00", border: true });
  block(summary, "H9:I9", null, { fmt: ACC, border: true });
  block(summary, "H10:I10", null, { fmt: ACC, border: true });
  block(summary, "H11:I11", f("SUM(H9:I10)", 0), { fmt: ACC, border: true });
  block(summary, "E12:F12", "외주비", { align: center, border: true });
  block(summary, "G12", null, { border: true });
  block(summary, "H12:I12", null, { fmt: ACC, border: true });
  block(summary, "E13:F13", "인프라", { align: center, border: true });
  block(summary, "G13", null, { border: true });
  block(summary, "H13:I13", null, { fmt: ACC, border: true });
  block(summary, "E14:F14", "사업운영경비", { align: center, border: true });
  block(summary, "G14", null, { border: true });
  block(summary, "H14:I14", f(`${q(SHEET_BUDGET)}!G${budgetTotalRow}`, planned), { fmt: ACC, border: true });
  block(summary, "B15:C15", "매출 총 합계", head);
  block(summary, "D15", f("SUM(D9:D14)", 0), { ...head, fmt: ACC });
  block(summary, "E15:F15", "원가 총 합계", head);
  block(summary, "G15", null, head);
  block(summary, "H15:I15", f("H11+H12+H13+H14", planned), { ...head, fmt: ACC });

  // 웹앱 추가: 월별 집행·정산 현황 (기존 총괄현황의 #REF! 집계를 대체)
  const s0 = 18;
  block(summary, `B${s0}`, "■ 월별 집행 현황", { bold: true, size: 12 });
  const sHead = ["월", ...allPayers.map((p) => labelOf.get(p.id)!), "공용법인카드", "본사", "총합계", "검증"];
  sHead.forEach((h, i) => block(summary, `${col(2 + i)}${s0 + 1}`, h, head));
  months.forEach((ym, i) => {
    const r = s0 + 2 + i;
    const ws = q(sheetOf(ym));
    block(summary, `B${r}`, sheetOf(ym), { align: center, border: true });
    allPayers.forEach((p, j) =>
      block(summary, `${col(3 + j)}${r}`, f(`SUMIF(${ws}!$A:$A,${sumifText(labelOf.get(p.id)!)},${ws}!$C:$C)`, settlements[ym].byPayer[p.id] ?? 0), { fmt: ACC, border: true }),
    );
    const c = 3 + allPayers.length;
    block(summary, `${col(c)}${r}`, f(`SUMIF(${ws}!$A:$A,"공용법인카드",${ws}!$C:$C)`, settlements[ym].sharedCard), { fmt: ACC, border: true });
    block(summary, `${col(c + 1)}${r}`, f(`SUMIF(${ws}!$A:$A,"본사",${ws}!$C:$C)`, settlements[ym].hq), { fmt: ACC, border: true });
    block(summary, `${col(c + 2)}${r}`, f(`${ws}!G2`, settlements[ym].total), { fmt: ACC, border: true });
    block(summary, `${col(c + 3)}${r}`, settlements[ym].isValid, { align: center, border: true });
  });
  const sTot = s0 + 2 + months.length;
  block(summary, `B${sTot}`, "합계", head);
  // 합계 행의 계산 결과: 위 행들에 적은 정산 값(결제자별·공용·본사·총합계)을 월 순서로 더한다 (셀을 다시 읽지 않음)
  const colSums = [
    ...allPayers.map((p) => months.reduce((a, ym) => a + (settlements[ym].byPayer[p.id] ?? 0), 0)),
    months.reduce((a, ym) => a + settlements[ym].sharedCard, 0),
    months.reduce((a, ym) => a + settlements[ym].hq, 0),
    months.reduce((a, ym) => a + settlements[ym].total, 0),
  ];
  colSums.forEach((result, i) => {
    const c = 3 + i;
    block(summary, `${col(c)}${sTot}`, f(`SUM(${col(c)}${s0 + 2}:${col(c)}${sTot - 1})`, result), { ...head, fmt: ACC });
  });
  block(summary, `${col(1 + sHead.length)}${sTot}`, null, head);

  if (activeYm && months.includes(activeYm)) {
    wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 2 + months.indexOf(activeYm), visibility: "visible" }];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 전체 통합문서 파일 이름 (lib/snapshot.ts workbookFilename) — ym 지정 시 상태·시각 접미, 없으면 기존 규칙 */
export function workbookFilenameOf(d: Pick<WorkbookData, "project" | "months" | "ym" | "status" | "at">, live = false): string {
  const years = `${d.months[0].slice(0, 4)}-${d.months[d.months.length - 1].slice(0, 4)}`;
  return workbookFilename({ years, name: d.project.name, ym: d.ym ?? d.months[d.months.length - 1], status: d.status, live, at: d.at });
}

/**
 * 전체 통합문서 — 현재 데이터로 (loadWorkbookData + renderWorkbook).
 * @param ym 출력 범위의 마지막 달·활성 시트 (지정 시 그 달 이후는 비움). 승인·상신된 달의 저장본은 lib/snapshot-server.ts가 내려준다
 * @param opts.live 승인된 달의 현재 데이터 버전 (파일 이름 "_수정본_현재")
 */
export async function buildWorkbook(projectId: string, ym?: string, opts: { live?: boolean } = {}) {
  const data = await loadWorkbookData(projectId, ym);
  const buffer = await renderWorkbook(data);
  return { buffer, filename: workbookFilenameOf(data, opts.live), status: data.status, data };
}

/**
 * 이 달 시트만 (단독 파일) — 기존 상신 통합문서에 옮겨 붙이는 병행 운영용.
 * 전체 통합문서와 같은 월 시트 함수(writeMonthSheet)로 그리고, 다른 시트를 참조하는 드롭다운·수식은 넣지 않는다.
 * 운영 CPU를 아끼려 그 달 지출·그 달 명세의 출입증 줄만 읽는다.
 */
export async function buildMonthSheet(projectId: string, ym: string) {
  const group = await exportGroup(projectId);
  const [project, rawExpenses, payers, categories, rawPass, closing] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.expense.findMany({
      where: { projectId: group.where, yearMonth: ym },
      include: { payer: { select: { name: true } }, item: { include: { category: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    // 결제자·지출·출입증: 함께 상신하는 서브 포함 (전체 통합문서의 같은 달 시트와 같게)
    getPayers(group.kids.length ? group.ids : projectId),
    prisma.category.findMany({ where: { id: { not: PASS_CATEGORY_ID } }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { name: true } }),
    sqlPassCompanyLines(group.ids, { yearMonths: [ym] }),
    prisma.monthlyClosing.findUnique({ where: { projectId_yearMonth: { projectId, yearMonth: ym } }, select: { status: true } }),
  ]);
  const months = projectMonths(project.startDate, project.endDate);
  if (!months.includes(ym)) throw new HttpError(400, "프로젝트 기간의 월이 아닙니다.");
  const sheetName = excelSheetName(ym, months[0]);
  const prefixById = new Map<string, string | null | undefined>([[projectId, project.excelPrefix], ...group.kids.map((k) => [k.id, k.excelPrefix] as [string, string | null])]);
  const prefixOf: PrefixOf = (id) => prefixById.get(id);
  const { labelOf } = payerLabels(payers, rawExpenses);
  const data = monthSheetData({
    ym, expenses: prefixed(rawExpenses, prefixOf), pass: passExcelRows(prefixedPass(rawPass, prefixOf), ym), payersIn: payers.filter((p) => servedInMonth(p, ym)), labelOf, passDate: passRowDate(ym, project.endDate),
    passVendor: project.clientPassName ?? undefined,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "운영비 정산 웹앱";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  writeMonthSheet(ws, data, {
    kind: "inline", methods: PAY_METHODS.map((m) => PAY_METHOD_EXCEL_LABEL[m]), categories: categories.map((c) => c.name),
    start: project.startDate, end: project.endDate,
  });
  const buffer = await wb.xlsx.writeBuffer();
  const status = parseClosingStatus(closing?.status);
  const years = `${months[0].slice(0, 4)}-${months[months.length - 1].slice(0, 4)}`;
  // 예: "2025-2026 ○○팀 운영비(26.09) 26.9월 시트_작성중.xlsx" — 마감 전이면 작성중, 그 뒤는 마감·상신·승인·반려
  const filename = `${years} ${project.name} 운영비(${ym.slice(2, 4)}.${ym.slice(5, 7)}) ${sheetName} 시트_${CLOSING_LABEL[status]}.xlsx`;
  return { buffer, filename, sheetName, status };
}
