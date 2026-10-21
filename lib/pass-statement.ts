// 업체 출입증 월 사용 내역 — 순수함수 (파일 해석·업체 양식·팀원 매칭·결정·집계·권한)
// 업체가 보내 준 월 사용 내역(엑셀/CSV)을 올리면, 야근 등으로 제외 인정된 건은 회사 부담, 나머지는 급여 공제.
// 업체 파일 모양이 바뀌어도 코드 수정 없이 화면에서 '업체 양식'(시트·열)을 다시 고르면 된다.
// 개인 법인카드 정산과 따로 처리하되, 확정된 회사 부담 줄은 본사 합·예산 집행에 합쳐지고 상신 가드가 확정 여부를 본다 (lib/settlement·lib/closing).
import { formatDate, pad2, won } from "./format";
import { isLocked, unlockHint } from "./closing";
import type { ClosingStatus, Role } from "./types";

// ───────────────────────── 상수·라벨

/**
 * 팀원 표시: OVERTIME = 업무 사용(회사 부담 요청, 야근 등) 하나뿐. 표시 없음(null) = 본인 부담(기본값).
 * 옛 값 "PERSONAL"(본인 부담으로 확인)은 더 저장하지 않고, 읽을 때는 표시 없음과 같게 다룬다 — 모든 판정은 `=== "OVERTIME"`으로만.
 */
const PASS_CLAIMS = ["OVERTIME"] as const;
export type PassClaim = (typeof PASS_CLAIMS)[number];
const PASS_DECISIONS = ["OVERTIME", "DEDUCT"] as const;
export type PassDecision = (typeof PASS_DECISIONS)[number];
/** 결정 출처. DEFAULT = 확정 때 따로 정하지 않아 본인 부담으로 읽는 줄 (DB에는 저장하지 않고 applyConfirmedDefaults가 읽을 때 채운다) */
export type PassDecisionSource = "PM" | "SOLIDAY" | "HQ" | "ADMIN" | "DEFAULT";

export const DECISION_LABEL: Record<PassDecision, string> = { OVERTIME: "회사 부담", DEDUCT: "본인 부담" };
const SOURCE_LABEL: Record<PassDecisionSource, string> = { PM: "PM", SOLIDAY: "Soliday", HQ: "재무 승인", ADMIN: "시스템 관리자", DEFAULT: "기본" };
/** 저장된 결정 출처 → 표시 (알 수 없는 값은 그대로) */
export const sourceLabel = (v: string | null | undefined) => (v ? SOURCE_LABEL[v as PassDecisionSource] ?? v : "");

const isClaim = (v: unknown): v is PassClaim => PASS_CLAIMS.includes(v as PassClaim);
export const isDecision = (v: unknown): v is PassDecision => PASS_DECISIONS.includes(v as PassDecision);

// ───────────────────────── 파일 → 표

export type Cell = string | number | Date | null;
export type Table = Cell[][];
/** 시트: 표 + 수식 셀 위치("행:열", 0부터) */
export type Sheet = { name: string; table: Table; formulas?: Set<string> };

/** CSV 바이트 → 문자열: UTF-8(BOM 포함) 우선, 깨지면 EUC-KR(CP949) */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

/** CSV(쉼표·탭·세미콜론) → 표. 따옴표 안의 구분자·줄바꿈, "" 이스케이프 처리. 값은 모두 문자열(앞자리 0 보존) */
export function parseCsv(text: string): Table {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [",", "\t", ";"].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ",");
  const rows: Table = [];
  let row: Cell[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"' && cur === "") quoted = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  // 값은 모두 문자열 — 앞뒤 공백만 제거 (표를 다시 만들지 않고 제자리에서)
  for (const r of rows) for (let i = 0; i < r.length; i++) r[i] = (r[i] as string).trim();
  return rows;
}

/** 셀 → 화면 글자 (엑셀 날짜는 YYYY-MM-DD, 시간만 있는 값은 HH:MM:SS) */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    if (v.getUTCFullYear() < 1900) return `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}:${pad2(v.getUTCSeconds())}`;
    return formatDate(v);
  }
  return String(v).trim();
}

export const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

// ───────────────────────── 머리글 인식 (추천용 동의어 — 최종 선택은 화면에서)

