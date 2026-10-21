// 프로젝트 운영비 화면의 집계 (순수함수) — 렌더마다 항목×항목 필터를 돌지 않도록 한 번에 색인을 만든다
import { parseWonInput } from "@/lib/format";
import { isConfirmedStatus, paceStatus, type PaceStatus } from "@/lib/settlement";
import type { BudgetItem, Line, PassCompany, PassLinked, Settings } from "./types";

let seq = 0;
/** 화면 전용 예산 행 key */
export const newKey = () => `l${++seq}`;
/** 숫자만 (최대 13자리 — 단가는 21억 초과 가능, 서버 상한 1조원) */
export const digits = (s: string) => parseWonInput(s, 13);
export const ymDot = (ym: string) => ym.replace("-", ".");
/** 집행률 (소수 첫째 자리, 계획 0이면 null) */
export const pct = (spent: number, planned: number) => (planned > 0 ? Math.round((spent / planned) * 1000) / 10 : null);
/** 항목의 현재 설정 (저장 대기 값이 없으면 항목 값) */
export const baseSettings = (i: BudgetItem): Settings => ({
  name: i.name, categoryId: i.categoryId, perPersonLimit: i.perPersonLimit, hardBudget: i.hardBudget, needsAttendees: i.needsAttendees, active: i.active,
});
export const lineAmount = (l: Pick<Line, "unitPrice" | "periods">) => l.unitPrice * l.periods;

export type BudgetIndex = {
  /** 항목 id → 예산 행 (원래 순서) */
  linesByItem: Map<string, Line[]>;
  /** 집계 키(묶음이면 대표 항목) → 지출 합계 */
  spentByKey: Map<string, number>;
  /** 집계 키 → 월 → 지출 */
  monthByKey: Map<string, Record<string, number>>;
};

/**
 * 색인 만들기 — 묶인 항목의 지출·월별 지출은 대표 항목(alias)으로 합산한다.
 * items에 있는 항목만 합산한다 (기존 화면 계산과 같음).
 */
export function buildBudgetIndex(
  items: { id: string }[],
  lines: Line[],
  alias: Map<string, string>,
  spent: Record<string, number>,
  monthly: Record<string, Record<string, number>>,
): BudgetIndex {
  const linesByItem = new Map<string, Line[]>();
  for (const l of lines) {
    const arr = linesByItem.get(l.itemId);
    if (arr) arr.push(l);
    else linesByItem.set(l.itemId, [l]);
  }
  const spentByKey = new Map<string, number>();
  const monthByKey = new Map<string, Record<string, number>>();
  for (const i of items) {
    const key = alias.get(i.id) ?? i.id;
    spentByKey.set(key, (spentByKey.get(key) ?? 0) + (spent[i.id] ?? 0));
    const m = monthly[i.id];
    if (!m) continue;
    const acc = monthByKey.get(key) ?? {};
    for (const [ym, v] of Object.entries(m)) acc[ym] = (acc[ym] ?? 0) + (v ?? 0);
    monthByKey.set(key, acc);
  }
  return { linesByItem, spentByKey, monthByKey };
}

/** 색인 조회 도우미 */
export function budgetLookups(ix: BudgetIndex, itemIds: Set<string>, spent: Record<string, number>) {
  const linesOf = (id: string): Line[] => ix.linesByItem.get(id) ?? [];
  return {
    linesOf,
    plannedOf: (id: string) => linesOf(id).reduce((a, l) => a + lineAmount(l), 0),
    /** 집계 키의 지출 (목록에 없는 항목 id면 그 항목의 지출) */
    spentOf: (id: string) => (ix.spentByKey.get(id) ?? 0) + (itemIds.has(id) ? 0 : spent[id] ?? 0),
    monthOf: (id: string, ym: string) => ix.monthByKey.get(id)?.[ym] ?? 0,
  };
}

