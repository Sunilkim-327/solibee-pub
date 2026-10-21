// 출입증 회사 부담 → 예산 집행 (순수함수 — tests/pass-budget.test.ts)
// '예산은 하나, 쓰는 방법은 둘': 출입증 회사 부담 항목(업체 출입증 분류)에 연결 예산 항목(linkedItemId)이 있으면
// 그 회사 부담 금액은 연결 예산 항목의 집행에 더한다 (카드 + 출입증).
// - 집행: 월 확정(CONFIRMED)된 내역의 회사 부담(decision = OVERTIME) 줄만. 집계 월 = 내역의 yearMonth
// - 확정 전: 확정 전 내역의 회사 부담(결정됨 + 팀원 요청) — 집행에 넣지 않고 따로 보여 준다
// - 연결 안 된 출입증 항목은 예산에 들어가지 않는다
import { companySplit } from "./pass-statement";

/** 회사 부담 줄 (회사 부담으로 결정됐거나, 미결정인데 팀원이 회사 부담을 요청한 줄) — lib/sql-loaders sqlPassCompanyLines */
export type PassCompanyLine = {
  id: string;
  projectId: string;
  /** 내역 월 (집계 키) */
  yearMonth: string;
  /** 내역이 월 확정됨 */
  confirmed: boolean;
  userId: string | null;
  /** 사용일 YYYY-MM-DD (날짜 열이 없는 업체 양식이면 null) */
  date: string | null;
  amount: number;
  decision: string | null;
  memberClaim: string | null;
  /** 업체 이름 (올릴 때 쓴 업체 서식) — 상신 엑셀 세부내역 "항목/업체" */
  vendor?: string | null;
  /** 매칭된 팀원 이름·직급 — 상신 엑셀 참석자(사용한 사람) */
  userName?: string | null;
  userPosition?: string | null;
  /** 외부인 사용 → PM 사용분 처리 (실제 사용한 사람) */
  onBehalfName: string | null;
  /** 회사 부담 항목 (출입증 분류) */
  usageItemId: string;
  usageItemName: string;
  /** 회사 부담 항목의 1인 하루 한도 (없으면 null·생략) — 같은 사람·날·항목 합이 넘으면 한도까지만 회사 부담 (companySplit) */
  limit?: number | null;
  /** 연결 예산 항목 (없거나 지워졌으면 null) */
  linkedItemId: string | null;
  linkedItemName: string | null;
  /** 연결 예산 항목의 분류 이름 (상신 엑셀) */
  linkedCategoryName: string | null;
  /** 사용처 구분 (구분 → 시트 이름) · 사용처 · 판매시간 */
  placeType: string | null;
  place: string | null;
  time: string | null;
};

/** 회사 부담 줄: PM이 회사 부담으로 정했거나, 아직 정하지 않았고 팀원이 회사 부담을 요청 */
export const isCompanyLine = (l: { decision: string | null; memberClaim: string | null }) =>
  l.decision === "OVERTIME" || (!l.decision && l.memberClaim === "OVERTIME");

/** 집행에 들어가는 줄: 확정된 내역의 회사 부담 결정 + 연결 예산 항목 있음 */
export const isBudgetSpend = (l: Pick<PassCompanyLine, "confirmed" | "decision" | "linkedItemId">): l is typeof l & { linkedItemId: string } =>
  l.confirmed && l.decision === "OVERTIME" && !!l.linkedItemId;

/** 예산 집계 행 (프로젝트·항목·월) — 지출 합계 행(sqlExpenseMonthSums)과 같은 모양 + 건수 */
export type SpendRow = { projectId: string; itemId: string; yearMonth: string; amount: number };
export type PassSpendRow = SpendRow & { count: number };

/** 출입증 항목별 회사 부담 (예산 화면의 출입증 회사 부담 항목 칸): 확정 합계·월별, 확정 전 합계 */
export type PassItemCompany = { confirmed: number; pending: number; months: Record<string, number> };

/**
 * 출입증 회사 부담 → 예산 집행
 * - confirmedRows: 연결 예산 항목(itemId)·내역 월별 확정 합계 (집행에 더함)
 * - pendingByItem: 연결 예산 항목별 확정 전 회사 부담 (결정됨 + 팀원 요청)
 * - byPassItem: 출입증 항목별 확정·확정 전 (연결 여부와 무관)
 */