/** 머리글 정규화: 공백·괄호 안 내용·기호 제거, 소문자 */
const normHeader = (v: Cell) =>
  cellText(v).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[\s._\-/:#·]/g, "");

/**
 * 머리글 행 전체의 정규화 결과 — 같은 행 배열(파일에서 읽은 표의 행)에 대해 한 번만 계산한다.
 * 양식 맞추기(resolveSheet)·추천(suggestColumns)·점수(profileScore)가 같은 머리글을 수십 번 다시 정규화하지 않게.
 * 행 배열은 읽은 뒤 바꾸지 않는다는 전제 (표는 읽은 뒤 바꾸지 않는다)
 */
const normHeadsCache = new WeakMap<Cell[], string[]>();
function normHeads(header: Cell[]): string[] {
  let h = normHeadsCache.get(header);
  if (!h) { h = header.map(normHeader); normHeadsCache.set(header, h); }
  return h;
}

/** 머리글 한 칸이 동의어와 맞는지 (정확히 일치 또는 동의어로 시작) — findColumn([header], hint) !== undefined 와 같다 */
function headerMatches(header: string, hint: Hint): boolean {
  const h = normHeader(header);
  if (h === "") return false;
  for (const s of SYNONYMS[hint]) if (h === s || h.startsWith(s)) return true;
  return false;
}

type Hint = "name" | "amount" | "date" | "key" | "time" | "place" | "item" | "company";
/** 동의어 — 앞에 있을수록 우선 */
const SYNONYMS: Record<Hint, string[]> = {
  name: ["고객성명", "이름", "성명", "사용자", "사용자명", "사원명", "직원명", "이용자", "name", "user", "username", "employee", "employeename", "holder"],
  amount: ["총금액", "총금액1", "표시금액", "표시금액1", "금액", "결제금액", "사용금액", "이용금액", "합계금액", "청구금액", "개인부담금액", "amount", "total", "price"],
  date: ["판매일자", "날짜", "사용일", "사용일자", "일자", "이용일", "이용일자", "거래일", "거래일자", "결제일", "사용일시", "이용일시", "일시", "date", "usedate", "transactiondate"],
  key: ["사원카드번호", "카드번호", "카드no", "출입증번호", "cardno", "cardnumber"],
  time: ["판매시간", "시간", "사용시간", "이용시간", "거래시간", "이용시각", "사용시각", "결제시각", "시각", "time"],
  place: ["매대명", "영업장명칭", "사용처", "가맹점", "가맹점명", "매장명", "식당명", "이용처", "코너", "코너명", "place", "merchant", "store"],
  item: ["상품한글명", "상품명", "품목", "메뉴", "item", "menu", "product"],
  company: ["소속업체명칭", "소속업체", "업체명", "company"],
};

/** 머리글 행에서 동의어로 열 찾기 (정확히 일치 → 동의어로 시작) */
function findColumn(header: Cell[], hint: Hint, used: Set<number> = new Set()): number | undefined {
  const heads = normHeads(header);
  for (const pass of [0, 1] as const) {
    for (const s of SYNONYMS[hint]) {
      const idx = heads.findIndex((h, i) => !used.has(i) && h !== "" && (pass === 0 ? h === s : h.startsWith(s)));
      if (idx >= 0) return idx;
    }
  }
  return undefined;
}

/**
 * 화면에서 고르는 열 (열 번호, 0부터).
 * display: 표시 열 키(프로젝트 공통 목록) → 이 시트의 열. 연결하지 않은 항목은 없음 (그 업체 줄에서는 '—')
 */
export type ColumnSelection = { nameCol?: number; keyCols: number[]; amountCols: number[]; dateCol?: number; timeCol?: number; display: Record<string, number> };

/**
 * 프로젝트 공통 표시 열. key는 줄(extra)에 저장되는 이름표라 바뀌지 않고, 화면에는 name을 보여 준다
 * (이름을 바꿔도 기존 줄을 고치지 않는다). hidden = 삭제한 항목 — 기존 줄의 값은 남기고 화면·엑셀에서만 숨김
 */
export type DisplayItem = { key: string; name: string; hidden?: boolean };

/** 표시 열 이름(또는 키)과 머리글이 같은 열을 자동으로 연결 (숨긴 항목 제외) */
export function autoDisplay(header: Cell[], items: DisplayItem[]): Record<string, number> {
  const heads = normHeads(header);
  const out: Record<string, number> = {};
  for (const it of items) {
    if (it.hidden) continue;
    const name = normHeader(it.name), key = normHeader(it.key);
    const i = heads.findIndex((h) => h !== "" && (h === name || h === key));
    if (i >= 0) out[it.key] = i;
  }
  return out;
}

/**
 * 머리글 행 → 추천 선택 (이름·금액을 못 찾으면 null).
 * 표시 열: 프로젝트 목록(items)이 있으면 이름이 같은 머리글을 연결, 목록이 없으면(처음) 시간·상품·매대 열을 그 머리글 이름으로 추천
 */
export function suggestColumns(header: Cell[], items: DisplayItem[] = []): ColumnSelection | null {
  const used = new Set<number>();
  const take = (h: Hint) => { const i = findColumn(header, h, used); if (i !== undefined) used.add(i); return i; };
  const nameCol = take("name");
  const amount = take("amount");
  if (nameCol === undefined || amount === undefined) return null;
  const dateCol = take("date");
  const key = take("key");
  let display: Record<string, number>;
  if (items.some((i) => !i.hidden)) display = autoDisplay(header, items);
  else {
    display = {};
    // 상품구분·상품코드 같은 코드 머리글은 추천하지 않는다 (값이 'CATE012' 같은 코드라 팀원에게 뜻이 없다)
    for (const i of (["time", "item", "place"] as const).map(take)) if (i !== undefined && !isCodeHeader(cellText(header[i] ?? null))) display[cellText(header[i] ?? null) || `${colLetter(i)}열`] = i;
  }
  // 시간 열: 저녁 식사 표시·야근 대조용 (표시 열과 겹쳐도 됨)
  const timeCol = findColumn(header, "time");
  return { nameCol, amountCols: [amount], dateCol, timeCol, keyCols: key === undefined ? [] : [key], display };
}

/** 머리글 행 찾기 (상단 30행 안, 날짜까지 있는 행 우선) → 1부터 센 행 번호 + 추천 선택 */
export function detectHeader(table: Table, items: DisplayItem[] = []): { headerRow: number; selection: ColumnSelection } | null {
  let fallback: { headerRow: number; selection: ColumnSelection } | null = null;
  const firstTime = !items.some((i) => !i.hidden);
  for (let r = 0; r < Math.min(table.length, 30); r++) {
    const selection = suggestColumns(table[r] ?? [], items);
    if (!selection) continue;
    // 처음 추천(목록이 없을 때): 값이 코드 패턴뿐인 열(예: CATE012)은 표시 열로 추천하지 않는다
    if (firstTime) selection.display = withoutCodeOnlyColumns(selection.display, table, r + 1);
    if (selection.dateCol !== undefined) return { headerRow: r + 1, selection };
    fallback ??= { headerRow: r + 1, selection };
  }
  return fallback;
}

// ───────────────────────── 업체 양식 (시트별 설정) — 머리글 글자로 저장

/** 열 지정: 머리글 글자, 머리글이 비었거나 겹치면 "#열번호" */
export type ColumnRef = string;
export type SheetConfig = {
  sheetName: string;
  /** 머리글 행 (1부터) */
  headerRow: number;
  /** 이름 열 (연결 기준, 1개) */
  nameCol: ColumnRef;
  /** 보조 연결 열 (카드번호·사원번호 등) — 기억된 매핑을 이 값으로 찾는다 */
  keyCols: ColumnRef[];
  /** 금액 열 — 여러 개면 합계 */
  amountCols: ColumnRef[];
  /** 날짜 열 (선택 — 야근 확인·Soliday 대조에 사용) */
  dateCol?: ColumnRef | null;
  /** 시간 열 (선택 — 저녁 식사 표시·야근 대조). 없으면 시간으로 보이는 머리글을 찾아 쓴다 */
  timeCol?: ColumnRef | null;
  /**
   * 표시 열 연결: 프로젝트 공통 표시 열 키 → 이 시트의 열 (순서는 프로젝트 목록을 따른다).
   * 옛 형식(displayCols: 누른 순서의 열 목록)은 parseProfile이 '머리글 이름 = 표시 열 이름'으로 바꿔 읽는다.
   */
  display: DisplayLink[];
  /**
   * 구분 (예: 식당, 카페) — 내역 줄의 사용처 구분이자 다시 올릴 때 바꾸는 단위. 없으면 시트 이름.
   * 업체가 식당·카페를 따로 보내다 한 파일로 합쳐 보내도(시트 이름이 달라도) 같은 구분으로 이어진다.
   */
  label?: string | null;
  /**
   * (보낼 때만) 이 설정이 고치는 기존 설정의 구분 — 양식 수정·다시 설정에서 기존 설정을 교체하고,
   * 구분이 바뀌면 기존 내역 줄의 구분도 함께 바꾼다. 서식에는 저장하지 않는다
   */
  from?: string;
};

/** 표시 열 하나(키)와 이 시트의 열 */
export type DisplayLink = { item: string; col: ColumnRef };

/** 시트 설정의 구분 (없으면 시트 이름) */
export const sheetLabel = (c: Pick<SheetConfig, "sheetName" | "label">) => c.label?.trim() || c.sheetName;

/**
 * 업체 양식 합치기 — 이번 파일에 있는 시트의 설정은 새 설정(sent)으로 바꾸고, 파일에 없는 시트의 설정은 그대로 둔다.
 * (식당 파일·카페 파일을 따로 받다가 합본을 받는 업체도 양식 하나로 처리)
 */
export function mergeProfile(saved: SheetConfig[] | null | undefined, sent: SheetConfig[], fileSheetNames: string[]): SheetConfig[] {
  return mergeProfileDetailed(saved, sent, fileSheetNames).sheets;
}

/** 구분이 바뀐 기존 설정 — 기존 내역 줄(같은 업체·같은 시트·옛 구분)의 구분을 새 구분으로 바꿔 이어지게 */
export type Relabel = { sheetName: string; from: string; to: string };

/**
 * 업체 서식 합치기 + 구분이 바뀐 설정.
 * 이번 설정이 고치는 기존 설정(보낸 from 구분, 없으면 같은 시트 이름의 구분 없는 설정)은 교체한다
 * — 구분 없이 만든 설정을 양식 수정으로 고치면 설정이 하나 더 생기지 않고 그 설정이 바뀐다
 */
export function mergeProfileDetailed(saved: SheetConfig[] | null | undefined, sent: SheetConfig[], fileSheetNames: string[]): { sheets: SheetConfig[]; relabels: Relabel[] } {
  const inFile = new Set(fileSheetNames);
  const same = (a: SheetConfig, b: SheetConfig) => a.sheetName === b.sheetName && sheetLabel(a) === sheetLabel(b);
  const replaced = new Set<SheetConfig>();
  const relabels: Relabel[] = [];
  for (const c of sent) {
    const target = (saved ?? []).find((o) => !replaced.has(o) && o.sheetName === c.sheetName && (c.from ? sheetLabel(o) === c.from : !o.label?.trim()));
    if (!target) continue;
    replaced.add(target);
    if (sheetLabel(target) !== sheetLabel(c)) relabels.push({ sheetName: c.sheetName, from: sheetLabel(target), to: sheetLabel(c) });
  }
  // 유지: 교체되지 않았고 (시트, 구분)이 이번 설정과 다르며, 파일에 없는 시트이거나 같은 시트 이름의 다른 구분 설정 (식당·카페를 따로 받는 업체)
  const keep = (saved ?? []).filter((c) => !replaced.has(c) && !sent.some((s) => same(s, c)) && (!inFile.has(c.sheetName) || sent.some((s) => s.sheetName === c.sheetName)));
  const clean = sent.map(({ from: _from, ...c }) => c);
  return { sheets: [...keep, ...clean], relabels };
}

/**
 * 다시 올리기: 같은 업체(vendor)의 이번 파일이 바꾸는 구분(scope) 줄만 교체, 나머지(다른 업체·다른 구분)는 그대로 둔다.
 * 한 달에 업체 A의 식당·카페와 업체 B의 식당·카페가 함께 있을 수 있다. 업체가 비어 있는 줄(업체 미지정)은 어느 업체와도 같지 않다.
 */
export function splitByScope<T extends { placeType: string | null; sheetName: string | null; vendor?: string | null }>(lines: T[], scope: string[], vendor: string) {
  const s = new Set(scope);
  const labelOf = (l: T) => l.placeType || l.sheetName || "";
  const replaced = (l: T) => !!l.vendor && l.vendor === vendor && s.has(labelOf(l));
  return { keep: lines.filter((l) => !replaced(l)), replace: lines.filter(replaced) };
}

// ───────────────────────── 업체 서식 (프로젝트당 업체별 여러 개)

/** 표시 열 이름 (머리글 이름에서 온다) */
const DISPLAY_ITEM_MAX = 40;
const isDisplayItem = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.trim().length <= DISPLAY_ITEM_MAX;

/** 표시 열 최대 개수 */
export const DISPLAY_ITEMS_MAX = 30;

/**
 * 표시 열 목록 검증 — [{key, name, hidden?}] 또는 이름 배열(옛 형식·마이그레이션: 키 = 이름).
 * 키는 겹치면 안 되고, 보이는 항목끼리는 이름도 겹치면 안 된다. 문제가 있으면 null
 */
export function parseDisplayItems(raw: unknown): DisplayItem[] | null {
  if (!Array.isArray(raw) || raw.length > DISPLAY_ITEMS_MAX * 3) return null;
  const out: DisplayItem[] = [];
  for (const x of raw as unknown[]) {
    if (isDisplayItem(x)) { out.push({ key: x.trim(), name: x.trim() }); continue; }
    const o = x as Record<string, unknown> | null;
    if (!o || !isDisplayItem(o.key) || !isDisplayItem(o.name)) return null;
    out.push({ key: (o.key as string).trim(), name: (o.name as string).trim(), ...(o.hidden === true ? { hidden: true } : {}) });
  }
  const visible = out.filter((i) => !i.hidden);
  if (visible.length > DISPLAY_ITEMS_MAX) return null;
  if (new Set(out.map((i) => i.key)).size !== out.length) return null;
  if (new Set(visible.map((i) => i.name)).size !== visible.length) return null;
  return out;
}

/**
 * 프로젝트 공통 표시 열 목록 — 저장된 목록(JSON), 없으면 업체 서식들의 표시 열을 처음 나온 순서로 모은다
 * (업체가 달라도 화면·엑셀의 열이 같은 순서로 나오게)
 */
export function displayItemsOf(raw: string | null | undefined, profiles: { sheets: SheetConfig[] }[]): DisplayItem[] {
  if (raw) {
    try {
      const list = parseDisplayItems(JSON.parse(raw));
      if (list) return list;
    } catch {
      /* 아래에서 서식으로 */
    }
  }
  const out: DisplayItem[] = [];
  const seen = new Set<string>();
  for (const p of profiles) for (const s of p.sheets) for (const d of s.display) if (!seen.has(d.item)) { seen.add(d.item); out.push({ key: d.item, name: d.item }); }
  return out;
}

/**
 * 표시 열 목록 저장용 합치기 — 화면에서 보낸 목록(next)을 쓰되, 이전에 있던 키가 빠졌으면 숨김(삭제)으로 남긴다
 * (기존 줄의 값은 데이터로 남고 화면·엑셀에서만 숨김. 같은 키를 다시 쓰지 않게)
 */
export function mergeDisplayItems(before: DisplayItem[], next: DisplayItem[]): DisplayItem[] {
  const keys = new Set(next.map((i) => i.key));
  return [...next, ...before.filter((i) => !keys.has(i.key)).map((i) => ({ ...i, hidden: true as const }))];
}

/** 새 표시 열의 키: 이름 그대로, 이미 있는 키(숨긴 항목 포함)면 뒤에 번호 */
export function newDisplayKey(name: string, items: DisplayItem[]): string {
  const base = name.trim().slice(0, DISPLAY_ITEM_MAX - 3);
  const taken = new Set(items.map((i) => i.key));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}~${n}`)) return `${base}~${n}`;
}

/** 표시 열 추가·이름 바꾸기 문제 (빈 이름·길이·보이는 항목과 이름 겹침). 없으면 null */
export function displayNameProblem(name: string, items: DisplayItem[], exceptKey?: string): string | null {
  const n = name.trim();
  if (!n) return "표시 열 이름을 입력하세요.";
  if (n.length > DISPLAY_ITEM_MAX) return `표시 열 이름은 ${DISPLAY_ITEM_MAX}자 이하로 입력하세요.`;
  if (items.some((i) => !i.hidden && i.key !== exceptKey && i.name === n)) return `이미 있는 표시 열입니다: ${n}`;
  if (!exceptKey && items.filter((i) => !i.hidden).length >= DISPLAY_ITEMS_MAX) return `표시 열은 ${DISPLAY_ITEMS_MAX}개까지입니다.`;
  return null;
}

/**
 * 화면·엑셀의 표시 열 (키 → 표시 이름): 프로젝트 목록 순서(숨긴 항목 제외)
 * + 목록에 아예 없지만 줄에 있는 이름표(옛 자료)는 뒤에 그대로
 */
export function displayColumns(items: DisplayItem[], lines: { extra: ExtraField[] }[]): { key: string; name: string }[] {
  const out = items.filter((i) => !i.hidden).map((i) => ({ key: i.key, name: i.name }));
  const known = new Set(items.map((i) => i.key));
  for (const l of lines) for (const e of l.extra) if (!known.has(e.label)) { known.add(e.label); out.push({ key: e.label, name: e.label }); }
  return out;
}

/**
 * 줄 금액과 겹치거나 내역으로 뜻이 없는 업체 열 — 총금액1·판매수량·단가·판매구간명칭 같은 이름표.
 * 줄 금액은 오른쪽에 따로 보이므로 화면 줄(PM 팀원별 내역·팀원 내역)에서는 이런 항목을 보이지 않는다
 * (표시 열 목록·저장된 줄 값·엑셀은 그대로).
 * 시간·날짜 열도 같다 — 줄의 시간(time)·날짜(date) 칸이 따로 있어 "19:40 · 식당" 옆에 "판매시간 19:40:00"이 한 번 더 보이던 중복을 없앤다 (2026-10-15)
 */
const NOISE_EXTRA_LABEL = /금액|총액|합계|수량|단가|구간|시간|시각|일자|날짜|일시|amount|total|price|qty|quantity|time|date/;
export const isNoiseExtraLabel = (label: string): boolean => NOISE_EXTRA_LABEL.test(normHeader(label));

/**
 * 코드 값 — "CATE012"·"PRD-0001"처럼 영문 대문자 뒤에 숫자만 있는 값. 업체 내부 분류 코드라 팀원에게는 뜻이 없다.
 * 화면 줄(passLineText)에서는 이런 값을 비운 것으로 본다 (저장된 줄·엑셀은 그대로)
 */
const CODE_VALUE = /^[A-Z]{2,}[-_]?\d+$/;
export const isCodeLikeValue = (value: string | null | undefined): boolean => CODE_VALUE.test((value ?? "").trim());

/** 코드 값이 들어오는 머리글 — 상품구분·상품코드·분류코드 등. 처음 추천에서 빼고, 표시 열 목록에 있으면 숨기라는 힌트를 띄운다 */
const CODE_HEADER = /코드|구분|분류|code|category/;
export const isCodeHeader = (label: string): boolean => CODE_HEADER.test(normHeader(label));

/**
 * 머리글 아래 값(최대 50행)이 비어 있지 않은 것은 모두 코드 패턴(isCodeLikeValue)인 열 번호.
 * 값이 하나도 없는 열은 코드 열로 보지 않는다
 */
export function codeOnlyColumns(table: Table, headerRow: number, sample = 50): Set<number> {
  const header = table[headerRow - 1] ?? [];
  const out = new Set<number>();
  for (let c = 0; c < header.length; c++) {
    let seen = 0, codes = 0;
    for (let r = headerRow; r < Math.min(table.length, headerRow + sample); r++) {
      const v = cellText(table[r]?.[c] ?? null);
      if (!v) continue;
      seen++;
      if (isCodeLikeValue(v)) codes++; else break;
    }
    if (seen > 0 && seen === codes) out.add(c);
  }
  return out;
}

/** 추천 표시 열에서 값이 코드뿐인 열을 뺀다 (처음 설정 추천용) */
export function withoutCodeOnlyColumns(display: Record<string, number>, table: Table, headerRow: number): Record<string, number> {
  const codes = codeOnlyColumns(table, headerRow);
  if (!codes.size) return display;
  return Object.fromEntries(Object.entries(display).filter(([, c]) => !codes.has(c)));
}

/** 수량 이름표 — 판매수량·수량·Qty 같은 표시 열 */
const QTY_LABEL = /수량|qty|quantity/;
/**
 * 줄의 수량: 수량 이름표의 값이 2 이상의 정수면 그 수, 아니면 null (1개는 기본이라 표시하지 않는다).
 * 저장된 표시 열(visibleExtra로 거르기 전)에서 읽는다 — 수량 이름표는 화면 줄에서 빠지므로(isNoiseExtraLabel) 따로 남겨 둔다
 */
export function lineQuantity(extra: ExtraField[]): number | null {
  const e = extra.find((x) => QTY_LABEL.test(normHeader(x.label)));
  if (!e) return null;
  const n = Number(e.value.replace(/,/g, "").trim());
  return Number.isInteger(n) && n >= 2 ? n : null;
}

/** 화면 줄 글자 (passLineText) */
export type PassLineText = {
  /** 1줄째 제목: 표시 열 첫 값, 없으면 구분, 없으면 '기타' (보조가 없고 수량이 2 이상이면 '김밥 × 2') */
  title: string;
  /** 보조: 표시 열 둘째 값 — 품목 이름 자리라 수량이 2 이상이면 뒤에 '× 2' (코드 값·빈 값이면 null → 화면에서는 구분으로 대신) */
  sub: string | null;
  /** 시간 (시:분) */
  time: string;
  /** 셋째부터: '이름표 값 · 이름표 값' (코드 값·빈 값은 뺀다) */
  more: string;
  /** 2줄째 전체: 보조(또는 구분) · 나머지 — 시각은 넣지 않는다 (time 필드·툴팁으로만) */
  meta: string;
};

/**
 * 출입증 한 줄의 글자 — 팀원 내 지출 내역(출입증 탭)·PM 팀원별 내역·수정 응답이 모두 이 함수로 같은 문구를 만든다.
 * extra는 visibleExtra를 거친 화면 표시 열(프로젝트 목록 순서). 코드 값(isCodeLikeValue)은 어느 자리든 비운 것으로 본다.
 * 수량(2 이상)은 품목 이름 뒤에 '× n' — 둘째 값(보조)이 있으면 거기에, 없으면 제목에 ('본사 1층 카페 / ICE아메리카노 × 2')
 */
export function passLineText(l: { extra: ExtraField[]; time?: string | null; placeType?: string | null; sheetName?: string | null; qty?: number | null }): PassLineText {
  const val = (e: ExtraField | undefined) => (!e || isCodeLikeValue(e.value) ? "" : e.value.trim());
  const place = l.placeType || l.sheetName || "";
  const first = val(l.extra[0]);
  const base = first || place || "기타";
  const qty = l.qty && l.qty >= 2 ? ` × ${l.qty}` : "";
  const second = val(l.extra[1]);
  const sub = second ? second + qty : null;
  const title = sub ? base : base + qty;
  const time = l.time ? l.time.replace(/^(\d{1,2}:\d{2}).*$/, "$1") : "";
  const more = l.extra.slice(2).flatMap((e) => { const v = val(e); return v ? [`${e.label} ${v}`] : []; }).join(" · ");
  // 2줄째에 시각은 쓰지 않는다 (2026-10-15 사용자 결정: "15:12 · 아이스크림"처럼 품목 앞에 시각이 붙어 읽기 어려움).
  // 시각은 저녁 배지·툴팁·접근성 라벨에만 쓴다 (time 필드로 돌려준다)
  const meta = [sub ?? place, more].filter(Boolean).join(" · ");
  return { title, sub, time, more, meta };
}

/**
 * 줄의 표시 열을 화면용으로: 프로젝트 목록 순서대로 모든 보이는 항목(그 업체 줄에 없는 항목은 빈 값 — 화면에서 '—'),
 * 이름표는 보이는 이름으로, 숨긴 항목은 빼고, 목록에 없는 옛 이름표는 뒤에.
 * 금액·수량·구간 같은 이름표(isNoiseExtraLabel)는 목록에 있어도 뺀다 — 줄 금액이 따로 보이므로
 */
export function visibleExtra(extra: ExtraField[], items: DisplayItem[]): ExtraField[] {
  const { known, visible } = visibleItemsOf(items);
  // 같은 이름표가 여러 번 있으면 첫 값 (find와 같게)
  const firstOf = new Map<string, string>();
  for (const e of extra) if (!firstOf.has(e.label)) firstOf.set(e.label, e.value);
  const out: ExtraField[] = visible.map((i) => ({ label: i.name, value: firstOf.get(i.key) ?? "" }));
  for (const e of extra) if (!known.has(e.label) && !isNoiseExtraLabel(e.label)) out.push(e);
  return out;
}

/**
 * 표시 열 목록에서 한 번만 계산하는 것 (키 집합, 보이는 항목) — 줄마다 visibleExtra를 부를 때 목록을 다시 거르지 않게.
 * 목록 배열은 바꾸지 않고 새로 만든다는 전제 (화면 상태·서버 조회 모두 그렇다)
 */
const visibleItemsCache = new WeakMap<DisplayItem[], { known: Set<string>; visible: { key: string; name: string }[] }>();
function visibleItemsOf(items: DisplayItem[]) {
  let v = visibleItemsCache.get(items);
  if (!v) {
    v = {
      known: new Set(items.map((i) => i.key)),
      visible: items.filter((i) => !i.hidden && !isNoiseExtraLabel(i.name) && !isNoiseExtraLabel(i.key)).map((i) => ({ key: i.key, name: i.name })),
    };
    visibleItemsCache.set(items, v);
  }
  return v;
}

/**
 * 반영 전 경고 — 기존 줄을 '다른 내용'으로 바꾸려는 것 같은 경우 (같은 업체·같은 구분 교체):
 * 날짜 범위가 겹치지 않음, 건수가 크게 다름, 파일 이름에 다른 구분 이름이 있음
 */
export function replaceWarnings(
  old: { placeType: string | null; sheetName: string | null; vendor?: string | null; date: string | null }[],
  fresh: { label: string; date: string | null }[],
  scope: string[], vendor: string, fileName: string, vendorLabels: string[],
): string[] {
  const out: string[] = [];
  const range = (ds: (string | null)[]) => { const d = ds.filter((x): x is string => !!x).sort(); return d.length ? [d[0], d[d.length - 1]] as const : null; };
  for (const label of scope) {
    const o = old.filter((l) => l.vendor === vendor && (l.placeType || l.sheetName || "") === label);
    if (!o.length) continue;
    const n = fresh.filter((l) => l.label === label);
    const ro = range(o.map((l) => l.date)), rn = range(n.map((l) => l.date));
    if (ro && rn && (rn[1] < ro[0] || rn[0] > ro[1])) out.push(`기존 ${label} 내역(${ro[0]} ~ ${ro[1]})과 이번 파일(${rn[0]} ~ ${rn[1]})의 날짜가 겹치지 않습니다. 다른 구분의 파일이 아닌지 확인하세요.`);
    if (o.length >= 5 && (n.length * 2 < o.length || n.length > o.length * 2)) out.push(`기존 ${label} ${o.length}건이 이번 파일 ${n.length}건으로 바뀝니다. 건수 차이가 큽니다.`);
  }
  const others = vendorLabels.filter((l) => !scope.includes(l) && l.trim().length >= 2);
  const named = others.filter((l) => fileName.includes(l));
  if (named.length && !scope.some((l) => fileName.includes(l))) {
    out.push(`파일 이름에 '${named.join("·")}'이(가) 있는데 '${scope.join("·")}' 구분으로 읽었습니다. 구분이 맞는지 확인하세요.`);
  }
  return out;
}

/** 업체 이름 최대 길이 */
export const VENDOR_NAME_MAX = 30;
/** 업체 미지정 줄(업체 서식 도입 전 자료 등)의 표시 이름 */
export const NO_VENDOR_LABEL = "업체 미지정";

/** 새 업체 서식의 기본 이름: 업체1, 업체2 … 중 아직 없는 것 (DB 마이그레이션도 이름 없던 서식을 업체1로 채움) */
export function defaultVendorName(existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim()));
  for (let i = 1; ; i++) if (!taken.has(`업체${i}`)) return `업체${i}`;
}

/** 업체 이름 확인 — 필수, 길이, 같은 프로젝트에서 중복 불가 (대소문자·앞뒤 공백 무시). 문제 없으면 null */
export function vendorNameProblem(name: string, existing: string[]): string | null {
  const n = name.trim();
  if (!n) return "업체 이름을 입력하세요.";
  if (n.length > VENDOR_NAME_MAX) return `업체 이름은 ${VENDOR_NAME_MAX}자 이하로 입력하세요.`;
  if (existing.some((x) => x.trim().toLowerCase() === n.toLowerCase())) return `이미 같은 이름의 업체 서식이 있습니다: ${n}`;
  return null;
}

/**
 * 파일이 업체 서식과 얼마나 맞는지 — 연결된 시트마다: 서식의 머리글을 모두 찾으면 100 + 열 수, 아니면 찾은 머리글 수.
 * 0이면 맞는 시트가 없음. ("#열번호" 지정은 어느 파일에나 있으므로 부분 점수에 넣지 않는다)
 */
export function profileScore(sheets: Sheet[], profile: SheetConfig[]): number {
  const one = (conf: SheetConfig, sheet: Sheet) => {
    if (resolveSheet(conf, sheet).ok) return 100 + configRefs(conf).length;
    const header = sheet.table[conf.headerRow - 1] ?? [];
    return configRefs(conf).filter((r) => !/^#\d+$/.test(r) && refIndex(r, header) !== null).length;
  };
  const { matches, ambiguous } = matchSheetsDetailed(sheets, profile);
  let score = 0;
  for (const { conf, sheet } of matches) score += one(conf, sheet);
  for (const a of ambiguous) {
    const sheet = sheets.find((x) => x.name === a.sheet);
    if (sheet) score += Math.max(...a.candidates.map((c) => one(c, sheet)));
  }
  return score;
}

/** 저장된 업체 서식 중 파일 머리글과 가장 잘 맞는 것 (점수가 같으면 목록 앞쪽 = 최근 사용). 하나도 맞지 않으면 null */
export function chooseVendor<T extends { vendorName: string; sheets: SheetConfig[] }>(sheets: Sheet[], profiles: T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const p of profiles) {
    const s = profileScore(sheets, p.sheets);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  return best;
}

/**
 * 내역의 정산 기간 시작일: 그 달에 올린 업체들 중 줄이 가장 많은 업체의 서식 기준 (대부분 같음).
 * 올린 줄이 없거나 서식이 없으면 최근 서식(목록 앞쪽), 그것도 없으면 1(달력 월).
 */
export function statementStartDay(vendorCounts: { vendor: string | null; count: number }[], profiles: { vendorName: string; periodStartDay: number }[]): number {
  const by = new Map(profiles.map((p) => [p.vendorName, p.periodStartDay]));
  const used = vendorCounts.filter((v) => v.vendor && by.has(v.vendor)).sort((a, b) => b.count - a.count)[0];
  return normStartDay(used ? by.get(used.vendor!) : profiles[0]?.periodStartDay ?? 1);
}

/** 열 번호 → 저장용 열 지정 */
function colRef(header: Cell[], i: number): ColumnRef {
  const text = cellText(header[i] ?? null);
  if (!text) return `#${i}`;
  const want = normHeader(text);
  let n = 0;
  for (const h of normHeads(header)) if (h === want) n++;
  return n === 1 ? text : `#${i}`;
}

