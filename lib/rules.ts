// 입력 권한 규칙 — 순수함수
import type { PayMethod, Role } from "./types";

/**
 * 지출 입력에 쓸 수 있는 항목.
 * - 모든 역할: 재무 승인 담당이 예산에 등록한 항목을 벗어날 수 없다.
 * - 팀원: 그중 PM이 설정 화면에서 노출한 항목만.
 */
export function allowedItemIds(role: Role, budgetItemIds: string[], memberItemIds: string[]): string[] {
  const budget = [...new Set(budgetItemIds)];
  if (role !== "MEMBER") return budget;
  const open = new Set(memberItemIds);
  return budget.filter((id) => open.has(id));
}

/** 역할별 선택 가능한 결제방법 (팀원은 개인식법인카드 고정, 재무 승인 담당은 본사지출만) */
export function allowedPayMethods(role: Role): PayMethod[] {
  if (role === "MEMBER") return ["PERSONAL_CARD"];
  if (role === "HQ") return ["HQ"];
  return ["PERSONAL_CARD", "SHARED_CARD", "HQ"];
}

/**
 * 대상인원·참석자 필수 여부 — 카드 사용분은 필수, 본사 집행은 세부내역만.
 * 공용 비용 항목(재무 승인 담당이 항목에서 "참석자 필수"를 끈 항목)은 카드 사용분이라도 선택.
 */
export function requiresAttendees(payMethod: PayMethod, itemNeedsAttendees = true): boolean {
  return payMethod !== "HQ" && itemNeedsAttendees;
}

/** 새 항목의 '참석자 필수' 기본값 — 인당 한도가 있는 항목만 (한도 점검에 인원이 필요) */
export const defaultNeedsAttendees = (perPersonLimit: number | null | undefined): boolean => !!perPersonLimit && perPersonLimit > 0;

/** 예산(프로젝트 운영비) 편집 역할: 재무 승인 담당만. PM·시스템 관리자는 조회만 */
export const BUDGET_EDITORS: Role[] = ["HQ"];
export const canEditBudget = (role: Role) => BUDGET_EDITORS.includes(role);

/** 분류·항목 마스터 편집 역할: 재무 승인 담당만 */
export const MASTER_EDITORS: Role[] = ["HQ"];
export const canEditMaster = (role: Role) => MASTER_EDITORS.includes(role);

/** 프로젝트 설정(팀원 입력 항목·협력 인력 등) 관리 권한: 이 프로젝트 PM만 (재무 승인 담당은 예산·기준 정보, 시스템 관리자는 프로젝트 정보·PM 지정) */
export const canManageProjectSettings = (role: Role) => role === "MANAGER";
/**
 * 프로젝트의 전체 행(팀원별 정산·지출·변경계약 등) 조회: 이 프로젝트 PM·재무 승인·시스템 관리자 (종료된 프로젝트 포함).
 * 팀원과 상위 PM·조직장 조회(view)는 제외 — 다른 사람 이름·금액은 서버에서 걸러 낸다. (canSeeAllPass와 같은 기준)
 */
export const canSeeAllRows = (u: { role: Role; readOnlyReason?: "view" | "closed" | "admin" }) =>
  u.role !== "MEMBER" && u.readOnlyReason !== "view";

/**
 * 지출의 변경계약 과업(changeId) 결정
 * - 담당 PM(팀원 권한): 자기 과업 항목으로만, 과업 전용 항목을 고르면 자동으로 그 과업에 연결
 * - 메인 PM·재무 승인: 어느 과업이든 직접 지정 가능 (지정하지 않으면 본 과업)
 * @returns changeId(없으면 null) 또는 오류 메시지
 */
export function resolveChangeId(x: {
  role: Role;
  itemId: string;
  requested: string | null | undefined;
  /** 이 사용자가 담당하는 과업과 과업 전용 항목 */
  managed: { id: string; itemIds: string[] }[];
  memberItemIds: string[];
  projectChangeIds: string[];
}): { changeId: string | null } | { error: string } {
  if (x.requested) {
    if (!x.projectChangeIds.includes(x.requested)) return { error: "변경계약 과업을 찾을 수 없습니다." };
    if (x.role !== "MEMBER") return { changeId: x.requested };
    const own = x.managed.find((m) => m.id === x.requested);
    if (!own) return { error: "담당하는 변경계약 과업에만 입력할 수 있습니다." };
    if (!own.itemIds.includes(x.itemId)) return { error: "이 과업에 설정된 항목만 입력할 수 있습니다." };
    return { changeId: own.id };
  }
  if (x.role === "MEMBER" && !x.memberItemIds.includes(x.itemId)) {
    const own = x.managed.find((m) => m.itemIds.includes(x.itemId));
    if (own) return { changeId: own.id };
  }
  return { changeId: null };
}
