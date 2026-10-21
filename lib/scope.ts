// 상위 PM·재무 승인의 "하위 프로젝트 포함" 취합 범위 + 메인과 함께 상신하는 서브의 구분 필터 (서버 전용)
import { isHqLike, projectRows, projectVisibility, type SessionUser } from "./access";
import { projectMonths } from "./format";
import { rollupChildren } from "./lifecycle";
import { isSettleChild, partLabel, settleChildIds, settleParentFor } from "./settle-group";

/**
 * @param scope "all"이면 (함께 상신하지 않는) 하위 프로젝트도 취합
 * @param part 구분 필터 — 없거나 "all"이면 메인 + 함께 상신하는 서브 전체, 프로젝트 id면 그 구분만
 */
export async function rollupScope(user: SessionUser, projectId: string, scope: string | string[] | undefined, part?: string | string[]) {
  // 전체 프로젝트·가시성은 요청 단위로 메모이즈되어 레이아웃·페이지에서 읽은 것을 다시 쓴다
  const [nodes, vis] = await Promise.all([projectRows(), projectVisibility(user)]);
  // 하위 프로젝트: 같은 연속 사업의 다른 연차에 연결된 서브도 기간이 겹치면 포함 → 월 기준으로 귀속
  const all = rollupChildren(nodes, projectId).filter((id) => !vis || vis.has(id));
  const self = nodes.find((n) => n.id === projectId)!;
  const months = projectMonths(self.startDate, self.endDate);
  // 함께 상신하는 서브: PM·재무 승인·시스템 관리자(팀원 제외)에게 메인과 함께 늘 보인다 (상신 범위)
  const sees = user.role === "MANAGER" || isHqLike(user);
  const settleIds = sees ? settleChildIds(nodes, projectId).filter((id) => !vis || vis.has(id)) : [];
  const children = all.filter((id) => !settleIds.includes(id));
  // 하위 프로젝트가 있고, 이 프로젝트의 PM(상위 PM 포함)이나 재무 승인·시스템 관리자일 때만
  const canRollup = children.length > 0 && sees;
  const on = canRollup && scope === "all";
  const group = [projectId, ...settleIds];
  const partId = typeof part === "string" && group.includes(part) ? part : null;
  const base = partId ? [partId] : group;
  const parts = settleIds.length
    ? group.map((id) => { const n = nodes.find((x) => x.id === id)!; return { id, label: partLabel(n) }; })
    : [];
  return {
    canRollup, on, children,
    /** 지출·정산·예산을 모을 프로젝트 (구분 필터 + 하위 포함) */
    ids: on ? [...base, ...children] : base,
    months,
    /** 메인 + 함께 상신하는 서브 (구분 필터와 무관 — 마감 준비 점검 범위) */
    group,
    /** 구분 필터 단추 (함께 상신하는 서브가 있을 때만): 메인 먼저 */
    parts,
    /** 지금 고른 구분 (null = 전체) */
    partId,
    /** 이 프로젝트가 메인과 함께 상신하는 서브면 그 달 메인 이름 (아니면 null) */
    settleParentName: (ym: string) => (isSettleChild(self) ? settleParentFor(nodes, projectId, ym)?.name ?? null : null),
  };
}
