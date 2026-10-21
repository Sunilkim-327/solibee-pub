// 정산 계산 규칙 (docs/PLAN.md PART 2 §3) — 순수함수. 금액은 원 단위 정수.
import type { PayMethod } from "./types";

export type SettlementExpense = {
  amount: number;
  payMethod: PayMethod;
  isHq: boolean;
  payerId: string;
  itemId: string;
  yearMonth: string;
};

/** 계산 입력: DB 행처럼 결제방법이 문자열이어도 받는다 (비교만 하므로) */
export type SettlementInput = Omit<SettlementExpense, "payMethod"> & { payMethod: string };

/** 항목·월 집계 입력 (금액·항목·월만 — 지출 행 또는 항목×월 합계 행) */
export type AmountRow = Pick<SettlementExpense, "amount" | "itemId" | "yearMonth">;

export type Settlement = {
  /** 월 총합계 = 개인 집행내역 합 + 본사 집행내역 합 */
  total: number;
  /** 개인(비본사) 집행내역 합 */
  personal: number;
  /** 팀원별 정산금액: PERSONAL_CARD 이고 isHq=false 인 지출의 결제자별 합 */
  byPayer: Record<string, number>;
  /** 공용법인카드: SHARED_CARD 합 */
  sharedCard: number;
  /** 본사: isHq=true 합 (출입증 회사 부담 줄 포함 — 엑셀 본사 집행내역에 함께 기록) */
  hq: number;
  /** 본사 중 출입증 회사 부담 (payMethod = PASS) */
  pass: number;
  /** 검증: 팀원별 합 + 공용 + 본사 == 월 총합계 */
  isValid: boolean;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** 한국어 이름 정렬 — localeCompare(…, "ko")와 같은 결과, 비교기는 모듈에서 한 번만 */
const KO = new Intl.Collator("ko");

/**
 * @param payerIds 결제자 마스터(isPayer=true). 지출이 없어도 0원으로 표시된다.
 */
export function settle(expenses: SettlementInput[], payerIds: string[] = []): Settlement {
  // 한 번의 순회로 모든 합계 (정수 원이라 더하는 순서가 달라도 결과는 같다)
  let personal = 0, hq = 0, sharedCard = 0, pass = 0;
  const byPayer: Record<string, number> = {};
  for (const id of payerIds) byPayer[id] = 0;
  for (const e of expenses) {
    if (e.isHq) hq += e.amount;
    else {
      personal += e.amount;
      if (e.payMethod === "PERSONAL_CARD") byPayer[e.payerId] = (byPayer[e.payerId] ?? 0) + e.amount;
    }
    if (e.payMethod === "SHARED_CARD") sharedCard += e.amount;
    else if (e.payMethod === PASS_PAY_METHOD) pass += e.amount;
  }
  const total = personal + hq;
  const isValid = sum(Object.values(byPayer)) + sharedCard + hq === total;

  return { total, personal, byPayer, sharedCard, hq, pass, isValid };
}

/** 정산 입력의 출입증 회사 부담 줄 결제방법 (카드 결제방법과 겹치지 않는 표시값 — 저장하지 않음) */
export const PASS_PAY_METHOD = "PASS";

/**
 * 출입증 확정분(연결 예산 항목·내역 월별 합계) → 정산 입력 행: 본사 집행으로 (팀원별 정산에는 들어가지 않음).
 * 총합계·본사 합계에 더해지고, 검증(팀원별 + 공용 + 본사 = 총합계)은 그대로 맞는다.
 */
export function passSettlementRows(rows: { itemId: string; yearMonth: string; amount: number }[]): SettlementInput[] {
  return rows.map((r) => ({ amount: r.amount, payMethod: PASS_PAY_METHOD, isHq: true, payerId: "", itemId: r.itemId, yearMonth: r.yearMonth }));
}

/** 예산 지출: item별 누적 SUM(amount) */
export function spentByItem(expenses: Pick<AmountRow, "amount" | "itemId">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of expenses) out[e.itemId] = (out[e.itemId] ?? 0) + e.amount;
  return out;
}

/** 월 컬럼: item별 yearMonth별 SUM → 예산 시트 월 컬럼 */
export function monthlyByItem(expenses: AmountRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const e of expenses) {
    const row = (out[e.itemId] ??= {});
    row[e.yearMonth] = (row[e.yearMonth] ?? 0) + e.amount;
  }
  return out;
}