/** 줄마다 회사 부담분 — 항목 한도(limit)가 있으면 하루 한도 배분(companySplit), 없으면 전액 */
export function companyAmounts(lines: PassCompanyLine[]): Map<string, number> {
  const items = [...new Map(lines.filter((l) => l.limit).map((l) => [l.usageItemId, { id: l.usageItemId, name: l.usageItemName, perPersonLimit: l.limit ?? null }])).values()];
  const split = items.length ? companySplit(lines, items) : new Map<string, { company: number }>();
  return new Map(lines.map((l) => [l.id, split.get(l.id)?.company ?? l.amount]));
}

export function passBudgetSpend(lines: PassCompanyLine[]) {
  const rows = new Map<string, PassSpendRow>();
  const pendingByItem: Record<string, number> = {};
  const byPassItem: Record<string, PassItemCompany> = {};
  const companyOf = companyAmounts(lines);
  for (const l of lines) {
    if (!isCompanyLine(l)) continue;
    const amount = companyOf.get(l.id) ?? l.amount;
    const c = (byPassItem[l.usageItemId] ??= { confirmed: 0, pending: 0, months: {} });
    if (l.confirmed) {
      // 확정된 내역은 모든 줄이 결정돼 있다 — 회사 부담 결정만
      if (l.decision !== "OVERTIME") continue;
      c.confirmed += amount;
      c.months[l.yearMonth] = (c.months[l.yearMonth] ?? 0) + amount;
    } else {
      c.pending += amount;
      if (l.linkedItemId) pendingByItem[l.linkedItemId] = (pendingByItem[l.linkedItemId] ?? 0) + amount;
    }
    if (!isBudgetSpend(l)) continue;
    const k = `${l.projectId}|${l.linkedItemId}|${l.yearMonth}`;
    const r = rows.get(k) ?? { projectId: l.projectId, itemId: l.linkedItemId, yearMonth: l.yearMonth, amount: 0, count: 0 };
    r.amount += amount;
    r.count++;
    rows.set(k, r);
  }
  return { confirmedRows: [...rows.values()], pendingByItem, byPassItem };
}

/** 예산 집행 합계 = 카드 지출 합계 + 출입증 확정분 (같은 프로젝트·항목·월은 한 행으로) */
export function mergeSpendRows(card: SpendRow[], pass: SpendRow[]): SpendRow[] {
  if (!pass.length) return card;
  const out = new Map<string, SpendRow>();
  for (const r of [...card, ...pass]) {
    const k = `${r.projectId}|${r.itemId}|${r.yearMonth}`;
    const cur = out.get(k);
    if (cur) cur.amount += r.amount;
    else out.set(k, { projectId: r.projectId, itemId: r.itemId, yearMonth: r.yearMonth, amount: r.amount });
  }
  return [...out.values()];
}

/** 항목별 합계 (월 무관) */
export function sumByItem(rows: Pick<SpendRow, "itemId" | "amount">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.itemId] = (out[r.itemId] ?? 0) + r.amount;
  return out;
}

/**
 * 상신 엑셀 본사 집행내역의 출입증 한 줄 (연결 예산 항목별·한 달)
 * — 사용 건마다 한 줄: 결제자 본사 · 날짜 = 사용일 · 금액 · 결제방법 본사지출 · 분류/항목 = 연결 예산 항목 · 세부내역 "항목/업체" · 대상인원 1 · 참석자 = 그 사람
 * date: 사용일 YYYY-MM-DD (날짜 열이 없는 양식이면 null → 그 달 말일) · vendors: 업체 이름 · users: 사용자 한 명 (외부인은 업체 파일의 이름, 모르면 빈 배열)
 */
export type PassExcelRow = {
  itemId: string; itemName: string; categoryName: string; amount: number; count: number; date: string | null;
  vendors: string[]; users: { name: string; position: string | null }[];
};

/**
 * 그 달(내역 월) 확정분 → 연결 예산 항목별 한 줄 — 분류 이름 → 항목 이름 순 (전체 통합문서·한 달 시트가 같은 순서)
 */
