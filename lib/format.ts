// 날짜·월·금액 포맷 유틸. 날짜는 해당 일자의 UTC 자정으로 저장한다.
// "오늘"·"이번 달"은 서버·브라우저 시간대와 상관없이 한국 시간(Asia/Seoul) 기준.

/** 두 자리 0 채움: 3 → "03" */
export const pad2 = (n: number) => String(n).padStart(2, "0");

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYearMonth(v: unknown): v is string {
  return typeof v === "string" && YM_RE.test(v);
}

export function parseDateOnly(v: unknown): Date | null {
  if (typeof v !== "string" || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || formatDate(d) !== v ? null : d;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toYearMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

/** 프로젝트 기간의 yearMonth 목록 (시작월~종료월) */
export function projectMonths(start: Date, end: Date): string[] {
  const out: string[] = [];
  const last = toYearMonth(end);
  for (let ym = toYearMonth(start); ym <= last && out.length < 120; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

/** "2026-02" → "26.2월" (엑셀 월 시트명) */
export function sheetName(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y.slice(2)}.${Number(m)}월`;
}

/**
 * 엑셀 월 시트명 (기존 상신 양식): 프로젝트 시작 연도의 월은 "12월",
 * 이후 연도의 월은 "26.1월"처럼 연도 두 자리를 붙인다.
 */
export function excelSheetName(ym: string, firstYm: string): string {
  const [y, m] = ym.split("-");
  return y === firstYm.slice(0, 4) ? `${Number(m)}월` : `${y.slice(2)}.${Number(m)}월`;
}

/** "2026-02" → "2026년 2월" */
export function ymLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

const WON_FMT = new Intl.NumberFormat("ko-KR"); // 호출마다 Intl 객체를 만들지 않게 재사용
export function won(n: number): string {
  return WON_FMT.format(n);
}

/** 로컬 시간대 기준 "YYYY-MM-DD" */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const SEOUL = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

/** 한국 시간 기준 날짜 "YYYY-MM-DD" */
export function seoulToday(now: Date = new Date()): string {
  const part = (t: string) => SEOUL.formatToParts(now).find((p) => p.type === t)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 한국 시간 기준 월 "YYYY-MM" */
export const seoulYm = (now: Date = new Date()) => seoulToday(now).slice(0, 7);

/** 한국 시간 기준 오늘의 UTC 자정 Date (저장 일자와 같은 기준) */
export const seoulTodayDate = (now: Date = new Date()) => new Date(`${seoulToday(now)}T00:00:00.000Z`);

/** 이번 달 (한국 시간) */
export const currentYearMonth = (now: Date = new Date()) => seoulYm(now);

/** 오늘 "YYYY-MM-DD" (한국 시간, 날짜 입력 기본값) */
export const todayString = (now: Date = new Date()) => seoulToday(now);

// ── 숫자 입력 ──

/** 숫자만 남김 (최대 max자리) */
export const digitsOnly = (s: string, max = 15) => s.replace(/[^\d]/g, "").slice(0, max);

/** 금액 입력란 → 원 (숫자 외 문자 무시, 비면 0) */
export const parseWonInput = (s: string, max = 10) => Number(digitsOnly(s, max)) || 0;

/** 정수 입력 (쉼표 허용): 비면 null, 정수가 아니면 NaN */
export function parseIntInput(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isInteger(n) ? n : NaN;
}

/** 프로젝트 기간 표시: "2025.12.01 ~ 2026.11.30" */
export function formatPeriod(start: Date | string, end: Date | string): string {
  const dot = (d: Date | string) => (typeof d === "string" ? d : formatDate(d)).replace(/-/g, ".");
  return `${dot(start)} ~ ${dot(end)}`;
}

/** 금액 칸(BigInt) 상한 — 1조원. number로 정확히 다룰 수 있는 범위(약 9천조) 안에서 입력 실수만 막는다 */
export const MONEY_MAX = 1_000_000_000_000;

// ── 화면 표기 (docs/DESIGN.md "숫자·날짜 표기") ──
// 엑셀 시트명(sheetName·excelSheetName)과는 별개. 화면에는 아래 함수만 쓴다.

const WEEKDAY_KO = "일월화수목금토";

/** "YYYY-MM-DD" 또는 Date(UTC 자정) → [월, 일, 요일] */
function ymdParts(v: string | Date): [number, number, string] {
  const d = typeof v === "string" ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : v;
  return [d.getUTCMonth() + 1, d.getUTCDate(), WEEKDAY_KO[d.getUTCDay()]];
}

/** 날짜 제목·상세: "2026-10-06" → "10월 6일 (화)" */
export function dayLabel(v: string | Date): string {
  const [m, d, w] = ymdParts(v);
  return `${m}월 ${d}일 (${w})`;
}

/** 목록·표의 짧은 날짜: "2026-10-06" → "10.06 (화)" */
export function shortDate(v: string | Date): string {
  const [m, d, w] = ymdParts(v);
  return `${pad2(m)}.${pad2(d)} (${w})`;
}

/** 월 표기: "2026-10" → "2026년 10월" (화면 공통. "26.10월"은 엑셀 시트명 전용) */
export const ymKo = (ym: string): string => ymLabel(ym);

/** 월만: "2026-10" → "10월" (알림·할 일 제목처럼 연도 없이 짧게) */
export const monthKo = (ym: string): string => `${Number(ym.slice(5, 7))}월`;

/** 금액 표기, 0은 "-" (표에서 빈 값과 0을 구분해 읽기 쉽게) */
export function dash0(n: number): string {
  return n === 0 ? "-" : won(n);
}

/** 점 날짜(입사일·기준일 등 연도가 필요한 단독 날짜): "2026-10-06" → "2026.10.06" */
export function dotDate(v: string | Date): string {
  return (typeof v === "string" ? v.slice(0, 10) : formatDate(v)).replace(/-/g, ".");
}

/** Date·ISO 문자열 → 한국 시간 ISO 문자열 (kstDateTime·shortDateTime 공용) */
function kstIso(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  return new Date(d.getTime() + 9 * 3600_000).toISOString();
}

/** 일시(한국 시간, 연도 포함): "2026.10.06 14:30" — 단독 칸(동기화·마지막 접속·유효기간)처럼 연도가 필요한 곳 */
export function kstDateTime(v: string | Date): string {
  const k = kstIso(v);
  return `${k.slice(0, 10).replace(/-/g, ".")} ${k.slice(11, 16)}`;
}

/** 일시(한국 시간, 연도 없이): "10.06 14:30" — 목록·표·단계 한 줄처럼 좁은 칸 (날짜만이면 shortDate·dotDate) */
export function shortDateTime(v: string | Date): string {
  const k = kstIso(v);
  return `${k.slice(5, 10).replace("-", ".")} ${k.slice(11, 16)}`;
}

/** 월 짧게(연도 두 자리): "2026-08" → "26년 8월" — 표 칸·배지처럼 좁은데 연도는 있어야 할 때 (연도 없이는 monthKo, 보통은 ymKo) */
export function ymShort(ym: string): string {
  return `${ym.slice(2, 4)}년 ${Number(ym.slice(5, 7))}월`;
}

/**
 * 여러 달을 짧게: 이어진 달은 범위로 — ["2026-01".."2026-09"] → "1~9월", ["2026-01","2026-03"] → "1월·3월".
 * 해가 섞이면 연도를 붙인다 ("25년 12월~26년 2월")
 */
export function monthsLabel(yms: string[]): string {
  const list = [...new Set(yms)].sort();
  if (!list.length) return "";
  const oneYear = list.every((m) => m.slice(0, 4) === list[0].slice(0, 4));
  const label = (ym: string) => (oneYear ? `${Number(ym.slice(5))}` : `${ym.slice(2, 4)}년 ${Number(ym.slice(5))}`);
  const runs: [string, string][] = [];
  for (const m of list) {
    const last = runs[runs.length - 1];
    if (last && addMonths(last[1], 1) === m) last[1] = m;
    else runs.push([m, m]);
  }
  return runs.map(([a, b]) => (a === b ? `${label(a)}월` : oneYear ? `${label(a)}~${label(b)}월` : `${label(a)}월~${label(b)}월`)).join("·");
}
