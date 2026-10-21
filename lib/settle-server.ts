// 메인과 함께 상신하는 서브 프로젝트 묶음 (서버 전용) — 전체 프로젝트 조회(요청 안에서 한 번, lib/access projectRows)로 계산한다
import "server-only";
import { projectRows } from "./access";
import { isSettleChild, settleChildIds, settleParentFor } from "./settle-group";

/**
 * 프로젝트의 함께 상신 묶음
 * - kids: 이 프로젝트(메인)와 함께 상신하는 서브 (시작일 순)
 * - parent: 이 프로젝트가 함께 상신하는 서브이면 직접 상위(메인), 아니면 null
 * - parentFor(ym): 서브의 그 달 메인 (연속 사업이면 그 달이 든 연차)
 */
export async function settleGroup(projectId: string) {
  const nodes = await projectRows();
  const self = nodes.find((n) => n.id === projectId) ?? null;
  const ids = settleChildIds(nodes, projectId);
  const kids = ids.map((id) => nodes.find((n) => n.id === id)!);
  const child = !!self && isSettleChild(self);
  const parent = child ? nodes.find((n) => n.id === self!.parentId) ?? null : null;
  return {
    self,
    kids,
    /** 메인 + 함께 상신하는 서브 id */
    ids: [projectId, ...ids],
    parent,
    parentFor: (ym: string) => (child ? settleParentFor(nodes, projectId, ym) : null),
  };
}