/** yearMonth별 총합 (월별 추이) */
export function totalByMonth(expenses: Pick<AmountRow, "amount" | "yearMonth">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of expenses) out[e.yearMonth] = (out[e.yearMonth] ?? 0) + e.amount;
  return out;
}

export type BudgetInput = { itemId: string; planned: number };

export type BudgetRow = {
  itemId: string;
  planned: number;
  spent: number;
  /** 잔액 = planned − 지출 */
  remaining: number;
  /** 집행률(%) — 소수 1자리. 계획 0이면 null */
  rate: number | null;
};

const rateOf = (spent: number, planned: number) =>
  planned > 0 ? Math.round((spent / planned) * 1000) / 10 : null;

/** 항목별 계획/지출/잔액. 예산 없이 지출만 있는 항목도 포함한다. */
export function budgetSummary(lines: BudgetInput[], expenses: Pick<AmountRow, "amount" | "itemId">[]) {
  const planned: Record<string, number> = {};
  for (const l of lines) planned[l.itemId] = (planned[l.itemId] ?? 0) + l.planned;
  const spent = spentByItem(expenses);
  const ids = [...new Set([...Object.keys(planned), ...Object.keys(spent)])];
  const rows: BudgetRow[] = ids.map((itemId) => {
    const p = planned[itemId] ?? 0;
    const s = spent[itemId] ?? 0;
    return { itemId, planned: p, spent: s, remaining: p - s, rate: rateOf(s, p) };
  });
  const totalPlanned = sum(rows.map((r) => r.planned));
  const totalSpent = sum(rows.map((r) => r.spent));
  return {
    rows,
    totalPlanned,
    totalSpent,
    totalRemaining: totalPlanned - totalSpent,
    totalRate: rateOf(totalSpent, totalPlanned),
  };
}

/** 계획금액 = 단가 × 기간 */
export function plannedAmount(unitPrice: number, periods: number): number {
  return unitPrice * periods;
}

/**
 * 소진 예측(EAC): 예상 총액 = 누적 지출 + 최근 3개월(경과월 기준) 평균 × 남은 개월 수
 * @param monthly 월별 지출 (프로젝트 기간 순서)
 * @param elapsed 경과 개월 수 (이번 달 포함)
 */
export function forecastTotal(monthly: number[], elapsed: number): number {
  const done = monthly.slice(0, Math.max(0, elapsed));
  const future = monthly.slice(done.length);
  const spent = sum(done) + sum(future);
  const recent = done.slice(-3);
  const avg = recent.length ? sum(recent) / recent.length : 0;
  const emptyMonths = future.filter((v) => !v).length;
  return Math.round(spent + avg * emptyMonths);
}

/**
 * 집행 속도 판정 — 모든 집행률 막대·상태 글자가 이 함수 하나를 따른다 (docs/DESIGN.md 상태색).
 * - over: 계획 초과 (rate > 100)
 * - fast: 기간 경과보다 10%p 넘게 빨리 씀
 * - forecastOver: 지금 속도면 종료 시 계획 초과 예상
 * - slow: 기간 경과보다 20%p 넘게 늦음 (불용 가능성 — 정보성, 경고 아님). 경과 25% 미만이면 판단하지 않음
 * - ok: 그 외 / none: 예산 없음
 * @param timeRate 기간 경과율(%). 월 단위 비교·비정기 항목처럼 속도를 볼 수 없으면 null → 초과만 판정
 */
export type PaceStatus = "none" | "ok" | "slow" | "fast" | "forecastOver" | "over";

export function paceStatus(x: { rate: number | null; timeRate?: number | null; forecast?: number; planned?: number }): PaceStatus {
  const { rate, timeRate = null, forecast, planned } = x;
  if (rate === null) return "none";
  if (rate > 100) return "over";
  if (timeRate !== null && rate > timeRate + 10) return "fast";
  if (forecast !== undefined && planned !== undefined && planned > 0 && forecast > planned) return "forecastOver";
  if (timeRate !== null && timeRate >= 25 && rate < timeRate - 20) return "slow";
  return "ok";
}