/** 열 지정을 한 번 해석해 둔 것: "#번호"면 고정 열, 아니면 정규화한 머리글 */
type RefLookup = { ref: ColumnRef; fixed: number | null; want: string };
function parseRef(ref: ColumnRef): RefLookup {
  const m = ref.match(/^#(\d+)$/);
  return m ? { ref, fixed: Number(m[1]), want: "" } : { ref, fixed: null, want: normHeader(ref) };
}
function lookupRef(p: RefLookup, header: Cell[]): number | null {
  if (p.fixed !== null) return p.fixed;
  const idx = normHeads(header).indexOf(p.want);
  return idx >= 0 ? idx : null;
}

/** 저장된 열 지정 → 열 번호 (없으면 null) */
function refIndex(ref: ColumnRef, header: Cell[]): number | null {
  return lookupRef(parseRef(ref), header);
}

/** 열 지정 표시 이름 ("#3" → "D열") */
const refLabel = (ref: ColumnRef) => (/^#\d+$/.test(ref) ? `${colLetter(Number(ref.slice(1)))}열` : ref);

/** 화면 선택 → 저장용 시트 설정 */
export function toSheetConfig(sheetName: string, headerRow: number, header: Cell[], sel: ColumnSelection, label?: string | null, items: string[] = []): SheetConfig | null {
  if (sel.nameCol === undefined || sel.amountCols.length === 0) return null;
  const r = (i: number) => colRef(header, i);
  const l = label?.trim().slice(0, 20);
  return {
    sheetName, headerRow, nameCol: r(sel.nameCol), keyCols: sel.keyCols.map(r), amountCols: sel.amountCols.map(r),
    dateCol: sel.dateCol === undefined ? null : r(sel.dateCol),
    ...(sel.timeCol === undefined ? {} : { timeCol: r(sel.timeCol) }),
    display: orderDisplay(Object.entries(sel.display).map(([item, c]) => ({ item, col: r(c) })), items),
    ...(l && l !== sheetName ? { label: l } : {}),
  };
}

export type ResolvedSheet = { headerRow: number; header: Cell[]; nameCol: number; keyCols: number[]; amountCols: number[]; dateCol?: number; timeCol?: number; display: { item: string; col: number }[] };

const configRefs = (c: SheetConfig) => [c.nameCol, ...c.keyCols, ...c.amountCols, ...(c.dateCol ? [c.dateCol] : []), ...(c.timeCol ? [c.timeCol] : []), ...c.display.map((d) => d.col)];

/** 표시 열 연결을 프로젝트 목록 순서로 (목록에 없는 항목은 뒤에, 원래 순서) */
export function orderDisplay<T extends { item: string }>(links: T[], items: string[]): T[] {
  // 목록 위치는 한 번만 (같은 이름이 여러 번이면 첫 위치 — indexOf와 같게)
  const posOf = new Map<string, number>();
  items.forEach((it, i) => { if (!posOf.has(it)) posOf.set(it, i); });
  const keyed = links.map((x, i) => ({ x, i, pos: posOf.get(x.item) ?? items.length }));
  return keyed.sort((a, b) => a.pos - b.pos || a.i - b.i).map((v) => v.x);
}

/** 시트 설정의 열 지정을 모두 해석해 둔 것 (행마다 다시 찾을 때 재사용) */
function configLookups(conf: SheetConfig): RefLookup[] {
  return configRefs(conf).map(parseRef);
}

function resolveAt(conf: SheetConfig, header: Cell[], headerRow: number, lookups: RefLookup[] = configLookups(conf)): { ok: ResolvedSheet | null; missing: ColumnRef[] } {
  // configRefs 순서 = 이름, 보조 연결…, 금액…, 날짜?, 시간?, 표시… — 한 번씩만 찾는다
  const found = lookups.map((p) => lookupRef(p, header));
  const missing: ColumnRef[] = [];
  for (let i = 0; i < lookups.length; i++) if (found[i] === null) missing.push(lookups[i].ref);
  if (missing.length) return { ok: null, missing };
  let at = 0;
  const next = () => found[at++]!;
  return {
    ok: {
      headerRow, header, nameCol: next(), keyCols: conf.keyCols.map(next), amountCols: conf.amountCols.map(next),
      dateCol: conf.dateCol ? next() : undefined, timeCol: conf.timeCol ? next() : undefined, display: conf.display.map((d) => ({ item: d.item, col: next() })),
    },
    missing: [],
  };
}

/**
 * 저장된 시트 설정을 실제 시트에 맞춤: 지정 행에서 머리글을 못 찾으면 상단 30행에서 다시 찾는다.
 * 못 찾으면 없는 머리글 목록 (예: ["총금액"]).
 */
export function resolveSheet(conf: SheetConfig, sheet: Sheet): { ok: true; sheet: ResolvedSheet } | { ok: false; missing: ColumnRef[] } {
  const lookups = configLookups(conf);
  const first = resolveAt(conf, sheet.table[conf.headerRow - 1] ?? [], conf.headerRow, lookups);
  if (first.ok) return { ok: true, sheet: first.ok };
  // 머리글 글자로 지정한 경우만 다른 행에서 다시 찾기 ("#번호" 지정은 행이 바뀌면 의미 없음)
  if (!lookups.some((p) => p.fixed !== null)) {
    for (let r = 0; r < Math.min(sheet.table.length, 30); r++) {
      const c = resolveAt(conf, sheet.table[r] ?? [], r + 1, lookups);
      if (c.ok) return { ok: true, sheet: c.ok };
    }
  }
  return { ok: false, missing: first.missing };
}

/**
 * 업체 양식의 시트 설정 ↔ 파일의 시트 연결. 파일 이름·시트 이름이 매달·프로젝트마다 달라도 다시 설정하지 않게:
 * 1) 같은 이름의 시트 2) 없으면 설정한 머리글(이름·금액·날짜 등)이 모두 있는 다른 시트 (한 시트는 한 설정에만)
 */
export function matchSheets(sheets: Sheet[], profile: SheetConfig[], picks: Record<string, string> = {}): { conf: SheetConfig; sheet: Sheet; byHeader: boolean }[] {
  return matchSheetsDetailed(sheets, profile, picks).matches;
}

/** 같은 시트 이름에 구분 설정이 여러 개라 어느 구분인지 정할 수 없는 시트 (업로드할 때 구분을 골라야 함) */
export type AmbiguousSheet = { sheet: string; labels: string[] };

/**
 * 시트 연결 + 구분을 정할 수 없는 시트.
 * 같은 업체가 식당·카페를 따로 보내며 시트 이름이 같으면(예: 둘 다 Sheet1) 한 시트 이름에 구분별 설정이 여러 개 있다:
 * picks(시트 이름 → 구분)로 고른 구분 → 머리글이 맞는 설정이 하나뿐이면 그것 → 아니면 모호(ambiguous)
 */
export function matchSheetsDetailed(sheets: Sheet[], profile: SheetConfig[], picks: Record<string, string> = {}) {
  const used = new Set<string>();
  const out: { conf: SheetConfig; sheet: Sheet; byHeader: boolean }[] = [];
  const ambiguous: (AmbiguousSheet & { candidates: SheetConfig[] })[] = [];
  const rest: SheetConfig[] = [];
  const byName = new Map<string, SheetConfig[]>();
  for (const conf of profile) {
    const list = byName.get(conf.sheetName);
    if (list) list.push(conf); else byName.set(conf.sheetName, [conf]);
  }
  for (const [name, confs] of byName) {
    const sheet = sheets.find((x) => x.name === name && !used.has(x.name));
    if (!sheet) { rest.push(...confs); continue; }
    let conf: SheetConfig | undefined;
    if (confs.length === 1) conf = confs[0];
    else if (picks[name]) conf = confs.find((c) => sheetLabel(c) === picks[name]);
    else {
      const fits = confs.filter((c) => resolveSheet(c, sheet).ok);
      if (fits.length === 1) conf = fits[0];
    }
    used.add(sheet.name);
    if (conf) out.push({ conf, sheet, byHeader: false });
    else ambiguous.push({ sheet: name, labels: confs.map(sheetLabel), candidates: confs });
  }
  // 이름으로 못 찾은 설정: 구분이 이미 이름으로 연결된 설정은 건너뜀 (같은 구분을 두 번 읽지 않게)
  // 머리글이 맞는 설정의 구분이 여러 개면(같은 머리글로 식당·카페를 따로 보내는 업체) 고른 구분 → 아니면 모호
  const labels = new Set(out.map((m) => sheetLabel(m.conf)));
  for (const conf of rest) {
    if (labels.has(sheetLabel(conf))) continue;
    const sheet = sheets.find((x) => !used.has(x.name) && resolveSheet(conf, x).ok);
    if (!sheet) continue;
    const fits = rest.filter((c) => !labels.has(sheetLabel(c)) && resolveSheet(c, sheet).ok);
    const fitLabels = [...new Set(fits.map(sheetLabel))];
    used.add(sheet.name);
    if (fitLabels.length > 1) {
      const pick = picks[sheet.name] ? fits.find((c) => sheetLabel(c) === picks[sheet.name]) : undefined;
      if (pick) { labels.add(sheetLabel(pick)); out.push({ conf: pick, sheet, byHeader: true }); }
      else ambiguous.push({ sheet: sheet.name, labels: fitLabels, candidates: fits });
      continue;
    }
    labels.add(sheetLabel(conf));
    out.push({ conf, sheet, byHeader: true });
  }
  return { matches: out, ambiguous };
}

/** 화면에서 보낸 업체 양식 JSON 검증 */
export function parseProfile(raw: unknown): SheetConfig[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 30) return null;
  const ref = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 80;
  const refs = (v: unknown, max: number): string[] | null => (Array.isArray(v) && v.length <= max && v.every(ref) ? (v as string[]) : null);
  const out: SheetConfig[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (typeof o.sheetName !== "string" || !o.sheetName || o.sheetName.length > 100) return null;
    const headerRow = Number(o.headerRow);
    if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 100) return null;
    if (!ref(o.nameCol)) return null;
    const keyCols = refs(o.keyCols ?? [], 5), amountCols = refs(o.amountCols, 10);
    if (!keyCols || !amountCols || !amountCols.length) return null;
    // 표시 열: 새 형식 [{item, col}] 또는 옛 형식 displayCols [열] (머리글 이름 = 표시 열 이름)
    let display: DisplayLink[];
    if (o.display !== undefined) {
      if (!Array.isArray(o.display) || o.display.length > 30) return null;
      display = [];
      for (const d of o.display as unknown[]) {
        const x = d as Record<string, unknown> | null;
        if (!x || !isDisplayItem(x.item) || !ref(x.col)) return null;
        display.push({ item: (x.item as string).trim(), col: x.col as string });
      }
    } else {
      const legacy = refs(o.displayCols ?? [], 20);
      if (!legacy) return null;
      display = legacy.map((c) => ({ item: refLabel(c), col: c }));
    }
    if (new Set(display.map((d) => d.item)).size !== display.length) return null;
    if (o.dateCol !== undefined && o.dateCol !== null && !ref(o.dateCol)) return null;
    if (o.timeCol !== undefined && o.timeCol !== null && !ref(o.timeCol)) return null;
    if (o.label !== undefined && o.label !== null && (typeof o.label !== "string" || o.label.length > 20)) return null;
    if (o.from !== undefined && o.from !== null && (typeof o.from !== "string" || o.from.length > 100)) return null;
    const label = typeof o.label === "string" && o.label.trim() && o.label.trim() !== o.sheetName ? o.label.trim() : null;
    const conf: SheetConfig = {
      sheetName: o.sheetName, headerRow, nameCol: o.nameCol, keyCols, amountCols, dateCol: (o.dateCol as string | null | undefined) ?? null, ...(typeof o.timeCol === "string" ? { timeCol: o.timeCol } : {}), display,
      ...(label ? { label } : {}),
      ...(typeof o.from === "string" && o.from ? { from: o.from } : {}),
    };
    // 이름·연결·금액·날짜 열은 서로 달라야 함 (표시 열은 겹쳐도 됨)
    const core = [conf.nameCol, ...keyCols, ...amountCols, ...(conf.dateCol ? [conf.dateCol] : [])].map((r) => normHeader(r));
    if (new Set(core).size !== core.length) return null;
    out.push(conf);
  }
  // 같은 시트 이름은 구분이 다르면 여러 개 (업체가 식당·카페를 따로 보내며 시트 이름이 같은 경우)
  if (new Set(out.map((s) => `${s.sheetName}\u0000${sheetLabel(s)}`)).size !== out.length) return null;
  return out;
}