export function passExcelRows(lines: PassCompanyLine[], yearMonth: string): PassExcelRow[] {
  // 사용 건마다 한 줄 — 사용일·금액이 그대로 보이게 (합치지 않는다). 분류 → 항목 → 사람(직급 → 성명) → 사용일 순
  const rows: PassExcelRow[] = [];
  const companyOf = companyAmounts(lines);
  for (const l of lines) {
    if (l.yearMonth !== yearMonth || !isBudgetSpend(l)) continue;
    const amount = companyOf.get(l.id) ?? l.amount;
    if (amount <= 0) continue; // 한도 배분으로 회사 부담분이 0인 줄 (전액 본인 부담)
    const name = l.userName ?? l.onBehalfName ?? null;
    rows.push({
      itemId: l.linkedItemId, itemName: l.linkedItemName ?? "", categoryName: l.linkedCategoryName ?? "", amount, count: 1, date: l.date,
      vendors: l.vendor ? [l.vendor] : [], users: name ? [{ name, position: l.userPosition ?? null }] : [],
    });
  }
  const person = (r: PassExcelRow) => r.users[0] ?? { name: "", position: null };
  return rows.sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName, "ko") || a.itemName.localeCompare(b.itemName, "ko") || a.itemId.localeCompare(b.itemId)
    || byPositionThenName(person(a), person(b)) || (a.date ?? "").localeCompare(b.date ?? ""));
}

// ── 중복 의심: 같은 사람·같은 날 카드 지출 항목 = 출입증 회사 부담 줄의 연결 예산 항목 ──

/** 카드 지출 (본사 지출 제외) */
export type DupExpense = { id: string; payerId: string; date: string; itemId: string; isHq: boolean };

/** 중복을 보는 출입증 줄: 회사 부담(결정 또는 요청) · 연결 예산 항목 있음 · 사용자·날짜 있음 · 외부인 대납 아님 */
const dupKey = (userId: string, date: string, itemId: string) => `${userId}|${date}|${itemId}`;
export function passDupKeys(lines: PassCompanyLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (!isCompanyLine(l) || !l.linkedItemId || !l.userId || !l.date || l.onBehalfName) continue;
    out.add(dupKey(l.userId, l.date, l.linkedItemId));
  }
  return out;
}

/** 출입증과 겹치는 카드 지출 id (같은 결제자·같은 날·지출 항목 = 연결 예산 항목) */
export function passDuplicateIds(expenses: DupExpense[], lines: PassCompanyLine[]): Set<string> {
  const keys = passDupKeys(lines);
  const out = new Set<string>();
  if (!keys.size) return out;
  for (const e of expenses) if (!e.isHq && keys.has(dupKey(e.payerId, e.date, e.itemId))) out.add(e.id);
  return out;
}

/** 카드 지출이 있는 날 (출입증 결정 화면 경고용): 결제자|날짜|항목 */
export const cardDayKey = dupKey;

export const PASS_DUP = "PASS_DUP";

/**
 * 저장된 점검 결과에 출입증 중복 의심을 지금 기준으로 반영 (출입증 결정은 나중에 바뀔 수 있어 조회할 때 다시 계산한다).
 * 저장된 PASS_DUP은 지우고, dup이면 다시 붙인다.
 */
export function withPassDup(flags: string | null, dup: boolean): string | null {
  const codes = (flags ?? "").split(",").map((c) => c.trim()).filter((c) => c && c !== PASS_DUP);
  if (dup) codes.push(PASS_DUP);
  return codes.length ? codes.join(",") : null;
}

/** 여러 지출 행의 점검 결과를 한 번에 (행 순서·다른 칸 그대로) */
export function applyPassDup<T extends { id: string; payerId: string; date: string; itemId: string; isHq: boolean; flags: string | null }>(rows: T[], lines: PassCompanyLine[]): T[] {
  const dup = passDuplicateIds(rows, lines);
  return rows.map((r) => {
    const flags = withPassDup(r.flags, dup.has(r.id));
    return flags === r.flags ? r : { ...r, flags };
  });
}import { byPositionThenName } from "./org";

