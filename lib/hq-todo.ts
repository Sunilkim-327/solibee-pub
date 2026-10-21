// 재무 승인 할 일 — 전체 프로젝트 화면 위쪽 띠 (순수함수)
import type { ProjectPhase } from "./lifecycle";

export type HqTodoProject = {
  id: string;
  name: string;
  phase: ProjectPhase;
  hasBudget: boolean;
  pms: string[];
  submitted: string[];
  /** 종료 대기 중이고 종료를 막는 사유가 없음 */
  closable: boolean;
};

export type HqTodoKind = "APPROVE" | "NO_BUDGET" | "NO_PM" | "CLOSABLE";

export type HqTodo = {
  kind: HqTodoKind;
  label: string;
  /** 눌렀을 때 그 프로젝트로 전환해 여는 화면 */
  href: string;
  /** 표시 톤 — 빨강(danger)은 반려·오류 전용이라 승인 대기는 진행(info) */
  tone: "danger" | "warn" | "info";
  /** href: 이 프로젝트만의 화면 (없으면 공통 href) */
  projects: { id: string; name: string; note?: string; href?: string }[];
};

const ymText = (ym: string) => `${Number(ym.slice(5, 7))}월`;

/**
 * 재무 승인 할 일 4가지 — 해당 프로젝트가 있는 것만 돌려준다.
 * - 승인 대기: 상신된 월 (재무 승인 담당만 승인할 수 있어 canApprove일 때만)
 * - 예산 미등록: 진행·시작 전인데 단가·기간이 없음 → PM·팀원 모두 입력할 수 없음 (팀원 등록·팀원 지출 항목은 선택이라 세지 않음)
 * - PM 미지정: 진행·시작 전·종료 대기인데 PM이 없음 → 팀원 관리·마감할 사람이 없음
 * - 종료 처리 가능: 기간이 끝났고 모든 월 승인·출입증 확정까지 끝남
 */
export function buildHqTodos(rows: HqTodoProject[], canApprove: boolean): HqTodo[] {
  const live = (p: HqTodoProject) => p.phase === "UPCOMING" || p.phase === "ACTIVE";
  const out: HqTodo[] = [];
  const approve = rows.filter((p) => p.submitted.length);
  if (canApprove && approve.length) {
    out.push({
      // 프로젝트마다 자기의 가장 오래된 승인 대기 달로
      kind: "APPROVE", label: "승인 대기", href: "/closing", tone: "info",
      projects: approve.map((p) => ({ id: p.id, name: p.name, note: p.submitted.map(ymText).join("·"), href: `/closing?ym=${[...p.submitted].sort()[0]}` })),
    });
  }
  const noBudget = rows.filter((p) => live(p) && !p.hasBudget);
  if (noBudget.length) out.push({ kind: "NO_BUDGET", label: "예산 미등록", href: "/budget", tone: "warn", projects: noBudget.map((p) => ({ id: p.id, name: p.name })) });
  const noPm = rows.filter((p) => (live(p) || p.phase === "WRAPUP") && p.pms.length === 0);
  if (noPm.length) out.push({ kind: "NO_PM", label: "PM 미지정", href: "/master", tone: "warn", projects: noPm.map((p) => ({ id: p.id, name: p.name })) });
  const closable = rows.filter((p) => p.phase === "WRAPUP" && p.closable);
  if (closable.length) out.push({ kind: "CLOSABLE", label: "종료 처리 가능", href: "/master", tone: "info", projects: closable.map((p) => ({ id: p.id, name: p.name, href: `/master?project=${p.id}&tab=life` })) });
  return out;
}