/** 화면에서 시트 설정을 돕는 정보 (업체 양식 처음 설정 / 다시 설정) */
export type SheetSetup = {
  /** 저장된 설정으로 미리 채웠으면 그 설정의 구분 (고쳐 저장하면 그 설정을 교체) */
  fromLabel?: string;
  name: string;
  /** 구분 (식당·카페 등, 기본은 시트 이름) */
  label: string;
  /** 사용 내역 시트로 보이는지 (이름·금액 머리글 인식) */
  detected: boolean;
  include: boolean;
  headerRow: number;
  /** 상단 행들 (머리글 행 선택·열 목록용, 최대 15행) */
  rows: string[][];
  selection: ColumnSelection;
  /** 저장된 양식에서 찾지 못한 머리글 */
  missing: string[];
  /** 새 시트일 때 참고할 기존 시트 양식 (예: 카페 파일을 처음 올릴 때 식당 양식) — 열마다 이 시트에서 찾았는지 */
  reference?: SheetReference;
};

export type SheetReference = {
  label: string;
  /** 기존 양식의 열 (항목 · 머리글 · 이 시트에 같은 머리글이 있는지) */
  cols: { role: "이름" | "날짜" | "금액" | "보조 연결" | "표시"; header: string; found: boolean }[];
  /** 같은 머리글을 찾아 미리 골라 두었는지 */
  applied: boolean;
};

/** 기존 양식의 열을 이 머리글에서 찾아본 결과 */
function referenceFor(conf: SheetConfig, header: Cell[]): { ref: Omit<SheetReference, "applied">; score: number } {
  const has = (r: ColumnRef) => refIndex(r, header) !== null && !/^#\d+$/.test(r);
  const cols: SheetReference["cols"] = [
    { role: "이름", header: refLabel(conf.nameCol), found: has(conf.nameCol) },
    ...(conf.dateCol ? [{ role: "날짜" as const, header: refLabel(conf.dateCol), found: has(conf.dateCol) }] : []),
    ...conf.amountCols.map((r) => ({ role: "금액" as const, header: refLabel(r), found: has(r) })),
    ...conf.keyCols.map((r) => ({ role: "보조 연결" as const, header: refLabel(r), found: has(r) })),
    ...conf.display.map((d) => ({ role: "표시" as const, header: `${d.item}: ${refLabel(d.col)}`, found: has(d.col) })),
  ];
  return { ref: { label: sheetLabel(conf), cols }, score: cols.filter((c) => c.found).length };
}

const emptySel = (): ColumnSelection => ({ keyCols: [], amountCols: [], display: {} });

/** 저장된 양식에서 찾은 열만 선택으로 (못 찾은 열은 추천값, 연결 안 된 표시 열은 머리글 이름이 같으면 자동 연결) */
function partialSelection(conf: SheetConfig, header: Cell[], items: DisplayItem[] = []): ColumnSelection {
  const idx = (r: ColumnRef) => refIndex(r, header);
  const many = (list: ColumnRef[]) => list.map(idx).filter((i): i is number => i !== null);
  const sug = suggestColumns(header, items) ?? emptySel();
  const name = idx(conf.nameCol);
  const amounts = many(conf.amountCols);
  const date = conf.dateCol ? idx(conf.dateCol) : null;
  const time = conf.timeCol ? idx(conf.timeCol) : null;
  return {
    timeCol: time ?? sug.timeCol,
    nameCol: name ?? sug.nameCol,
    keyCols: many(conf.keyCols),
    amountCols: amounts.length ? amounts : sug.amountCols,
    dateCol: date ?? (conf.dateCol ? sug.dateCol : undefined),
    display: {
      ...autoDisplay(header, items.filter((it) => !conf.display.some((d) => d.item === it.key))),
      ...Object.fromEntries(conf.display.flatMap((d) => { const i = idx(d.col); return i === null ? [] : [[d.item, i]]; })),
    },
  };
}

/** 시트별 설정 후보 (저장된 양식이 있으면 그 선택을 우선) */
export function sheetSetups(sheets: Sheet[], saved?: SheetConfig[] | null, items: DisplayItem[] = [], picks: Record<string, string> = {}): SheetSetup[] {
  const detailed = matchSheetsDetailed(sheets, saved ?? [], picks);
  // 구분을 정할 수 없는 시트는 첫 설정으로 채워 두고 화면에서 구분을 확인하게
  const matched = [...detailed.matches, ...detailed.ambiguous.flatMap((a) => { const sheet = sheets.find((x) => x.name === a.sheet); return sheet ? [{ conf: a.candidates[0], sheet, byHeader: false }] : []; })];
  return sheets.map((s) => {
    const det = detectHeader(s.table, items);
    const conf = matched.find((m) => m.sheet.name === s.name)?.conf;
    const width = Math.max(0, ...s.table.slice(0, 15).map((r) => r.length));
    const rows = s.table.slice(0, 15).map((r) => Array.from({ length: width }, (_, i) => cellText(r[i] ?? null)));
    if (conf) {
      const res = resolveSheet(conf, s);
      const headerRow = res.ok ? res.sheet.headerRow : conf.headerRow;
      const header = s.table[headerRow - 1] ?? [];
      return { name: s.name, label: sheetLabel(conf), fromLabel: sheetLabel(conf), detected: !!det, include: true, headerRow, rows, selection: partialSelection(conf, header, items), missing: res.ok ? [] : res.missing.map(refLabel) };
    }
    // 저장된 양식에 없는 시트: 양식에 저장된 시트가 이 파일에 하나도 없으면(다른 형태의 파일) 사용 내역으로 보이는 시트를 기본 선택
    const savedHere = matched.length > 0;
    const headerRow = det?.headerRow ?? 1;
    const header = s.table[headerRow - 1] ?? [];
    // 이 파일에 없는 기존 시트 양식(예: 식당) 중 머리글이 가장 많이 겹치는 것을 참고로 보여 주고,
    // 이름 열을 찾으면 그 선택을 미리 적용 (못 찾은 금액 등은 추천값)
    const unmatched = (saved ?? []).filter((c) => !matched.some((m) => m.conf === c));
    const best = unmatched.map((c) => ({ c, ...referenceFor(c, header) })).sort((a, b) => b.score - a.score)[0];
    const usable = !!best && best.ref.cols.some((c) => c.role === "이름" && c.found);
    const selection = usable ? partialSelection(best.c, header, items) : det?.selection ?? emptySel();
    return {
      name: s.name, label: s.name, detected: !!det, include: !savedHere && !!det, headerRow, rows, selection, missing: [],
      ...(best ? { reference: { ...best.ref, applied: usable } } : {}),
    };
  });
}

// ───────────────────────── 값 해석

const utcDate = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
};

/** 날짜: YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD, YYYY년 M월 D일, YYYYMMDD, 엑셀 일련번호, Date (시각은 무시, UTC 자정) */
export function parseCellDate(v: Cell): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : utcDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 19000101 && v <= 29991231) return utcDate(Math.floor(v / 10000), Math.floor(v / 100) % 100, v % 100);
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
      return utcDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = v.trim();
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) return utcDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\D|$)/);
  if (m) return utcDate(+m[1], +m[2], +m[3]);
  if (/^\d+(\.\d+)?$/.test(s)) return parseCellDate(Number(s));
  return null;
}

/** 금액: 숫자, "12,000", "12,000원", "₩12,000", "-3,000", "(3,000)" → 원 단위 정수 (소수·문자는 null) */
export function parseCellAmount(v: Cell): number | null {
  if (v === null || v === undefined || v instanceof Date) return null;
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  const s = v.replace(/[,\s원₩]/g, "").replace(/^\((.+)\)$/, "-$1");
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 이름 정규화 (매칭 키): 공백 제거 */
const normName = (s: string) => s.replace(/\s+/g, "").trim();
/** 번호 정규화: 공백·하이픈 제거, 대문자 (앞자리 0은 유지) */
const normKey = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

/** 보조 연결 키: "<정규화 머리글>:<정규화 값>" */
export const matchKey = (header: string, value: string) => `${normHeader(header)}:${normKey(value)}`;

/** 업체 내역 줄 → 대표 매핑 키 (첫 보조 연결 키, 없으면 이름) */
export function holderMapKey(x: { holderName: string; keys?: string[] | null }) {
  return x.keys?.[0] ?? `nm:${normName(x.holderName)}`;
}


export type ExtraField = { label: string; value: string };
/** DB의 extra(JSON) → 표시 열 */
export function parseExtra(raw: string | null | undefined): ExtraField[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.label === "string").map((x) => ({ label: x.label, value: String(x.value ?? "") })) : [];
  } catch {
    return [];
  }
}

// ───────────────────────── 정산 기간 (업체 마감일)
// 업체마다 한 달을 끊는 날이 다르다. 예) 시작일 21 → 8월분 = 7월 21일 ~ 8월 20일 (결산 월 = 끝나는 달)
// 시작일 1 → 달력 그대로 (8월 1일 ~ 8월 31일)

export const PERIOD_START_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** 시작일 값 정리: 1~28 정수, 그 외는 1 */
export function normStartDay(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 28 ? n : 1;
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 결산 월(YYYY-MM)의 사용 기간 { from, to } (YYYY-MM-DD, 양 끝 포함) */
export function passPeriod(ym: string, startDay = 1): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const d = normStartDay(startDay);
  if (d === 1) return { from: `${ym}-01`, to: `${ym}-${pad2(lastDay(y, m))}` };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { from: `${py}-${pad2(pm)}-${pad2(d)}`, to: `${ym}-${pad2(d - 1)}` };
}

