// 프로젝트 상·하위 구조 — 순수함수
// 상위 PM은 하위 프로젝트 전체를 조회(조회 전용)·취합할 수 있고, 하위 PM은 상위 프로젝트를 볼 수 없다.
export type ProjectNode = { id: string; parentId: string | null };

/** id의 모든 하위 프로젝트 (자기 자신 제외) */
export function descendantsOf(nodes: ProjectNode[], id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of nodes) {
      if (n.parentId === cur && !out.includes(n.id) && n.id !== id) {
        out.push(n.id);
        queue.push(n.id);
      }
    }
  }
  return out;
}

/** id의 모든 상위 프로젝트 (가까운 순) */
export function ancestorsOf(nodes: ProjectNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

/** parentId로 지정하면 순환이 생기는지 (자기 자신·하위 프로젝트를 상위로 지정 금지) */
export function wouldCycleProject(nodes: ProjectNode[], id: string, parentId: string | null): boolean {
  return parentId !== null && (parentId === id || descendantsOf(nodes, id).includes(parentId));
}

/**
 * 사용자가 볼 수 있는 프로젝트
 * - 팀원인 프로젝트
 * - PM인 프로젝트의 모든 하위 프로젝트 (조회 전용)
 * @returns projectId → "member" | "parent-pm"
 */
export function visibleProjects(
  nodes: ProjectNode[],
  memberships: { projectId: string; isPm: boolean }[],
  /** 하위 프로젝트 계산 (기본: 직접 상·하위. 연속 사업이면 lifecycle.rollupChildren) */
  childrenOf: (id: string) => string[] = (id) => descendantsOf(nodes, id),
): Map<string, "member" | "parent-pm"> {
  const out = new Map<string, "member" | "parent-pm">();
  for (const m of memberships) out.set(m.projectId, "member");
  for (const m of memberships.filter((x) => x.isPm)) {
    for (const d of childrenOf(m.projectId)) if (!out.has(d)) out.set(d, "parent-pm");
  }
  return out;
}

/** 트리 순서 + 깊이 (선택 박스 들여쓰기용) */
export function orderTree<T extends ProjectNode>(nodes: T[]): (T & { depth: number })[] {
  const ids = new Set(nodes.map((n) => n.id));
  const out: (T & { depth: number })[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of nodes.filter((x) => (x.parentId && ids.has(x.parentId) ? x.parentId : null) === parentId)) {
      if (out.some((o) => o.id === n.id)) continue;
      out.push({ ...n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * 조직장이 볼 수 있는 프로젝트: 조직장인 부서와 그 하위 부서에 속한 모든 프로젝트 (조회 전용)
 */
export function orgHeadProjects(
  projects: { id: string; departmentId: string | null }[],
  depts: { id: string; parentId: string | null }[],
  headDeptIds: string[],
): string[] {
  if (!headDeptIds.length) return [];
  const scope = new Set<string>();
  const queue = [...headDeptIds];
  while (queue.length) {
    const cur = queue.shift()!;
    if (scope.has(cur)) continue;
    scope.add(cur);
    for (const d of depts) if (d.parentId === cur) queue.push(d.id);
  }
  return projects.filter((p) => p.departmentId && scope.has(p.departmentId)).map((p) => p.id);
}