/** 상태 표시: 글자 + 톤 (ok·slow·none은 경고색을 쓰지 않는다) */
export const PACE_META: Record<PaceStatus, { label: string; short: string; tone: "neutral" | "warn" | "bad" }> = {
  none: { label: "예산 없음", short: "예산 없음", tone: "neutral" },
  ok: { label: "기간 대비 정상", short: "정상", tone: "neutral" },
  slow: { label: "기간보다 느리게 쓰는 중", short: "느림", tone: "neutral" },
  fast: { label: "기간보다 빠르게 쓰는 중", short: "빠름", tone: "warn" },
  forecastOver: { label: "종료 시 초과 예상", short: "초과 예상", tone: "warn" },
  over: { label: "배정 초과", short: "초과", tone: "bad" },
};

/** 위험순 정렬 키 (작을수록 위) */
export const PACE_RANK: Record<PaceStatus, number> = { over: 0, fast: 1, forecastOver: 2, slow: 3, ok: 4, none: 5 };

export type BurnPoint = {
  yearMonth: string;
  /** 그 달 지출 */
  amount: number;
  /** 누적 지출 — 지난 달·이번 달만 (미래 달은 null) */
  actual: number | null;
  /** 계획 누적 (계획 ÷ 개월수를 매달 쌓음, 끝전은 마지막 달) */
  plan: number;
  /** 예상 누적 — 이번 달부터 종료까지 (그 전은 null). 마지막 값 = forecastTotal */
  forecast: number | null;
};

/**
 * 누적 집행 추이 (번업 차트) 데이터
 * @param monthly 월별 지출 (프로젝트 기간 순서)
 * @param elapsed 경과 개월 수 (이번 달 포함)
 */
export function burnSeries(months: string[], monthly: number[], planned: number, elapsed: number): BurnPoint[] {
  const n = months.length;
  const done = Math.max(0, Math.min(n, elapsed));
  const recent = monthly.slice(0, done).slice(-3);
  const avg = recent.length ? sum(recent) / recent.length : 0;
  let cum = 0;
  let fc = 0;
  return months.map((ym, i) => {
    const v = monthly[i] ?? 0;
    cum += v;
    // 예상: 지난 달은 실적, 미래 달은 미리 입력된 금액이 있으면 그 금액, 없으면 최근 평균
    fc += i < done ? v : v || avg;
    return {
      yearMonth: ym,
      amount: v,
      actual: i < done ? cum : null,
      plan: i === n - 1 ? planned : Math.floor((planned * (i + 1)) / n),
      forecast: done > 0 && i >= done - 1 ? Math.round(fc) : null,
    };
  });
}

/** 대시보드 행 (buildDashboard rows의 필요한 칸) */
export type UsageRow = { itemId: string; itemName: string; categoryName: string; planned: number; spent: number; forecast: number; months: number[]; regular: boolean };

/**
 * 선택 월 사용 — 매월 항목은 월 예산(계획 ÷ 개월수) 대비 그 달 지출, 비정기 항목은 따로 합계.
 * @param idx 프로젝트 월 목록에서 선택 월 위치
 * @param n 프로젝트 개월수
 */
export function monthUsage(rows: UsageRow[], idx: number, n: number) {
  const reg = rows.filter((r) => r.regular);
  const budget = sum(reg.map((r) => Math.round(r.planned / Math.max(1, n))));
  const regularSpent = sum(reg.map((r) => r.months[idx] ?? 0));
  const irregularSpent = sum(rows.filter((r) => !r.regular).map((r) => r.months[idx] ?? 0));
  return { budget, regularSpent, irregularSpent, total: regularSpent + irregularSpent, rate: rateOf(regularSpent, budget) };
}

/** 운영비 월별 보기 한 줄 — budget·left: 매월 항목만 (비정기 항목은 null, 집행만) */
export type MonthItemRow = { itemId: string; itemName: string; categoryName: string; regular: boolean; planned: number; budget: number | null; spent: number; left: number | null };

/**
 * 선택 월의 항목별 월 배정 대비 집행 (운영비 월별 보기) — 매월 항목은 월 배정(계획 ÷ 개월수, monthAvailable과 같은 나눔)·남음,
 * 비정기 항목은 집행만. 합계(budget·spent·irregularSpent)는 monthUsage와 같다.
 */