/** 사용일(YYYY-MM-DD) → 결산 월 */
export function passMonthOf(date: string, startDay = 1): string {
  const d = normStartDay(startDay);
  const [y, m, day] = date.split("-").map(Number);
  if (d === 1 || day < d) return date.slice(0, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

/** 화면 표시: "7월 21일 ~ 8월 20일" */
export function passPeriodLabel(ym: string, startDay = 1) {
  const { from, to } = passPeriod(ym, startDay);
  const md = (s: string) => `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일`;
  return `${md(from)} ~ ${md(to)}`;
}

// ───────────────────────── 내역 해석

export type ParsedLine = {
  sheetName: string;
  /** 구분 (시트 설정의 label, 없으면 시트 이름) — 내역 줄 placeType */
  label: string;
  row: number;
  date: string | null;
  holderName: string;
  /** 보조 연결 키 (설정 순서) */
  keys: string[];
  amount: number;
  extra: ExtraField[];
  // 머리글이 분명히 해당하면 채우는 고정 칸 (없으면 null)
  time: string | null;
  cardNo: string | null;
  empNo: string | null;
  place: string | null;
  item: string | null;
  company: string | null;
};
export type RowError = { sheet: string; row: number; message: string };
export type SkipCounts = { blank: number; noDate: number; noName: number; total: number; formula: number; zero: number };
export const SKIP_LABEL: Record<keyof SkipCounts, string> = { blank: "빈 행", noDate: "날짜 빈 행", noName: "이름 빈 행", total: "합계 행", formula: "수식(합계) 행", zero: "0원" };

const TOTAL_RE = /(합계|총계|소계|누계|total|sum)/i;

/**
 * 시트 한 장 → 내역 줄. 금액 = 금액 열 합계(빈 칸은 0). 날짜 열이 있으면 결산 월 ym의 사용 기간(업체 시작일 기준) 밖의 날짜는 오류(조용히 버리지 않음).
 * 건너뜀: 빈 행, 날짜 칸이 빈 행, 금액 칸이 수식인 행(합계), 합계·소계 행, 이름 빈 행, 0원
 */
export function parseSheet(sheet: Sheet, conf: ResolvedSheet, ym: string, startDay = 1, label: string = sheet.name) {
  const period = passPeriod(ym, startDay);
  const lines: ParsedLine[] = [];
  const errors: RowError[] = [];
  const skipped: SkipCounts = { blank: 0, noDate: 0, noName: 0, total: 0, formula: 0, zero: 0 };
  // 머리글에서 정해지는 것은 시트마다 한 번만 (행마다 머리글을 다시 읽고 동의어를 맞추지 않게)
  const headText = conf.header.map((h, i) => cellText(h) || `${colLetter(i)}열`);
  const head = (i: number) => headText[i] ?? `${colLetter(i)}열`;
  const displayCols = conf.display.map((d) => d.col);
  const allCols = conf.header.map((_, i) => i);
  /** 머리글이 분명히 해당하는 첫 열 (없으면 undefined) */
  const pickCol = (hint: Hint, from: number[]) => from.find((i) => headerMatches(head(i), hint));
  const timeDisplayCol = pickCol("time", displayCols), timeAnyCol = pickCol("time", allCols);
  const placeCol = pickCol("place", displayCols), itemCol = pickCol("item", displayCols), companyCol = pickCol("company", displayCols), cardCol = pickCol("key", conf.keyCols);
  const empNoCol = conf.keyCols.find((i) => /사원번호|사번|empno|employee/.test(normHeader(head(i))));
  // 보조 연결 키의 머리글 부분 (matchKey의 정규화 머리글) — 행마다 다시 정규화하지 않는다
  const keyHeadNorm = conf.keyCols.map((c) => normHeader(head(c)));
  const formulas = sheet.formulas;
  const amountFormulaKeys = formulas ? conf.amountCols.map((c) => `:${c}`) : [];
  for (let r = conf.headerRow; r < sheet.table.length; r++) {
    const row = sheet.table[r] ?? [];
    const excelRow = r + 1;
    const texts = row.map(cellText);
    const get = (i: number) => row[i] ?? null;
    if (texts.every((t) => t === "")) { skipped.blank++; continue; }
    if (formulas && amountFormulaKeys.some((k) => formulas.has(`${r}${k}`))) { skipped.formula++; continue; }
    const name = cellText(get(conf.nameCol));
    // 이름이 있고 합계 글자가 아니면 합계 행이 아니다 — 그럴 때만 모든 칸을 살핀다 (조건 순서만 바뀜, 결과는 같다)
    const isTotal = (!name || TOTAL_RE.test(name)) && texts.some((t) => TOTAL_RE.test(t));
    let date: string | null = null;
    if (conf.dateCol !== undefined) {
      const raw = get(conf.dateCol);
      if (cellText(raw) === "") { skipped.noDate++; continue; }
      const d = parseCellDate(raw);
      if (!d) {
        if (isTotal) { skipped.total++; continue; }
        errors.push({ sheet: sheet.name, row: excelRow, message: `날짜를 읽을 수 없습니다 (${cellText(raw)})` });
        continue;
      }
      date = formatDate(d);
    }
    if (isTotal) { skipped.total++; continue; }
    if (!name) { skipped.noName++; continue; }
    let amount = 0;
    let bad: string | null = null;
    for (const c of conf.amountCols) {
      const raw = get(c);
      if (cellText(raw) === "") continue;
      const n = parseCellAmount(raw);
      if (n === null) { bad = `${head(c)} 금액을 읽을 수 없습니다 (${cellText(raw)})`; break; }
      amount += n;
    }
    if (bad) { errors.push({ sheet: sheet.name, row: excelRow, message: bad }); continue; }
    if (amount === 0) { skipped.zero++; continue; }
    if (Math.abs(amount) > 10_000_000) { errors.push({ sheet: sheet.name, row: excelRow, message: "금액이 너무 큽니다" }); continue; }
    if (date && (date < period.from || date > period.to)) {
      errors.push({ sheet: sheet.name, row: excelRow, message: `${ym} 정산 기간(${passPeriodLabel(ym, startDay)}) 밖의 날짜입니다 (${date})` });
      continue;
    }

    const keys: string[] = [];
    conf.keyCols.forEach((c, i) => { const k = normKey(cellText(get(c))); if (k) keys.push(`${keyHeadNorm[i]}:${k}`); });
    // 표시 열: 프로젝트 목록 키 → 값 (연결한 항목만, 목록 순서)
    const extra = conf.display.map((d) => ({ label: d.item, value: cellText(get(d.col)).slice(0, 100) }));
    const pick = (c: number | undefined) => (c === undefined ? null : cellText(get(c)).slice(0, 80) || null);
    lines.push({
      sheetName: sheet.name, label, row: excelRow, date, holderName: name.slice(0, 60), keys, amount, extra,
      // 시간: 서식에서 정한 시간 열 → 표시 열 중 시간 머리글 → 시간으로 보이는 아무 머리글
      time: (conf.timeCol !== undefined ? cellText(get(conf.timeCol)).slice(0, 20) || null : null) ?? pick(timeDisplayCol) ?? pick(timeAnyCol), place: pick(placeCol), item: pick(itemCol),
      company: pick(companyCol), cardNo: pick(cardCol),
      empNo: empNoCol === undefined ? null : cellText(get(empNoCol)) || null,
    });
  }
  return { lines, errors, skipped };
}

export type SheetProblem = { sheet: string; message: string };
export type WorkbookResult =
  | {
    ok: true; lines: ParsedLine[]; errors: RowError[];
    perSheet: { sheetName: string; label: string; count: number; amount: number; skipped: SkipCounts; columns: string[] }[];
    /** 이 파일에서 찾은 시트의 설정 (머리글 행 보정 포함) */
    resolved: SheetConfig[];
    /** 이번 파일이 바꾸는 구분 — 기존 내역에서 이 구분의 줄만 교체 */
    scope: string[];
    /** 양식에 없어 읽지 않은 시트 중 사용 내역으로 보이는 시트 */
    unconfigured: string[];
  }
  | { ok: false; problems: SheetProblem[]; ambiguous?: AmbiguousSheet[] };

/**
 * 업체 양식대로 여러 시트 해석. 양식의 시트가 파일에 없으면 건너뛴다(식당·카페를 따로 받는 달).
 * 양식의 시트가 하나도 없거나, 찾은 시트의 머리글이 없으면 ok:false + 어떤 것이 없는지
 */
export function parseWorkbook(sheets: Sheet[], profile: SheetConfig[], ym: string, startDay = 1, items: string[] = [], picks: Record<string, string> = {}): WorkbookResult {
  const problems: SheetProblem[] = [];
  const lines: ParsedLine[] = [];
  const errors: RowError[] = [];
  const perSheet: Extract<WorkbookResult, { ok: true }>["perSheet"] = [];
  const resolved: SheetConfig[] = [];
  const { matches: matched, ambiguous } = matchSheetsDetailed(sheets, profile, picks);
  if (ambiguous.length) {
    // 같은 시트 이름에 구분 설정이 여러 개 — 구분을 자동으로 정하지 않는다 (잘못 정하면 다른 구분 내역이 바뀜)
    return {
      ok: false, ambiguous: ambiguous.map(({ sheet, labels }) => ({ sheet, labels })),
      problems: ambiguous.map((a) => ({ sheet: a.sheet, message: `'${a.sheet}' 시트가 어느 구분(${a.labels.join("·")})인지 고르세요.` })),
    };
  }
  if (!matched.length) {
    // 저장된 양식의 시트가 하나도 없는 파일 = 새 구분(예: 식당만 저장된 상태에서 카페 파일) — 오류가 아니라 처음 설정
    const labels = [...new Set(profile.map(sheetLabel))].join("·");
    return { ok: false, problems: [{ sheet: "", message: `저장된 서식(${labels})에 없는 파일입니다. 새 구분(예: 카페)이면 시트·열을 고르고 구분 이름을 정하세요. 기존 ${labels} 내역은 그대로 남습니다.` }] };
  }
  for (const { conf, sheet } of matched) {
    const at = resolveSheet(conf, sheet);
    if (!at.ok) {
      for (const m of at.missing) problems.push({ sheet: sheet.name, message: `${sheet.name} 시트의 '${refLabel(m)}' 열을 찾을 수 없습니다.` });
      continue;
    }
    const label = sheetLabel(conf);
    // 표시 열은 프로젝트 목록 순서로 (업체가 달라도 같은 달 줄의 항목 순서가 같게)
    const resolvedSheet = { ...at.sheet, display: orderDisplay(at.sheet.display, items) };
    const r = parseSheet(sheet, resolvedSheet, ym, startDay, label);
    for (const l of r.lines) lines.push(l);
    errors.push(...r.errors);
    perSheet.push({
      sheetName: sheet.name, label, count: r.lines.length, amount: r.lines.reduce((a, l) => a + l.amount, 0), skipped: r.skipped,
      columns: resolvedSheet.display.map((d) => d.item),
    });
    resolved.push({ ...conf, headerRow: at.sheet.headerRow, display: orderDisplay(conf.display, items) });
  }
  if (problems.length) return { ok: false, problems };
  const unconfigured = sheets.filter((s) => !matched.some((m) => m.sheet.name === s.name) && detectHeader(s.table)).map((s) => s.name);
  return { ok: true, lines, errors, perSheet, resolved, scope: [...new Set(resolved.map(sheetLabel))], unconfigured };
}

/** 반영 전 미리보기: 시트별 앞 5건·건수·금액·건너뛴 행, 사람별 합계, 전체 합계 */
export function buildPreview(result: Extract<WorkbookResult, { ok: true }>) {
  const people = new Map<string, { holderName: string; count: number; amount: number; keys: string[] }>();
  // 시트별 앞 5건·전체 합계도 같은 한 번의 순회에서
  const firstRows = new Map<string, { row: number; date: string | null; holderName: string; amount: number; extra: ExtraField[] }[]>();
  let amount = 0;
  for (const l of result.lines) {
    const k = holderMapKey(l);
    const p = people.get(k) ?? { holderName: l.holderName, count: 0, amount: 0, keys: l.keys };
    p.count++;
    p.amount += l.amount;
    people.set(k, p);
    amount += l.amount;
    let rows = firstRows.get(l.sheetName);
    if (!rows) firstRows.set(l.sheetName, (rows = []));
    if (rows.length < 5) rows.push({ row: l.row, date: l.date, holderName: l.holderName, amount: l.amount, extra: l.extra });
  }
  return {
    total: { count: result.lines.length, amount },
    sheets: result.perSheet.map((s) => ({ ...s, rows: firstRows.get(s.sheetName) ?? [] })),
    people: [...people.values()].sort((a, b) => b.amount - a.amount),
    errors: result.errors.slice(0, 100),
    errorCount: result.errors.length,
    scope: result.scope,
    unconfigured: result.unconfigured,
  };
}
export type PassPreview = ReturnType<typeof buildPreview>;

// ───────────────────────── 팀원 매칭

export type PassMember = { userId: string; name: string };
export type MatchSource = "HOLDER" | "NAME" | null;

/**
 * 업체 내역의 이름 → 프로젝트 팀원.
 * 1) 보조 연결 열 값으로 기억된 매핑 (설정 순서) 2) 이름으로 기억된 매핑 3) 팀원 중 이름이 유일하게 일치 4) 미확인
 */
export function matchHolder(line: { holderName: string; keys: string[] }, members: PassMember[], holders: Map<string, string>): { userId: string | null; source: MatchSource } {
  const { memberIds, byName } = memberIndexOf(members);
  const nameKey = normName(line.holderName);
  for (const k of line.keys) {
    const u = holders.get(k);
    if (u && memberIds.has(u)) return { userId: u, source: "HOLDER" };
  }
  const u = holders.get(`nm:${nameKey}`);
  if (u && memberIds.has(u)) return { userId: u, source: "HOLDER" };
  const same = byName.get(nameKey);
  if (same && same.length === 1) return { userId: same[0].userId, source: "NAME" };
  return { userId: null, source: null };
}

/**
 * 팀원 목록에서 한 번만 만드는 색인 (id 집합, 정규화한 이름 → 팀원) — 줄마다 matchHolder를 부를 때 목록을 다시 훑지 않게.
 * 팀원 배열은 조회 뒤 바꾸지 않는다는 전제
 */
const memberIndexCache = new WeakMap<PassMember[], { memberIds: Set<string>; byName: Map<string, PassMember[]> }>();
function memberIndexOf(members: PassMember[]) {
  let idx = memberIndexCache.get(members);
  if (!idx) {
    const byName = new Map<string, PassMember[]>();
    for (const m of members) {
      const n = normName(m.name);
      const list = byName.get(n);
      if (list) list.push(m); else byName.set(n, [m]);
    }
    idx = { memberIds: new Set(members.map((m) => m.userId)), byName };
    memberIndexCache.set(members, idx);
  }
  return idx;
}

/** 팀원 지정 시 기억할 매핑 키: 보조 연결 키가 있으면 모두, 없으면 이름 */
export const mappingKeys = (line: { holderName: string; keys: string[] }) => (line.keys.length ? line.keys : [`nm:${normName(line.holderName)}`]);

// ───────────────────────── 다시 올리기: 팀원 표시·결정·외부인 처리 이어받기

export type CarryLine = {
  date: string | null;
  holderName: string;
  amount: number;
  extra: string | null;
  userId: string | null;
  memberClaim: string | null;
  memberNote: string | null;
  decision: string | null;
  usageItemId: string | null;
  decisionSource: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  onBehalfName: string | null;
  collectFrom: string | null;
  collectedAt: Date | null;
  collectNote: string | null;
};

/** 표시 열은 항목 이름 순으로 맞춰 비교 (표시 열 순서가 바뀌어도 같은 줄로 본다) */
const extraKey = (raw: string | null) => {
  const list = parseExtra(raw).filter((e) => e.value !== "").sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  // 길이를 앞에 붙인 연결 — JSON 직렬화와 같이 (이름표, 값) 목록이 같을 때만 같은 키 (내부 비교용 키라 모양은 상관없다)
  let k = "";
  for (const e of list) k += `${e.label.length}:${e.label}${e.value.length}:${e.value}`;
  return k;
};
const carryKey = (l: { date: string | null; holderName: string; amount: number; extra: string | null }) =>
  `${l.date ?? ""}|${normName(l.holderName)}|${l.amount}|${extraKey(l.extra)}`;

/** 같은 날짜·이름·금액·표시 열의 기존 줄에서 표시·결정·외부인 처리를 1:1로 이어받는다 (같은 팀원이거나 외부인 처리 건) */
export function carryOver<T extends { date: string | null; holderName: string; amount: number; extra: string | null; userId: string | null }>(
  oldLines: CarryLine[],
  newLines: T[],
): { lines: (T & Partial<CarryLine>)[]; carried: number } {
  const pool = new Map<string, CarryLine[]>();
  for (const o of oldLines) {
    const k = carryKey(o);
    const list = pool.get(k);
    if (list) list.push(o); else pool.set(k, [o]);
  }
  let carried = 0;
  const lines = newLines.map((n) => {
    const list = pool.get(carryKey(n));
    const idx = list?.findIndex((o) => o.onBehalfName || o.userId === n.userId) ?? -1;
    if (!list || idx < 0) return n;
    const [o] = list.splice(idx, 1);
    if (!o.memberClaim && !o.decision && !o.memberNote && !o.onBehalfName) return n;
    carried++;
    return {
      ...n,
      userId: o.onBehalfName ? o.userId : n.userId,
      memberClaim: o.memberClaim, memberNote: o.memberNote,
      decision: o.decision, usageItemId: o.usageItemId, decisionSource: o.decisionSource, decidedBy: o.decidedBy, decidedAt: o.decidedAt,
      onBehalfName: o.onBehalfName, collectFrom: o.collectFrom, collectedAt: o.collectedAt, collectNote: o.collectNote,
    };
  });
  return { lines, carried };
}

// ───────────────────────── 결정

export type DecideLine = { id: string; userId: string | null; memberClaim: string | null; decision: string | null };
export type BulkAction = "accept-claims" | "all-overtime" | "rest-deduct";
export const BULK_ACTIONS: BulkAction[] = ["accept-claims", "all-overtime", "rest-deduct"];

/**
 * 일괄 결정 대상 → [{id, decision}]
 * - accept-claims ("체크한 건 제외 인정"): 미결정 + 팀원이 업무 사용을 표시한 줄 → 제외 인정 (표시 없는 줄·옛 PERSONAL 줄은 그대로 미결정)
 * - all-overtime: lineIds를 주면 그 줄 모두(기존 결정 덮어씀), 없으면 미결정 줄 모두 제외 인정
 * - rest-deduct ("남은 건 본인 부담"): (lineIds 범위 안의) 미결정 줄 모두 본인 부담
 */
export function bulkDecisions(lines: DecideLine[], action: BulkAction, lineIds?: string[] | null): { id: string; decision: PassDecision }[] {
  const ids = lineIds?.length ? new Set(lineIds) : null;
  const scope = ids ? lines.filter((l) => ids.has(l.id)) : lines;
  switch (action) {
    case "accept-claims":
      return scope.filter((l) => !l.decision && l.memberClaim === "OVERTIME").map((l) => ({ id: l.id, decision: "OVERTIME" }));
    case "all-overtime":
      return (lineIds?.length ? scope : scope.filter((l) => !l.decision)).filter((l) => l.decision !== "OVERTIME").map((l) => ({ id: l.id, decision: "OVERTIME" }));
    case "rest-deduct":
      return scope.filter((l) => !l.decision).map((l) => ({ id: l.id, decision: "DEDUCT" }));
  }
}

/**
 * 일괄 결정을 화면 줄에 바로 반영 (bulk API와 같은 규칙): 회사 부담 항목은 지정한 항목 → 줄에 있던 항목(팀원 요청) → 항목이 하나뿐이면 그 항목.
 * 서버 새로고침을 기다리는 동안에도 합계와 줄 표시가 같은 줄 목록에서 나오게 한다 (새로고침 후 서버 값으로 다시 맞춰진다)
 */
export function applyBulk<T extends DecideLine & { usageItemId: string | null; usageItemName?: string | null; decisionSource?: string | null }>(
  lines: T[], action: BulkAction, lineIds: string[] | null | undefined, itemId: string | null, items: PassItem[], source: PassDecisionSource,
): T[] {
  const changes = new Map(bulkDecisions(lines, action, lineIds).map((c) => [c.id, c.decision]));
  if (!changes.size) return lines;
  const only = items.length === 1 ? items[0].id : null;
  // 항목 id → 이름 (같은 id가 여러 번이면 첫 것 — find와 같게)
  const nameOf = new Map<string, string>();
  for (const i of items) if (!nameOf.has(i.id)) nameOf.set(i.id, i.name);
  return lines.map((l) => {
    const decision = changes.get(l.id);
    if (!decision) return l;
    const usageItemId = decision === "OVERTIME" ? itemId ?? l.usageItemId ?? only : null;
    const usageItemName = usageItemId ? nameOf.get(usageItemId) ?? (usageItemId === l.usageItemId ? l.usageItemName ?? null : null) : null;
    return { ...l, decision, usageItemId, usageItemName, decisionSource: source };
  });
}

/** 사람이 정한 결정 — 출처가 SOLIDAY(자동)·DEFAULT(확정 후 빈 값 보정)가 아닌 것 */
const isManualDecision = (l: { decision: string | null; decisionSource?: string | null }) =>
  !!l.decision && l.decisionSource !== "SOLIDAY" && l.decisionSource !== "DEFAULT";

/**
 * 결정 지우기(일괄 "clear")의 대상 — 고른 줄(lineIds) 중 결정이 있는 줄 (없으면 바꿀 게 없다).
 * 고른 줄은 그대로 믿는다: 외부인 대납·Soliday 자동 줄도 사용자가 골랐으면 지운다.
 * 되돌리면 ✓ 해제(PATCH decision:null)와 같은 값 — 팀원이 회사 부담을 요청한 줄은 요청 항목을 남기고, 그 밖에는 항목도 비운다
 */
export function clearTargets<T extends { id: string; decision: string | null; memberClaim: string | null }>(lines: T[], lineIds: string[]): { keepItem: T[]; dropItem: T[] } {
  const ids = new Set(lineIds);
  const scope = lines.filter((l) => ids.has(l.id) && l.decision);
  return { keepItem: scope.filter((l) => l.memberClaim === "OVERTIME"), dropItem: scope.filter((l) => l.memberClaim !== "OVERTIME") };
}

/** 결정 지우기를 화면 줄에 바로 반영 (clearTargets와 같은 규칙) — 줄은 사라지지 않는다 */
export function applyClear<T extends { id: string; decision: string | null; memberClaim: string | null; usageItemId: string | null; usageItemName?: string | null; decisionSource?: string | null }>(lines: T[], lineIds: string[]): T[] {
  const { keepItem, dropItem } = clearTargets(lines, lineIds);
  if (!keepItem.length && !dropItem.length) return lines;
  const keep = new Set(keepItem.map((l) => l.id));
  const drop = new Set(dropItem.map((l) => l.id));
  return lines.map((l) => (keep.has(l.id) ? { ...l, decision: null, decisionSource: null } : drop.has(l.id) ? { ...l, decision: null, decisionSource: null, usageItemId: null, usageItemName: null } : l));
}

/** 한 팀원 줄 중 '정한 것 모두 지우기'로 지울 수 있는 줄 — 사람이 정한 결정(출처 PM·HQ·ADMIN), 외부인 대납 건은 제외('외부인 처리 취소'가 따로 있다) */
export const clearableLines = <T extends { decision: string | null; decisionSource?: string | null; onBehalfName?: string | null }>(lines: T[]): T[] =>
  lines.filter((l) => isManualDecision(l) && !l.onBehalfName);

/**
 * PM 팀원별 내역의 '요청 확인할 팀원만' — 켤 때 요청이 있던 팀원(pinned)은 요청을 다 정한 뒤에도 목록에 남긴다.
 * (요청 건수로만 거르면 '요청대로 정하기'나 마지막 건을 정하는 순간 그 팀원이 화면에서 사라져, 회사 부담 합계에는 있는데 줄은 보이지 않는다)
 * pinned가 null이면 전체. 켠 뒤 새로 들어온 요청(claims > 0)도 보인다
 */
export function filterPeople<T extends { userId: string; claims: number }>(groups: T[], pinned: Set<string> | null): T[] {
  return pinned ? groups.filter((g) => pinned.has(g.userId) || g.claims > 0) : groups;
}

/** 요청 건 — 팀원이 회사 부담을 요청했고(OVERTIME) PM이 아직 정하지 않은 줄 */
const isPendingClaim = (l: { decision: string | null; memberClaim: string | null }) => !l.decision && l.memberClaim === "OVERTIME";

/** '요청 확인할 팀원·건만'을 켤 때 고정할 줄 — 그 순간의 요청 건 id (팀원과 같은 방식으로, 정한 뒤에도 결과를 보여 주기 위해) */
export function pinClaims<T extends { id: string; decision: string | null; memberClaim: string | null }>(lines: T[]): Set<string> {
  return new Set(lines.filter(isPendingClaim).map((l) => l.id));
}

/**
 * 한 팀원의 보이는 줄 — '요청 확인할 팀원·건만'이 켜져 있으면(pinnedLineIds가 null이 아니면) 켤 때 요청 건이던 줄(정한 뒤에도 결과가 보이게)
 * + 켠 뒤 새로 들어온 요청 건. 켜기 전에 이미 정한 줄·요청이 없던 줄은 숨긴다. null이면 전체
 */
export function filterLines<T extends { id: string; decision: string | null; memberClaim: string | null }>(lines: T[], pinnedLineIds: Set<string> | null): T[] {
  return pinnedLineIds ? lines.filter((l) => pinnedLineIds.has(l.id) || isPendingClaim(l)) : lines;
}

/** 한 팀원의 아직 정하지 않은 줄 (외부인 대납 건 제외) — '건마다 보며 정하기'의 순서 */
export const undecidedLines = <T extends { decision: string | null; onBehalfName?: string | null }>(lines: T[]): T[] => lines.filter((l) => !l.decision && !l.onBehalfName);

/**
 * '건마다 보며 정하기'의 다음 건: 지금 보던 줄(currentId) 다음에 오는 정하지 않은 줄, 없으면 처음부터(보던 줄로 돌아올 수 있음). 정할 줄이 없으면 null.
 * decided = 보던 줄을 방금 정했다 (화면 줄 목록이 아직 옛 값이어도 그 줄은 빼고 찾는다)
 */
export function nextUndecided<T extends { id: string; decision: string | null; onBehalfName?: string | null }>(lines: T[], currentId: string | null, decided = false): T | null {
  const wanted = (l: T) => !l.decision && !l.onBehalfName && !(decided && l.id === currentId);
  const pos = currentId ? lines.findIndex((l) => l.id === currentId) : -1;
  // 보던 줄 다음부터 처음 나오는 정하지 않은 줄 (같은 객체가 앞에도 있으면 그 줄은 앞의 것으로 본다 — indexOf 기준)
  for (let i = pos + 1; i < lines.length; i++) {
    const l = lines[i];
    if (wanted(l) && lines.indexOf(l) > pos) return l;
  }
  // 없으면 처음부터 (보던 줄로 돌아올 수 있음)
  for (const l of lines) if (wanted(l)) return l;
  return null;
}

/** 외부인 사용 → PM 사용분: 업체 파일의 이름을 실제 사용자로 남기고 PM에게 급여 공제(기본), PM이 외부인에게 받아 낸다 */
export function externalAssignment(line: { holderName: string; onBehalfName?: string | null }, pmId: string, collectFrom?: string | null) {
  const who = line.onBehalfName || line.holderName;
  return {
    userId: pmId,
    onBehalfName: who,
    collectFrom: (collectFrom ?? "").trim() || who,
    collectedAt: null,
    memberClaim: null,
    memberNote: null,
    decision: "DEDUCT" as const,
    decisionSource: "PM" as const,
  };
}

/**
 * 월 확정 가능 여부 → 문제 메시지 (없으면 null).
 * 출입증 사용분은 기본이 본인 부담(급여 공제) — 따로 정하지 않은 건은 확정 시 본인 부담이 된다.
 * 막는 경우: 연결 안 된 이름(팀원과 연결되지 않은 줄), PM이 아직 확인하지 않은 팀원의 회사 부담 요청
 */
export function confirmProblem(lines: { userId: string | null; decision: string | null; memberClaim?: string | null }[]): string | null {
  if (lines.length === 0) return "확정할 내역이 없습니다.";
  const unmatched = lines.filter((l) => !l.userId).length;
  const claims = lines.filter((l) => !isDecision(l.decision) && l.memberClaim === "OVERTIME").length;
  if (unmatched) return `연결 안 된 이름이 있습니다 (${unmatched}건) — 팀원을 지정하거나 외부인 사용으로 처리하세요.`;
  if (claims) return `팀원 요청 ${claims}건을 먼저 정하세요 (회사 부담 또는 본인 부담).`;
  return null;
}

/** 확정 시점에 따로 정하지 않은 줄 (기본 본인 부담) — 확정 라우트가 감사 기록(defaultDeducted)에 건수를 남기는 데 쓴다. 줄 자체는 바꾸지 않는다 */
export const defaultDeductIds = (lines: { id: string; decision: string | null }[]) => lines.filter((l) => !isDecision(l.decision)).map((l) => l.id);

/**
 * 확정된 출입증 내역의 기본값 채우기 — CONFIRMED면 decision이 비어 있는 줄을 본인 부담(DEDUCT, 출처 DEFAULT)으로 읽는다.
 * 확정 때 줄을 갱신하지 않는다: 2026-10 운영에서 대량 갱신이 D1 바인딩 한도로 실패해 상태만 CONFIRMED가 되고 1,525줄이 빈 값으로 남은 사고가 있어
 * "확정된 내역에서 빈 값 = 본인 부담"으로 읽기로 결정. 모든 읽기 경로(서버 로더·엑셀·API)가 이 함수를 거친다.
 * OPEN이면 그대로(미결정). usageItemId는 손대지 않는다. 확정 취소(OPEN)되면 자동으로 다시 미결정이 된다
 */
export function applyConfirmedDefaults<T extends { decision: string | null; decisionSource?: string | null }>(lines: T[], status: "OPEN" | "CONFIRMED" | string): T[] {
  if (status !== "CONFIRMED") return lines;
  return lines.map((l) => (isDecision(l.decision) ? l : { ...l, decision: "DEDUCT", decisionSource: l.decisionSource ?? "DEFAULT" }));
}

// ───────────────────────── 집계

export type SummaryLine = {
  userId: string | null; userName?: string | null; holderName: string; amount: number; memberClaim: string | null; decision: string | null; onBehalfName?: string | null;
  usageItemName?: string | null; sheetName?: string | null; placeType?: string | null;
  /** 하루 한도 배분용 (items를 주면 같은 사람·날·항목의 회사 부담을 한도까지만 인정) */
  id?: string; date?: string | Date | null; usageItemId?: string | null; time?: string | null;
};
type Bucket = { amount: number; count: number };
const bucket = (): Bucket => ({ amount: 0, count: 0 });
const add = (b: Bucket, n: number) => { b.amount += n; b.count++; };

export type PersonSummary = { userId: string | null; name: string; total: Bucket; overtime: Bucket; deduct: Bucket; undecided: Bucket; external: Bucket };

/** 한국어 이름 정렬 — localeCompare(…, "ko")와 같은 결과를 내는 비교기를 모듈에서 한 번만 만든다 */
const KO = new Intl.Collator("ko");

/**
 * 하루 한도 배분 결과 — 집계·공제·팀원 예상이 같은 줄 목록으로 companySplit을 세 번 부르지 않게,
 * 호출부가 미리 계산한 배분(split)을 주면 그것을 쓴다 (없으면 여기서 계산). id 없는 줄은 배분에서 빠진다
 */
function splitOf<L extends Omit<SplitLine, "id"> & { id?: string }>(lines: L[], passItems: PassItem[] | undefined, split: Map<string, CompanySplit> | undefined): ReadonlyMap<string, CompanySplit> {
  return split ?? (passItems ? companySplit(lines.filter((l): l is L & { id: string } => !!l.id), passItems) : EMPTY_SPLIT);
}
const EMPTY_SPLIT: ReadonlyMap<string, CompanySplit> = new Map();

/**
 * 월 집계: 전체·제외 인정(회사 부담)·급여 공제·미결정, 사람별 (미확인은 업체 표기 이름별).
 * items를 주면 하루 한도 배분(companySplit)을 반영: 회사 부담은 한도까지만, 초과분은 본인 부담(급여 공제)에 더한다 (건수도 양쪽에)
 * @param split 같은 줄 목록으로 미리 계산한 companySplit(lines, passItems) — 주면 다시 계산하지 않는다
 */
export function summarizeStatement(lines: SummaryLine[], passItems?: PassItem[], split?: Map<string, CompanySplit>) {
  const total = bucket(), overtime = bucket(), deduct = bucket(), undecided = bucket(), external = bucket();
  // 기본 본인 부담(따로 정하지 않았고 회사 부담 요청도 없는 건)·확인할 팀원 요청
  const defaultDeduct = bucket(), claimed = bucket();
  const byPerson = new Map<string, PersonSummary>();
  const byItem = new Map<string, { name: string; amount: number; count: number; places: Map<string, number> }>();
  const sp = splitOf(lines, passItems, split);
  let unmatched = 0, pendingClaims = 0;
  for (const l of lines) {
    add(total, l.amount);
    const k = l.userId ?? `?${normName(l.holderName)}`;
    const p = byPerson.get(k) ?? { userId: l.userId, name: l.userId ? l.userName ?? l.holderName : l.holderName, total: bucket(), overtime: bucket(), deduct: bucket(), undecided: bucket(), external: bucket() };
    add(p.total, l.amount);
    if (l.decision === "OVERTIME") {
      const s = l.id ? sp.get(l.id) : undefined;
      const company = s?.company ?? l.amount;
      const personal = l.amount - company;
      add(overtime, company); add(p.overtime, company);
      if (personal > 0) { add(deduct, personal); add(p.deduct, personal); }
      const name = l.usageItemName || "항목 미지정";
      const it = byItem.get(name) ?? { name, amount: 0, count: 0, places: new Map() };
      it.amount += company; it.count++;
      const place = l.placeType || l.sheetName || "기타";
      it.places.set(place, (it.places.get(place) ?? 0) + company);
      byItem.set(name, it);
    }
    else if (l.decision === "DEDUCT") { add(deduct, l.amount); add(p.deduct, l.amount); }
    else {
      add(undecided, l.amount); add(p.undecided, l.amount);
      // PM이 확인할 요청은 업무 사용(OVERTIME)뿐 — 표시 없는 줄(옛 PERSONAL 포함)은 기본 본인 부담
      if (l.memberClaim === "OVERTIME") { pendingClaims++; add(claimed, l.amount); } else add(defaultDeduct, l.amount);
    }
    if (l.onBehalfName) { add(external, l.amount); add(p.external, l.amount); }
    if (!l.userId) unmatched++;
    byPerson.set(k, p);
  }
  const people = [...byPerson.values()].sort((a, b) => (a.userId ? 0 : 1) - (b.userId ? 0 : 1) || KO.compare(a.name, b.name));
  // 회사 부담 항목별 합계 (사용처별 내역 포함, 큰 금액 순)
  const items = [...byItem.values()].sort((a, b) => b.amount - a.amount).map(({ places, ...it }) => ({ ...it, places: [...places].map(([place, amount]) => ({ place, amount })) }));
  return { total, overtime, deduct, undecided, external, unmatched, pendingClaims, defaultDeduct, claimed, people, items };
}

/**
 * 급여 공제 대상 (결정 DEDUCT + 회사 부담 줄의 하루 한도 초과분): 사람별 합계·건수 + 외부인 대납분.
 * 줄마다 deductAmount(공제 금액)·companyAmount(회사 부담분) — 한도 초과분이 있는 회사 부담 줄은 초과분만 공제
 */
export type DeductLine<T> = T & { deductAmount: number; companyAmount: number };
export function deductionList<T extends { id?: string; userId: string | null; amount: number; decision: string | null; memberClaim?: string | null; onBehalfName?: string | null; date?: string | Date | null; usageItemId?: string | null; time?: string | null }>(lines: T[], passItems?: PassItem[], split?: Map<string, CompanySplit>) {
  const sp = splitOf(lines, passItems, split);
  const map = new Map<string, { userId: string; amount: number; count: number; lines: DeductLine<T>[]; onBehalf: { name: string; amount: number; count: number }[] }>();
  for (const l of lines) {
    if (!l.userId) continue;
    // 따로 정하지 않은 건도 기본 본인 부담 (팀원이 회사 부담을 요청한 건은 PM 확인 전이라 제외)
    const deduct = l.decision === "DEDUCT" || (!isDecision(l.decision) && l.memberClaim !== "OVERTIME");
    const over = l.decision === "OVERTIME" && l.id ? sp.get(l.id)?.personal ?? 0 : 0;
    if (!deduct && over <= 0) continue;
    const deductAmount = deduct ? l.amount : over;
    const p = map.get(l.userId) ?? { userId: l.userId, amount: 0, count: 0, lines: [], onBehalf: [] };
    p.amount += deductAmount;
    p.count++;
    p.lines.push({ ...l, deductAmount, companyAmount: l.amount - deductAmount });
    if (l.onBehalfName) {
      let o = p.onBehalf.find((x) => x.name === l.onBehalfName);
      if (!o) { o = { name: l.onBehalfName, amount: 0, count: 0 }; p.onBehalf.push(o); }
      o.amount += deductAmount;
      o.count++;
    }
    map.set(l.userId, p);
  }
  return [...map.values()];
}

/** 급여 공제 엑셀 비고: "외부인(홍길동) 대납 포함 12,000원" */
export const onBehalfNote = (list: { name: string; amount: number }[]) =>
  list.length ? `외부인(${list.map((o) => o.name).join(", ")}) 대납 포함 ${won(list.reduce((a, o) => a + o.amount, 0))}원` : "";

/** 외부인 수금: 받을 사람별 건수·금액·받음 여부 */
export function externalGroups<T extends { id: string; amount: number; onBehalfName: string | null; collectFrom: string | null; collectedAt: Date | string | null; collectNote: string | null; userId: string | null }>(lines: T[]) {
  const map = new Map<string, { name: string; count: number; amount: number; collected: number; lineIds: string[]; note: string | null; payerIds: string[] }>();
  for (const l of lines) {
    if (!l.onBehalfName) continue;
    const name = l.collectFrom || l.onBehalfName;
    const g = map.get(name) ?? { name, count: 0, amount: 0, collected: 0, lineIds: [], note: null, payerIds: [] };
    g.count++;
    g.amount += l.amount;
    if (l.collectedAt) g.collected++;
    g.lineIds.push(l.id);
    g.note ??= l.collectNote;
    if (l.userId && !g.payerIds.includes(l.userId)) g.payerIds.push(l.userId);
    map.set(name, g);
  }
  return [...map.values()].map((g) => ({ ...g, allCollected: g.collected === g.count })).sort((a, b) => KO.compare(a.name, b.name));
}

/**
 * 팀원 화면: 이번 달 사용 합계·제외 체크 합계·예상 공제액.
 * 예상 공제 = 본인 부담으로 정해진 건 + 아직 정해지지 않았고 제외 체크하지 않은 건 (확인되지 않으면 공제되므로).
 */
export function memberExpectation(lines: { id?: string; userId?: string | null; amount: number; memberClaim: string | null; decision: string | null; date?: string | Date | null; usageItemId?: string | null; time?: string | null }[], passItems?: PassItem[], split?: Map<string, CompanySplit>) {
  // 하루 한도 배분: 회사 부담으로 정해진 줄의 초과분은 공제 확정, 요청 중인 줄의 초과분은 예상 공제
  // (사용자가 비어 있는 줄은 본인("me")으로 — 복사는 그 줄만)
  const sp = split ?? (passItems
    ? companySplit(lines.filter((l): l is typeof l & { id: string } => !!l.id).map((l) => (l.userId ? (l as SplitLine) : { ...l, userId: "me" })), passItems)
    : EMPTY_SPLIT);
  let total = 0, checked = 0, deducted = 0, likely = 0, overtime = 0;
  for (const l of lines) {
    total += l.amount;
    const over = l.id ? sp.get(l.id)?.personal ?? 0 : 0;
    if (l.memberClaim === "OVERTIME") checked += l.amount;
    if (l.decision === "DEDUCT") deducted += l.amount;
    else if (l.decision === "OVERTIME") { overtime += l.amount - over; deducted += over; }
    else if (l.memberClaim !== "OVERTIME") likely += l.amount;
    else likely += over;
  }
  return { total, checked, expected: deducted + likely, deducted, likely, overtime };
}

// ───────────────────────── 권한

export type PassActor = { id: string; role: Role; readOnly?: boolean; readOnlyReason?: "view" | "closed" | "admin" };

/** 내역 올리기·결정·확정 (이 프로젝트 PM만 — 급여 공제가 걸린 일이라 처리는 PM으로 통일. 재무 승인 담당은 조회·확정 취소, 시스템 관리자는 조회) */
export const canManagePass = (a: PassActor) => !a.readOnly && a.role === "MANAGER";
/** 확정 취소 (이 프로젝트 PM·재무 승인 — 재무 승인 담당은 상신 검토 중 오류를 발견하면 되돌려 PM이 고치게 한다) */
export const canReopenPass = (a: PassActor) => !a.readOnly && (a.role === "MANAGER" || a.role === "HQ");

// ───────────────────────── 월 마감 잠금
// 출입증 회사 부담 확정분은 그 달 정산(본사 집행)에 들어가므로, 지출과 같은 기준으로 마감(CLOSED 이상)된 달은 출입증 정산도 바꿀 수 없다.
// 작성중·반려 달만 수정 가능 — 반려되면 확정 취소 → 수정 → 다시 확정 → 재마감 → 상신 → 승인.

/** 마감 상태 때문에 출입증 정산(결정·요청·확정·확정 취소·올리기·삭제)을 바꿀 수 없으면 그 문구, 작성중·반려면 null */
export function passLockedProblem(closingStatus: string | null | undefined): string | null {
  // 상신(SUBMITTED)부터 잠근다 — 마감(CLOSED)은 상신 전이라 수정 허용 (2026-10-14 사용자 결정). 바꾼 내용은 상신 엑셀·정산에 그대로 반영된다
  if (closingStatus !== "SUBMITTED" && closingStatus !== "APPROVED") return null;
  const label = closingStatus === "APPROVED" ? "승인된" : "상신된";
  return `${label} 달의 출입증 정산은 변경할 수 없습니다. ${unlockHint(closingStatus)}`;
}

/**
 * 출입증 화면 상단 안내 (마감 상태별). 잠긴 달은 이유와 푸는 방법, 반려된 달은 다시 승인까지 가는 길.
 * statementStatus: 내역 상태 — 반려 달에 이미 확정된 내역이면 '확정 취소'부터
 */
export function passClosingNotice(closingStatus: string | null | undefined, statementStatus?: "OPEN" | "CONFIRMED"): { tone: "locked" | "rejected" | "closed"; text: string } | null {
  if (closingStatus === "APPROVED") return { tone: "locked", text: "이 달은 승인되어 출입증 정산을 수정할 수 없어요. 수정하려면 재무 승인 담당이 승인을 취소해야 해요." };
  if (closingStatus === "SUBMITTED") return { tone: "locked", text: "이 달은 상신되어 출입증 정산을 수정할 수 없어요. 수정하려면 재무 승인 담당이 반려해야 해요." };
  // 마감은 상신 전이라 수정할 수 있다 — 바꾸면 마감 정산·상신 엑셀의 회사 부담분이 달라지니 알려 준다
  if (closingStatus === "CLOSED") return { tone: "closed", text: "이 달은 마감됐어요. 출입증을 바꾸면 마감 정산의 회사 부담분도 바뀌니 상신 전에 다시 확인하세요." };
  if (closingStatus === "REJECTED") {
    return { tone: "rejected", text: statementStatus === "CONFIRMED" ? "반려된 달이에요 — 확정 취소 후 수정하고 다시 확정한 뒤 마감 › 상신하세요." : "반려된 달이에요 — 수정 후 다시 확정하고 마감 › 상신하세요." };
  }
  return null;
}
/**
 * 전체 줄 조회: 이 프로젝트 PM·재무 승인·시스템 관리자 (종료된 프로젝트 포함).
 * 팀원·상위 PM/조직장 조회(view)는 본인 줄만 — 다른 사람 이름·금액은 서버에서 걸러 낸다.
 */
export const canSeeAllPass = (a: PassActor) =>
  a.role === "HQ" || a.role === "ADMIN" || (a.role === "MANAGER" && a.readOnlyReason !== "view");
/** 외부인 사용 → 내 사용분 처리: 이 프로젝트 PM만 (PM 급여에서 공제되므로) */
export const canAssumeExternal = (a: PassActor) => !a.readOnly && a.role === "MANAGER";
/** 결정 출처 표기 — 지금은 PM만 결정하지만 옛 재무 승인·시스템 관리자 결정 기록은 그대로 표시 */
export const decisionSourceOf = (a: PassActor): PassDecisionSource => (a.role === "MANAGER" ? "PM" : a.role === "ADMIN" ? "ADMIN" : "HQ");

// ───────────────────────── 처리 선택 값 (화면 select)
// "" 본인 부담(급여 공제, 기본) · "D" 본인 부담(일괄 처리 선택지) · "O:<항목 id>" 회사 부담

const CHOICE_PREFIX = "O:";
/** 회사 부담 선택 값 */
export const companyChoice = (usageItemId: string | null | undefined) => `${CHOICE_PREFIX}${usageItemId ?? ""}`;
/** 회사 부담 선택인지 */
export const isCompanyChoice = (v: string) => v.startsWith(CHOICE_PREFIX);
/** 선택 값 → 회사 부담 항목 id (회사 부담이 아니면 undefined, 항목 미지정이면 null) */
export const choiceItemId = (v: string): string | null | undefined => (isCompanyChoice(v) ? v.slice(CHOICE_PREFIX.length) || null : undefined);
/** PM 결정 → 선택 값 */
export const choiceOf = (l: { decision: string | null; usageItemId: string | null }) => (l.decision === "OVERTIME" ? companyChoice(l.usageItemId) : "");
/** 팀원 요청 → 선택 값 */
export const claimChoiceOf = (l: { memberClaim: string | null; usageItemId: string | null }) => (l.memberClaim === "OVERTIME" ? companyChoice(l.usageItemId) : "");
/** 선택 값 → PM 결정 */
export const choiceToDecision = (v: string): { decision: "DEDUCT" | "OVERTIME"; usageItemId?: string | null } =>
  isCompanyChoice(v) ? { decision: "OVERTIME", usageItemId: choiceItemId(v) ?? null } : { decision: "DEDUCT" };
/** 선택 값 → 팀원 요청 */
export const choiceToClaim = (v: string): { memberClaim: "OVERTIME" | null; usageItemId?: string | null } =>
  isCompanyChoice(v) ? { memberClaim: "OVERTIME", usageItemId: choiceItemId(v) ?? null } : { memberClaim: null };

// ───────────────────────── 팀원 내역 목록 (한 목록: 확인할 줄·요청 중·PM이 정한 줄을 날짜순 그대로)

export type MemberListState = {
  /** PM 확정 */ confirmed: boolean;
  /** 월 마감(상신·승인)으로 잠김 */ closingStatus?: ClosingStatus | null; monthLocked: boolean;
  /** 회사 부담 항목이 없는 프로젝트 */ noItems: boolean;
  /** 아직 표시를 바꿀 수 있는 줄 수 */ toCheck: number;
  /** PM이 아직 정하지 않은(외부인 제외) 줄 수 */ undecided: number;
  /** 업무 사용으로 표시해 PM 확인 중인 줄 수 */ pending?: number;
};
/**
 * 목록 위 안내 문구 — 상태에 따라 하나. 이 문구가 목록의 유일한 설명이라 "표시 없음 = 본인 부담(급여 공제)" 규칙을 상태마다 한 번씩 담는다 (따로 범례 줄을 두지 않는다).
 * 팀원이 하는 일은 업무 사용 표시 하나뿐: 표시 없음 = 본인 부담(기본값)이라 줄마다 글자를 쓰지 않고, 회사 부담으로 정해진 건만 배지로 보인다.
 */
export function memberListNotice(s: MemberListState): string {
  if (s.confirmed) {
    // 확정 뒤 그 달이 상신·승인되면 PM도 확정 취소를 못 한다 (재무 승인 반려 후에만) — monthLocked는 확정 전 기준이라 마감 상태를 직접 본다
    if (s.closingStatus === "SUBMITTED") return "이 달은 상신되어 PM도 바꿀 수 없어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 고칠 게 있으면 PM에게 알려 주세요.";
    if (s.closingStatus === "APPROVED") return "이 달은 승인되어 바꿀 수 없어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 고칠 게 있으면 PM에게 알려 주세요.";
    return "이 달은 확정되어 바꿀 수 없어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 고칠 게 있으면 PM에게 확정 취소를 요청하세요.";
  }
  // 잠그는 것은 상신·승인뿐 (passLockedProblem) — 마감(CLOSED)은 수정할 수 있다
  if (s.monthLocked) return `이 달은 ${s.closingStatus === "APPROVED" ? "승인" : "상신"}되어 바꿀 수 없어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 고칠 게 있으면 PM에게 알려 주세요.`;
  if (s.noItems) return "회사 부담 항목이 정해져 있지 않아 모두 본인 부담(급여 공제)이에요. 업무로 쓴 건이 있으면 PM에게 알려 주세요.";
  if (s.toCheck > 0) return "업무로 쓴 건은 ○를 눌러 ‘업무 사용’을 표시하세요. 표시하지 않은 건은 본인 부담(급여 공제)이에요.";
  if (s.undecided === 0) return "PM이 모두 정했어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 바꾸려면 PM에게 요청하세요.";
  if (s.pending) return "표시한 건은 PM이 확인 중이에요. 바꾸려면 ○를 다시 누르세요. 표시가 없는 건은 본인 부담(급여 공제)이에요.";
  return "PM이 정한 건은 바꿀 수 없어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 바꾸려면 PM에게 요청하세요.";
}
/** 목록 제목 */
export const memberListTitle = (s: Pick<MemberListState, "confirmed">) => (s.confirmed ? "확정된 내역" : "사용 내역");

// ───────────────────────── 팀원 표시 되돌리기 (실수로 누른 경우 — 토스트의 "되돌리기")

/** 바꾸기 전 줄의 팀원 표시 상태 (되돌리기용 스냅샷) */
export type ClaimSnapshot = { memberClaim: string | null; usageItemId: string | null; memberNote: string | null };
export const claimSnapshot = (l: ClaimSnapshot): ClaimSnapshot => ({ memberClaim: l.memberClaim, usageItemId: l.usageItemId, memberNote: l.memberNote });
/** 팀원이 보내는 표시 변경 본문 (업무 사용 표시·해제) */
export type ClaimPatch = { memberClaim: PassClaim | null; usageItemId?: string | null };
/**
 * 스냅샷으로 되돌리는 PATCH 본문 (같은 /api/pass-statement-lines/:id 경로).
 * 업무 사용이었으면 항목까지, 아니었으면 해제(서버가 항목을 비움 — 옛 PERSONAL도 해제로). 사유는 비어 있던 것도 "" 로 보내 지운다.
 */
export const claimRestorePatch = (prev: ClaimSnapshot): ClaimPatch & { memberNote: string } =>
  prev.memberClaim === "OVERTIME"
    ? { memberClaim: "OVERTIME", usageItemId: prev.usageItemId ?? null, memberNote: prev.memberNote ?? "" }
    : { memberClaim: null, memberNote: prev.memberNote ?? "" };
/**
 * 표시를 바꾼 뒤 토스트 문구.
 * next: 바뀐 표시 — "OVERTIME"(업무 사용) · null(해제). true/false는 업무 사용 표시·해제와 같다.
 */
export const claimToggleText = (name: string, next: PassClaim | null | boolean): string =>
  next === true || next === "OVERTIME" ? `'${name}' 업무 사용으로 표시했어요` : `'${name}' 업무 사용 표시를 해제했어요`;

export type LinePatch = {
  memberClaim?: unknown; memberNote?: unknown; decision?: unknown; userId?: unknown;
  /** 회사 부담 항목 — memberClaim과 함께면 팀원 요청, 아니면 PM 결정 */
  usageItemId?: unknown;
  /** true: 외부인 사용 → 내(PM) 사용분, false: 되돌림 */
  external?: unknown;
  collectFrom?: unknown; collected?: unknown; collectNote?: unknown;
};

const COLLECT_KEYS = ["collectFrom", "collected", "collectNote"] as const;

/** 줄 수정 권한 → 문제 메시지 (없으면 null) */
export function linePatchProblem(
  actor: PassActor,
  line: { userId: string | null; onBehalfName?: string | null },
  status: string,
  patch: LinePatch,
): string | null {
  if (actor.readOnly) return "조회 권한으로는 변경할 수 없습니다.";
  const memberPart = patch.memberClaim !== undefined || patch.memberNote !== undefined;
  const pmPart = patch.decision !== undefined || patch.userId !== undefined || patch.external !== undefined || (patch.usageItemId !== undefined && !memberPart);
  const collectPart = COLLECT_KEYS.some((k) => patch[k] !== undefined);
  if (!memberPart && !pmPart && !collectPart) return "변경할 내용이 없습니다.";
  // 수금 기록은 확정 후에도 가능 (청구 금액에 영향 없음)
  if ((memberPart || pmPart) && status !== "OPEN") return "확정된 내역입니다. 바꾸려면 PM이 확정을 취소해야 합니다.";
  if (memberPart && (line.userId !== actor.id || line.onBehalfName)) return "본인 사용 내역만 표시할 수 있습니다.";
  if (pmPart && !canManagePass(actor)) return "회사 부담·본인 부담 결정은 이 프로젝트 PM만 합니다.";
  if (patch.external !== undefined && !canAssumeExternal(actor)) return "외부인 사용분은 이 프로젝트 PM만 본인 사용분으로 처리할 수 있습니다.";
  if (patch.external === false && !line.onBehalfName) return "외부인 사용으로 처리된 내역이 아닙니다.";
  if (patch.external !== undefined && patch.userId !== undefined) return "팀원 지정과 외부인 처리는 따로 하세요.";
  if (patch.userId !== undefined && line.onBehalfName) return "외부인 사용으로 처리된 내역입니다. 먼저 외부인 처리를 되돌리세요.";
  if (collectPart) {
    if (!canManagePass(actor)) return "수금 기록은 PM이 합니다.";
    if (!line.onBehalfName && patch.external !== true) return "외부인 사용으로 처리된 내역만 수금 기록을 남길 수 있습니다.";
  }
  if (patch.memberClaim !== undefined && patch.memberClaim !== null && !isClaim(patch.memberClaim)) return "표시 값이 올바르지 않습니다.";
  if (patch.decision !== undefined && patch.decision !== null && !isDecision(patch.decision)) return "결정 값이 올바르지 않습니다.";
  for (const k of ["memberNote", "collectNote", "collectFrom"] as const) {
    const v = patch[k];
    if (v !== undefined && v !== null && (typeof v !== "string" || v.length > 200)) return "사유·비고는 200자 이내로 입력하세요.";
  }
  if (patch.collected !== undefined && typeof patch.collected !== "boolean") return "받음 여부 값이 올바르지 않습니다.";
  if (patch.usageItemId !== undefined && patch.usageItemId !== null && typeof patch.usageItemId !== "string") return "항목 값이 올바르지 않습니다.";
  return null;
}

// ───────────────────────── 항목 하루 한도

export type PassItem = { id: string; name: string; perPersonLimit: number | null };

export type SplitLine = { id: string; userId?: string | null; date?: string | Date | null; amount: number; decision: string | null; memberClaim?: string | null; usageItemId?: string | null; time?: string | null };
/** 한 줄의 하루 한도 배분: company(회사 부담분)·personal(본인 부담분) + 그 날 합계(used)·한도(limit)·항목 이름 */
export type CompanySplit = { company: number; personal: number; limit: number; used: number; itemName: string };

const dayKey = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * 하루 한도 배분 — 정합성의 기준 함수. 회사 부담(결정 또는 팀원 요청) 줄을 같은 사람·같은 날·같은 항목으로 묶어
 * (식당·카페처럼 사용처가 달라도 항목 기준) 합이 1인 한도를 넘으면 한도까지만 회사 부담, 나머지는 본인 부담.
 * 한도는 결정된 줄부터, 그다음 시간·id 순으로 채운다 (요청 중인 줄이 먼저 한도를 차지하지 않게).
 * 반환: 한도가 있는 항목의 회사 부담 줄마다 CompanySplit. 한도 없는 항목·회사 부담이 아닌 줄·사용자나 날짜가 없는 줄은 없다.
 * 집계(summarizeStatement)·급여 공제(deductionList)·팀원 예상(memberExpectation)·예산 집행(passBudgetSpend)·엑셀이 모두 이 함수를 쓴다.
 */
export function companySplit(lines: SplitLine[], items: PassItem[]): Map<string, CompanySplit> {
  const limitOf = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<string, { lines: SplitLine[]; item: PassItem }>();
  for (const l of lines) {
    const company = l.decision === "OVERTIME" || (!l.decision && l.memberClaim === "OVERTIME");
    const item = l.usageItemId ? limitOf.get(l.usageItemId) : undefined;
    if (!company || !item?.perPersonLimit || !l.userId || !l.date) continue;
    const k = `${l.userId}|${dayKey(l.date)}|${item.id}`;
    const g = groups.get(k) ?? { lines: [], item };
    g.lines.push(l);
    groups.set(k, g);
  }
  const out = new Map<string, CompanySplit>();
  for (const g of groups.values()) {
    const limit = g.item.perPersonLimit!;
    let used = 0;
    for (const l of g.lines) used += l.amount;
    // 한 줄뿐인 날은 정렬할 것이 없다
    const ordered = g.lines.length === 1 ? g.lines : [...g.lines].sort((a, b) =>
      (a.decision === "OVERTIME" ? 0 : 1) - (b.decision === "OVERTIME" ? 0 : 1) || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id));
    let left = limit;
    for (const l of ordered) {
      const company = Math.max(0, Math.min(l.amount, left));
      left -= company;
      out.set(l.id, { company, personal: l.amount - company, limit, used, itemName: g.item.name });
    }
  }
  return out;
}

/** 한도를 넘은 날의 줄만 (경고 표시용): { limit, used, itemName, company: 한도까지 회사 부담, personal: 초과분 } */
export function dayLimitOver(lines: SplitLine[], items: PassItem[], split: Map<string, CompanySplit> = companySplit(lines, items)): Map<string, CompanySplit & { company: number; personal: number }> {
  const out = new Map<string, CompanySplit>();
  for (const [id, s] of split) {
    if (s.used > s.limit) out.set(id, { ...s, company: s.limit, personal: s.used - s.limit });
  }
  return out;
}

/**
 * 경고 문구: "⚠ 야근식대 1일 한도 12,000원 초과 · 회사 부담 12,000원 · 초과 5,000원"
 * 출입증 화면은 줄 단위로 '본인 부담' 글자를 쓰지 않는다 — 줄의 분할 표기("회사 부담 3,000 · 초과 5,000")와 같은 말(초과)로.
 */
export const dayLimitMessage = (w: { itemName: string; limit: number; used: number }) =>
  `⚠ ${w.itemName} 1일 한도 ${won(w.limit)}원 초과 · 회사 부담 ${won(w.limit)}원 · 초과 ${won(w.used - w.limit)}원`;

// ───────────────────────── 브라우저에서 읽은 시트 전송 (서버 CPU 절약 — 엑셀 해석은 브라우저에서)

type WireCell = string | number | null | { d: string };
type WireSheet = { name: string; table: WireCell[][]; formulas?: string[] };

/** 시트 목록 → 전송용 JSON (날짜는 {d: ISO}) */
export function sheetsToWire(sheets: Sheet[]): string {
  const cell = (c: Cell): WireCell => (c instanceof Date ? { d: c.toISOString() } : c);
  return JSON.stringify(sheets.map((s): WireSheet => ({ name: s.name, table: s.table.map((r) => r.map(cell)), ...(s.formulas?.size ? { formulas: [...s.formulas] } : {}) })));
}

/** 전송용 JSON → 시트 목록 (형식이 틀리거나 너무 크면 null) */
export function sheetsFromWire(json: string, limits: { rows: number; cols: number; sheets: number }): Sheet[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > limits.sheets) return null;
  const out: Sheet[] = [];
  for (const s of raw as WireSheet[]) {
    if (!s || typeof s.name !== "string" || s.name.length > 100 || !Array.isArray(s.table) || s.table.length > limits.rows) return null;
    const table: Table = [];
    for (const r of s.table) {
      if (!Array.isArray(r) || r.length > limits.cols) return null;
      const row: Cell[] = [];
      for (const c of r) {
        if (c === null || typeof c === "string" || typeof c === "number") row.push(typeof c === "string" ? c.slice(0, 1000) : c);
        else if (c && typeof c === "object" && typeof (c as { d?: unknown }).d === "string") {
          const d = new Date((c as { d: string }).d);
          if (Number.isNaN(d.getTime())) return null;
          row.push(d);
        } else return null;
      }
      table.push(row);
    }
    const formulas = Array.isArray(s.formulas) ? new Set(s.formulas.filter((f) => typeof f === "string" && /^\d+:\d+$/.test(f))) : undefined;
    out.push({ name: s.name, table, ...(formulas?.size ? { formulas } : {}) });
  }
  return out;
}

/** 내역 파일 이름("업체: 파일 + 업체: 파일")에서 남은 업체의 파일만 남긴다 (업체 표시가 없는 옛 이름은 그대로) */
export function fileNameAfterDelete(fileName: string, remainingVendors: string[]): string {
  const keep = fileName.split(" + ").filter((p) => {
    const m = p.match(/^(.+?): /);
    return !m || remainingVendors.includes(m[1]);
  });
  return keep.join(" + ") || fileName;
}