/** 예산 항목 id → 연결된 출입증 항목들의 회사 부담 합계 */
export function passLinkedIndex(passItems: BudgetItem[], company: Record<string, PassCompany>): Map<string, PassLinked> {
  const out = new Map<string, PassLinked>();
  for (const x of passItems) {
    if (!x.linkedItemId) continue;
    const cur = out.get(x.linkedItemId) ?? { confirmed: 0, pending: 0, names: [] };
    cur.confirmed += company[x.id]?.confirmed ?? 0;
    cur.pending += company[x.id]?.pending ?? 0;
    cur.names.push(x.name);
    out.set(x.linkedItemId, cur);
  }
  return out;
}

/** 연결 예산 항목별 합계를 예산 집계 키(묶인 항목이면 대표 항목)로 모은다 — 그 줄의 '카드 · 출입증' 나눔 표시용 */
export function passLinkedByKey(byItem: Map<string, PassLinked>, alias: Map<string, string>): Map<string, PassLinked> {
  const out = new Map<string, PassLinked>();
  for (const [id, v] of byItem) {
    const key = alias.get(id) ?? id;
    const cur = out.get(key) ?? { confirmed: 0, pending: 0, names: [] };
    cur.confirmed += v.confirmed;
    cur.pending += v.pending;
    cur.names.push(...v.names);
    out.set(key, cur);
  }
  return out;
}

/** 집행 나눔: 카드 = 집행 − 출입증 확정분 */
export const spendSplit = (spent: number, pass: PassLinked) => ({ card: spent - pass.confirmed, pass: pass.confirmed, pending: pass.pending });