export function monthItemRows(rows: Pick<UsageRow, "itemId" | "itemName" | "categoryName" | "planned" | "months" | "regular">[], idx: number, n: number) {
  const items = rows.map((r): MonthItemRow => {
    const spent = r.months[idx] ?? 0;
    const budget = r.regular ? Math.round(r.planned / Math.max(1, n)) : null;
    return { itemId: r.itemId, itemName: r.itemName, categoryName: r.categoryName, regular: r.regular, planned: r.planned, budget, spent, left: budget === null ? null : budget - spent };
  });
  const reg = items.filter((r) => r.budget !== null);
  const budget = sum(reg.map((r) => r.budget ?? 0));
  const spent = sum(reg.map((r) => r.spent));
  return { rows: items, totals: { budget, spent, left: budget - spent, irregularSpent: sum(items.filter((r) => r.budget === null).map((r) => r.spent)) } };
}

/**
 * 주의 항목 — 초과·빠름·초과 예상만, 위험순(같으면 집행률 높은 순) 상위 limit개.
 * 매월 항목만 기간과 비교하고 비정기 항목은 초과만 본다 (분류·항목별 집행과 같은 판정).
 */
export function riskItems(rows: UsageRow[], timeRate: number, limit = 5) {
  return rows
    .map((r) => {
      const rate = rateOf(r.spent, r.planned);
      const status = paceStatus({ rate, timeRate: r.regular ? timeRate : null, forecast: r.regular ? r.forecast : undefined, planned: r.planned });
      return { ...r, rate, remaining: r.planned - r.spent, status };
    })
    .filter((r) => r.status === "over" || r.status === "fast" || r.status === "forecastOver")
    .sort((a, b) => PACE_RANK[a.status] - PACE_RANK[b.status] || (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, limit);
}

/**
 * 팀원별 그 달 사용 — 결제자 전원(0원 포함) + 결제자 목록에 없지만 쓴 사람.
 * 순서: 결제자 목록 순서 그대로(getPayers가 직급 → 성명 순으로 줌) → 목록 밖 결제자는 뒤에 성명 순.
 * entered=false면 그 달 입력이 없는 사람.
 */
export function payerUsage(payers: { id: string; name: string }[], sums: { payerId: string; name: string; amount: number; count: number }[]) {
  const by = new Map(sums.map((s) => [s.payerId, s]));
  const rows = payers.map((p) => {
    const s = by.get(p.id);
    return { id: p.id, name: p.name, amount: s?.amount ?? 0, count: s?.count ?? 0, entered: !!s && s.count > 0, member: true };
  });
  const known = new Set(payers.map((p) => p.id));
  const extra = sums.filter((s) => !known.has(s.payerId))
    .map((s) => ({ id: s.payerId, name: s.name, amount: s.amount, count: s.count, entered: s.count > 0, member: false }))
    .sort((a, b) => KO.compare(a.name, b.name));
  return [...rows, ...extra];
}

/**
 * 남은 예산 한 줄: 월 가용 = 잔액 ÷ 남은 개월(이번 달 포함)
 * @param monthsLeft 프로젝트 월 중 이번 달 이후(포함) 개수 — 기간이 끝났으면 0 → 월 가용 null
 */
export function budgetRunway(planned: number, spent: number, monthsLeft: number) {
  const remaining = planned - spent;
  return { remaining, monthsLeft, perMonth: monthsLeft > 0 ? Math.floor(remaining / monthsLeft) : null };
}

/** 마감 이상(마감·상신·승인) = 확정. 작성중·반려(다시 고치는 중)는 작성중 */
export const isConfirmedStatus = (s: string | null | undefined) => s === "CLOSED" || s === "SUBMITTED" || s === "APPROVED";

/**
 * 지출을 확정분(마감 이상인 달)과 작성중분으로 나눈다.
 * @param byMonth 월("YYYY-MM") → 지출
 * @param statusOf 월 → 마감 상태 (없으면 작성중)
 */
export function splitConfirmed(byMonth: Record<string, number> | undefined, statusOf: Record<string, string | undefined>) {
  let confirmed = 0;
  let draft = 0;
  for (const [ym, v] of Object.entries(byMonth ?? {})) {
    if (isConfirmedStatus(statusOf[ym])) confirmed += v;
    else draft += v;
  }
  return { confirmed, draft };
}

/**
 * 이번 달 가용 — 매월 항목만: 월 예산(계획 ÷ 개월수) − 이번 달 사용. 비정기 항목은 null(누적 잔액만 본다).
 */
export function monthAvailable(planned: number, months: number, usedThisMonth: number, regular: boolean): number | null {
  if (!regular || months <= 0 || planned <= 0) return null;
  return Math.round(planned / months) - usedThisMonth;
}
