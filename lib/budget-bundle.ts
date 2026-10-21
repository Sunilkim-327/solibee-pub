// 묶음 예산 — 여러 항목을 하나의 월 단가로 묶은 예산 행 (순수함수)
// 예) "식대 묶음" 야근식대 + 간식비 월 300,000원 × 12개월 = 계획 3,600,000원
//     지출 = 야근식대 지출 + 간식비 지출, 잔액 = 계획 − 지출
// 예산 행의 itemId가 대표 항목, bundleItemIds는 함께 묶인 항목 (대표 항목 제외).
// 묶인 항목의 지출은 예산 집계에서 대표 항목으로 합산한다.
import { parseStringArray } from "./json";

/** bundleItemIds: 배열 또는 DB의 JSON 문자열 */
export type BundleLine = { itemId: string; bundleItemIds?: string | string[] | null };
/** 항목 id → 분류 id (같은 분류 검사용) */
export type CategoryOf = (itemId: string) => string | undefined;

/** DB의 bundleItemIds(JSON) → 배열 */
export const parseBundle = parseStringArray;

const extrasOf = (l: BundleLine) => parseStringArray(l.bundleItemIds);

/** 묶인 항목 → 대표 항목 (묶음에 속하지 않은 항목은 없음) */
export function bundleAlias(lines: BundleLine[]): Map<string, string> {
  const alias = new Map<string, string>();
  for (const l of lines) for (const x of extrasOf(l)) if (x !== l.itemId) alias.set(x, l.itemId);
  return alias;
}

/** 예산 집계용 항목 키: 묶인 항목이면 대표 항목 */
export const budgetKey = (alias: Map<string, string>, itemId: string) => alias.get(itemId) ?? itemId;

/** 대표 항목 → 묶인 항목 목록 */
export function bundleMembers(lines: BundleLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of lines) {
    const extra = extrasOf(l).filter((x) => x !== l.itemId);
    if (!extra.length) continue;
    out.set(l.itemId, [...new Set([...(out.get(l.itemId) ?? []), ...extra])]);
  }
  return out;
}

/**
 * 묶음 검증 → 문제 메시지 (없으면 null). name: 항목 id → 이름
 * - 한 항목은 한 묶음에만 (지출을 어느 예산에 넣을지 하나로 정해져야 함)
 * - 묶인 항목은 따로 예산 행을 가질 수 없음 (대표 항목 행에서 함께 관리)
 * - 대표 항목이 다른 묶음에 묶일 수 없음
 * - (categoryOf를 주면) 같은 분류의 항목만
 */
export function bundleProblem(lines: BundleLine[], name: (id: string) => string = (id) => id, categoryOf?: CategoryOf): string | null {
  const owner = new Map<string, string>();
  for (const l of lines) {
    for (const x of extrasOf(l)) {
      if (x === l.itemId) continue;
      if (categoryOf && categoryOf(x) !== categoryOf(l.itemId)) return `'${name(x)}'은(는) '${name(l.itemId)}'와 분류가 달라 묶을 수 없습니다. 같은 분류의 항목만 묶을 수 있습니다.`;
      const prev = owner.get(x);
      if (prev && prev !== l.itemId) return `'${name(x)}'이(가) '${name(prev)}'·'${name(l.itemId)}' 두 묶음에 들어 있습니다. 한 묶음에만 넣으세요.`;
      owner.set(x, l.itemId);
    }
  }
  for (const l of lines) {
    const o = owner.get(l.itemId);
    if (o) return `'${name(l.itemId)}'은(는) '${name(o)}' 묶음에 들어 있어 따로 예산 행을 둘 수 없습니다. 묶음에서 빼거나 이 행을 지우세요.`;
  }
  return null;
}

/** 묶음 표시 이름: "야근식대 + 간식비" */
export const bundleLabel = (primary: string, extras: string[]) => [primary, ...extras].join(" + ");

/**
 * 예산에 들어 있는 항목 id (예산 행 순서): 예산 행의 대표 항목 + 묶음으로 함께 들어간 항목.
 * 팀원 입력 항목·PM 입력·변경계약 과업 항목은 이 범위에서 고른다.
 */
export function budgetItemIds(lines: BundleLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const id of [l.itemId, ...extrasOf(l)]) if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ── 묶음 단위 예산 잔액 (입력 폼 표시·서버 검사 공통) ──

export type BudgetPlanLine = BundleLine & { planned: number };

/** 항목이 속한 예산: key 대표 항목, group 묶음 전체 항목, planned 계획 합계 (예산 행이 없으면 null) */
export type BundleBudget = { key: string; group: string[]; planned: number | null };

/** 예산 행 → 항목별 묶음 예산 조회 함수 */
export function bundleBudgets(lines: BudgetPlanLine[]): (itemId: string) => BundleBudget {
  const alias = bundleAlias(lines);
  const members = bundleMembers(lines);
  const planned = new Map<string, number>();
  for (const l of lines) planned.set(l.itemId, (planned.get(l.itemId) ?? 0) + l.planned);
  return (itemId) => {
    const key = budgetKey(alias, itemId);
    return { key, group: [key, ...(members.get(key) ?? [])], planned: planned.get(key) ?? null };
  };
}

/**
 * 항목별 예산 잔액 (묶음이면 묶음 전체 계획 − 묶음 전체 지출). 예산에 든 모든 항목을 키로 —
 * 묶인 항목도 묶음 공동 잔액을 보여 준다.
 */
export function bundleRemaining(lines: BudgetPlanLine[], spentByItem: Record<string, number>): Record<string, number> {
  const budgetOf = bundleBudgets(lines);
  const out: Record<string, number> = {};
  for (const id of budgetItemIds(lines)) {
    const b = budgetOf(id);
    if (b.planned === null) continue;
    out[id] = b.planned - b.group.reduce((a, g) => a + (spentByItem[g] ?? 0), 0);
  }
  return out;
}

/** 예산에 든 항목 → 예산 집계 키(대표 항목). 같은 키면 같은 잔액을 공유한다 */
export function budgetKeyMap(lines: BundleLine[]): Record<string, string> {
  const alias = bundleAlias(lines);
  return Object.fromEntries(budgetItemIds(lines).map((id) => [id, budgetKey(alias, id)]));
}