/** 목록에서 두 항목의 자리를 맞바꿈 (둘 중 하나라도 없으면 그대로) */
/** 목록에서 ids에 든 항목들을 ids 순서로 다시 놓는다 (그 항목들이 차지하던 자리 안에서만, 나머지는 그대로) */
export function applyOrder<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const pos = new Map(ids.map((id, i) => [id, i]));
  const picked = list.filter((x) => pos.has(x.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  let k = 0;
  return list.map((x) => (pos.has(x.id) ? picked[k++] : x));
}

export function swapIds<T extends { id: string }>(list: T[], a: string, b: string): T[] {
  const i = list.findIndex((x) => x.id === a);
  const j = list.findIndex((x) => x.id === b);
  if (i < 0 || j < 0) return list;
  const n = [...list];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

// ───────────────────────── 분류 접기 (항목 보기) — 접힌 분류 id 집합, 이 브라우저에 기억

/** localStorage 키 — 프로젝트마다 따로 */
export const foldStorageKey = (projectId: string) => `opex:budgetFold:${projectId}`;
/** 한 분류 접기/펼치기 (새 집합 반환) */
export function toggleFold(folded: ReadonlySet<string>, categoryId: string): Set<string> {
  const n = new Set(folded);
  if (n.has(categoryId)) n.delete(categoryId); else n.add(categoryId);
  return n;
}
/** 모두 접혔으면(보이는 분류가 전부 접힘) 모두 펼치고, 아니면 모두 접는다 */
export function toggleFoldAll(folded: ReadonlySet<string>, categoryIds: string[]): Set<string> {
  return allFolded(folded, categoryIds) ? new Set() : new Set(categoryIds);
}
export const allFolded = (folded: ReadonlySet<string>, categoryIds: string[]) => categoryIds.length > 0 && categoryIds.every((id) => folded.has(id));
/** 저장값(JSON 문자열 배열) → 집합. 깨진 값이면 빈 집합(기본 = 모두 펼침) */
export function parseFold(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch { return new Set(); }
}
export const serializeFold = (folded: ReadonlySet<string>) => JSON.stringify([...folded]);

// ───────────────────────── 분류 머리줄 게이지 (항목별 보기 — 일반 분류·분류 전체 한 예산 카드 공용)

export type CategoryGaugeData = {
  planned: number;
  spent: number;
  remaining: number;
  /** 집행률(%) — 배정 0이면 null */
  rate: number | null;
  /** 마감분(마감 이상인 달) 비율(%, 0~100) — 마감 정보가 없으면 null */
  confirmedRate: number | null;
  /** 기간 경과 눈금(%, 0~100) — 없으면 null */
  marker: number | null;
  /** 속도 판정 — 매월 쓰는 분류(paced)만 기간과 비교, 아니면 초과만 */
  status: PaceStatus;
};
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
export function categoryGauge(x: { planned: number; spent: number; confirmed?: number; timeRate?: number | null; paced?: boolean }): CategoryGaugeData {
  const rate = pct(x.spent, x.planned);
  const timeRate = x.timeRate ?? null;
  const cr = x.confirmed === undefined ? null : pct(x.confirmed, x.planned);
  return {
    planned: x.planned, spent: x.spent, remaining: x.planned - x.spent, rate,
    confirmedRate: cr === null ? null : clamp100(cr),
    marker: timeRate === null ? null : clamp100(timeRate),
    status: paceStatus({ rate, timeRate: x.paced ? timeRate : null }),
  };
}
/** 집행률 알약 톤 — DESIGN 상태색 의미: 정상·예산 없음=중립, 느림=info(진행), 빠름·초과 예상=warn, 초과=bad */
export const gaugeTone = (s: PaceStatus): "neutral" | "info" | "warn" | "bad" =>
  s === "over" ? "bad" : s === "fast" || s === "forecastOver" ? "warn" : s === "slow" ? "info" : "neutral";

// ───────────────────────── 항목 행 표시 모델 — 펼치기 없이 행이 곧 전부

/** 항목명 아래 칩 — 기본값이 아닌 설정만 (기본값은 아무것도 안 보인다) */
export type ItemTag = { kind: "limit" | "attendees" | "hard" | "bundle" | "inactive"; label: string };

/**
 * 보조 줄(예산 행별 줄)을 보일지 — 예산 행이 여럿이거나 변경계약 행이 있을 때만.
 * 한 행뿐이면 행의 단가·기간·배정이 그것이므로 보조 줄 없음 (상세내역은 항목명 옆에 흐리게).
 */
export const hasSubRows = (lines: Pick<Line, "changeId" | "detail">[]) =>
  lines.length > 1 || lines.some((l) => !!l.changeId);

/**
 * 설정 칩 목록 — 기본(한도 없음·참석자 필수·잔액 초과 허용·사용)과 다른 것만.
 * 참석자 필수는 DB 기본값이 true이므로 '불필요'가 예외다.
 */
export function itemTags(s: Pick<Settings, "perPersonLimit" | "needsAttendees" | "hardBudget" | "active">, bundleNames: string[]): ItemTag[] {
  const out: ItemTag[] = [];
  if (s.perPersonLimit) out.push({ kind: "limit", label: `1인당 ${s.perPersonLimit.toLocaleString("ko-KR")}원` });
  if (!s.needsAttendees) out.push({ kind: "attendees", label: "참석자 불필요" });
  if (s.hardBudget) out.push({ kind: "hard", label: "잔액 초과 막기" });
  for (const n of bundleNames) out.push({ kind: "bundle", label: `묶음: ${n}` });
  if (!s.active) out.push({ kind: "inactive", label: "사용 안 함" });
  return out;
}

// ───────────────────────── 항목 펼침 패널 — 월별 집행 막대 · 누적 추이 · 작은 사실

export type ItemBurnPoint = {
  ym: string;
  /** 그 달 집행 */
  amount: number;
  /** 마감분(마감 이상인 달)인가 — 막대를 진하게 */
  confirmed: boolean;
  /** 누적 집행 — 경과한 달만 (미래 달은 null) */
  actual: number | null;
  /** 계획 누적 — 예산 행마다 효력 시작 달부터 종료까지 균등 배분 (변경계약 행은 그 시작 달부터 → 계단) */
  plan: number;
  /** 예상 누적 — 이번 달부터 종료까지 (그 전은 null) */
  forecast: number | null;
};

/**
 * 항목 하나의 월별·누적 추이 데이터 (펼침 패널).
 * 예상은 상단 '운영비 전체 집행'과 같은 규칙: 최근 3개월(경과월) 평균 × 미입력 미래 달 + 미리 입력된 금액.
 * @param lines 예산 행 (amount = 단가 × 기간, from = 효력 시작 "YYYY-MM" — 당초 계약은 null)
 * @param elapsed 경과 개월 수 (이번 달 포함)
 */
export function itemBurn(x: {
  months: string[]; monthly: number[]; lines: { amount: number; from: string | null }[]; elapsed: number;
  closings?: Record<string, string | undefined>;
}): ItemBurnPoint[] {
  const n = x.months.length;
  const done = Math.max(0, Math.min(n, x.elapsed));
  const recent = x.monthly.slice(0, done).slice(-3);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  // 행마다 시작 달 색인 (기간 밖이면 처음부터)
  const spans = x.lines.map((l) => {
    const s = l.from ? x.months.indexOf(l.from) : 0;
    return { amount: l.amount, start: s < 0 ? (l.from && l.from > (x.months[n - 1] ?? "") ? n : 0) : s };
  });
  const planAt = (i: number) => spans.reduce((a, s) => {
    if (i < s.start || s.start >= n) return a;
    const len = n - s.start;
    return a + (i === n - 1 ? s.amount : Math.floor((s.amount * (i - s.start + 1)) / len));
  }, 0);
  let cum = 0;
  let fc = 0;
  return x.months.map((ym, i) => {
    const v = x.monthly[i] ?? 0;
    cum += v;
    fc += i < done ? v : v || avg;
    return {
      ym, amount: v,
      confirmed: isConfirmedStatus(x.closings?.[ym]),
      actual: i < done ? cum : null,
      plan: planAt(i),
      forecast: done > 0 && i >= done - 1 ? Math.round(fc) : null,
    };
  });
}

/** 펼침 패널의 작은 사실 — 월 평균 집행(경과 달 기준) · 가장 많이 쓴 달 · 남은 달 월 가용 · 종료 시 예상 잔액 */
export function itemFacts(points: ItemBurnPoint[], planned: number, elapsed: number) {
  const n = points.length;
  const done = Math.max(0, Math.min(n, elapsed));
  const spent = points.reduce((a, p) => a + p.amount, 0);
  const past = points.slice(0, done).reduce((a, p) => a + p.amount, 0);
  const peak = points.reduce<ItemBurnPoint | null>((a, p) => (p.amount > 0 && (!a || p.amount > a.amount) ? p : a), null);
  const remainMonths = n - done;
  const forecast = done > 0 ? points[n - 1]?.forecast ?? spent : spent;
  return {
    avg: done > 0 ? Math.round(past / done) : 0,
    peak: peak ? { ym: peak.ym, amount: peak.amount } : null,
    remainMonths,
    /** 남은 달에 매달 쓸 수 있는 금액 (잔액 ÷ 남은 달) — 남은 달이 없으면 null */
    monthlyAvailable: remainMonths > 0 ? Math.floor((planned - spent) / remainMonths) : null,
    forecast,
    forecastLeft: planned - forecast,
  };
}

/** 항목 행 표시 모델: 보조 줄 여부 · 행 안 단가·기간 표시(보조 줄이 없을 때만) · 칩 */
export function itemRowView(lines: Line[], s: Settings, nameOf: (id: string) => string) {
  const subRows = hasSubRows(lines);
  const bundle = lines.flatMap((l) => l.bundle);
  return {
    subRows,
    /** 행 안에 단가 × 기간을 보이거나 바로 입력할 수 있는가 (행 0~1개, 보조 줄 없음) */
    inline: !subRows,
    /** 한 행짜리의 상세내역 — 항목명 옆에 흐리게 (편집은 설정 시트) */
    detail: subRows ? "" : lines[0]?.detail.trim() ?? "",
    tags: itemTags(s, bundle.map(nameOf)),
    bundle,
  };
}
