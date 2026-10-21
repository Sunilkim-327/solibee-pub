// 지출을 입력할 수 있는 사람 판정 — 순수함수 (서버 import 없음)
// PM만 입력하는 프로젝트(팀원 없음, 또는 팀원 지출 항목 없음)도 정상 운영 형태다.
// '입력할 수 있는 팀원' = 그 프로젝트에서 자기에게 열린 지출 항목이 1개 이상인 팀원 (lib/expenses allowedFromSources와 같은 기준).
// 미입력 집계·알림 문구·마감 준비 점검·팀원별 정산의 '미입력' 표시는 이 팀원만 대상으로 한다.
import { budgetItemIds } from "./budget-bundle";
import { allowedItemIds } from "./rules";

/** 입력 항목의 근거 — 재무 승인이 등록한 예산 행 · PM이 고른 팀원 지출 항목 · 변경계약 과업 담당자 항목 */
export type InputSource = {
  projectId: string;
  kind: "budget" | "member" | "change";
  itemId: string;
  /** 예산 행의 묶음 항목 (budget만) */
  bundleItemIds: string | null;
  /** 과업 담당 PM (change만) */
  managerId: string | null;
};

/** 프로젝트 팀원 (같은 사람이 여러 프로젝트에 있으면 프로젝트마다 한 줄) */
export type InputMembership = { projectId: string; userId: string; isPm: boolean };

/** 그 팀원이 그 프로젝트에서 입력할 수 있는 항목 id — PM은 예산 항목 전체, 팀원은 그중 팀원 지출 항목 + 담당 과업 항목 */
export function inputItemsOf(m: InputMembership, sources: InputSource[]): string[] {
  const own = sources.filter((s) => s.projectId === m.projectId);
  const budget = budgetItemIds(own.filter((s) => s.kind === "budget"));
  if (m.isPm) return allowedItemIds("MANAGER", budget, []);
  const open = own.filter((s) => s.kind === "member" || (s.kind === "change" && s.managerId === m.userId)).map((s) => s.itemId);
  return allowedItemIds("MEMBER", budget, open);
}

/**
 * 입력 대상 팀원 id — PM이 아니면서 자기에게 열린 지출 항목이 있는 팀원.
 * 여러 프로젝트(함께 상신·하위 취합)에 걸치면 어느 한 곳에서라도 입력할 수 있으면 대상. 어느 곳에서든 PM이면 대상이 아니다 (PM은 직접 입력).
 */
export function inputMemberIds(memberships: InputMembership[], sources: InputSource[]): Set<string> {
  const pms = new Set(memberships.filter((m) => m.isPm).map((m) => m.userId));
  const out = new Set<string>();
  for (const m of memberships) {
    if (m.isPm || pms.has(m.userId) || out.has(m.userId)) continue;
    if (inputItemsOf(m, sources).length > 0) out.add(m.userId);
  }
  return out;
}

/** PM인 사람 id */
export const pmIds = (memberships: InputMembership[]) => new Set(memberships.filter((m) => m.isPm).map((m) => m.userId));

/**
 * 팀원별 정산 카드의 한 줄 표시
 * - target: 입력 대상 팀원 — 입력이 없으면 '미입력'
 * - pm: PM — 직접 입력하는 사람이라 '미입력'으로 표시하지 않고 금액만
 * - quiet: 입력할 수 없는 팀원 — 지출(대신 입력 등)이 있을 때만 금액으로 보이고, 없으면 줄을 뺀다
 */
export type SettleRowMode = "target" | "pm" | "quiet";

export function settleRowMode(id: string, targets: Set<string>, pms: Set<string>): SettleRowMode {
  if (pms.has(id)) return "pm";
  return targets.has(id) ? "target" : "quiet";
}

/** 정산 카드에 보일 결제자 — 입력할 수 없는 팀원은 지출이 있을 때만 (목록 외 결제자는 지출이 있어 이미 들어온 줄) */
export function visibleSettlePayers<P extends { id: string; entered: boolean; amount?: number; member?: boolean }>(payers: P[], targets: Set<string>, pms: Set<string>): (P & { mode: SettleRowMode })[] {
  return payers
    .map((p) => ({ ...p, mode: settleRowMode(p.id, targets, pms) }))
    .filter((p) => p.mode !== "quiet" || p.entered || !!p.amount || p.member === false);
}

/**
 * PM 설정의 사실 안내: 팀원은 있는데 입력할 수 있는 항목이 없는 사람 수 (0이면 안내하지 않음).
 * 팀원 지출 항목이 하나라도 있으면 안내하지 않는다 (항목 고르기는 PM이 이미 아는 일).
 */
export function teamWithoutItems(projectId: string, team: { userId: string }[], sources: InputSource[]): number {
  if (sources.some((s) => s.projectId === projectId && s.kind === "member")) return 0;
  return team.filter((t) => inputItemsOf({ projectId, userId: t.userId, isPm: false }, sources).length === 0).length;
}
