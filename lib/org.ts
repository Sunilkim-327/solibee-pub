// 조직도 트리 유틸 — 순수함수
export type Dept = { id: string; name: string; parentId: string | null; order: number; active?: boolean };
export type DeptNode<T extends Dept = Dept> = T & { depth: number; path: string; children: DeptNode<T>[] };

/** 평면 목록 → 트리 (부모가 없거나 사라진 부서는 최상위로) */
export function buildTree<T extends Dept>(depts: T[]): DeptNode<T>[] {
  const nodes = new Map<string, DeptNode<T>>(depts.map((d) => [d.id, { ...d, depth: 0, path: d.name, children: [] }]));
  const roots: DeptNode<T>[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (xs: DeptNode<T>[]) => xs.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
  const walk = (xs: DeptNode<T>[], depth: number, prefix: string) => {
    sort(xs);
    for (const x of xs) {
      x.depth = depth;
      x.path = prefix ? `${prefix} > ${x.name}` : x.name;
      walk(x.children, depth + 1, x.path);
    }
  };
  walk(roots, 0, "");
  return roots;
}

/** 트리를 들여쓰기 순서의 평면 목록으로 (선택 박스용) */
export function flattenTree<T extends Dept>(roots: DeptNode<T>[]): DeptNode<T>[] {
  const out: DeptNode<T>[] = [];
  const walk = (xs: DeptNode<T>[]) => xs.forEach((x) => (out.push(x), walk(x.children)));
  walk(roots);
  return out;
}

/** id 부서와 그 하위 부서 전체 id */
export function descendantIds(depts: Dept[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of depts) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}

/** parentId로 옮기면 순환이 생기는지 (자기 자신·하위 부서 아래로 이동 금지) */
export function wouldCycle(depts: Dept[], id: string, parentId: string | null): boolean {
  return parentId !== null && descendantIds(depts, id).has(parentId);
}

/**
 * 프로젝트 체계도(EPS)에 표시할 부서
 * - epsEnabled 부서: 프로젝트를 둘 수 있음
 * - 미사용 부서라도 하위에 사용 부서가 있으면 묶음(그룹)으로 표시 — 프로젝트는 둘 수 없음
 * - 사용·하위 사용 모두 없는 부서는 숨김
 */
export function epsDepartments<T extends { id: string; parentId: string | null; epsEnabled: boolean }>(depts: T[]): (T & { group: boolean })[] {
  const keep = new Set<string>();
  const byId = new Map(depts.map((d) => [d.id, d]));
  for (const d of depts) {
    if (!d.epsEnabled) continue;
    // 사용 부서와 그 상위 경로를 모두 표시
    let cur: T | undefined = d;
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return depts.filter((d) => keep.has(d.id)).map((d) => ({ ...d, group: !d.epsEnabled }));
}

/**
 * 조직도 직급 순서 (높은 직급 먼저). Soliday 직급 체계 + 데모 직급(선임).
 * 목록에 없는 직급은 그 뒤에, 직급이 없으면 맨 뒤에 둔다. IMSI(임시 계정)는 직급 맨 끝.
 */
export const POSITION_ORDER = [
  "대표이사", "사장", "부사장", "CFO", "이사", "본부장", "원장", "소장", "위원",
  "그룹장", "팀장", "수석", "책임", "선임", "담당", "사원", "인턴", "IMSI",
] as const;

export function positionRank(position: string | null | undefined): number {
  if (!position) return POSITION_ORDER.length + 1;
  const i = (POSITION_ORDER as readonly string[]).indexOf(position.trim());
  return i === -1 ? POSITION_ORDER.length : i;
}

/** 사람 목록 기본 정렬: 직급 → 성명(가나다) — 모든 사람 표·목록에 쓴다 */
export function byPositionThenName(a: { position?: string | null; name: string }, b: { position?: string | null; name: string }) {
  return positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name, "ko");
}

/** 직급 → 성명 순으로 정렬한 새 배열 (pick: 사람 정보를 꺼내는 함수) */
export function sortPeople<T>(list: T[], pick: (x: T) => { position?: string | null; name: string }): T[] {
  return [...list].sort((a, b) => byPositionThenName(pick(a), pick(b)));
}

/** 직급 구분 (조직도 표시용): 임원 · 조직장 · 책임급 · 실무 · 인턴·임시 */
export type PositionTier = "exec" | "lead" | "senior" | "staff" | "temp" | "none";
const TIER: Record<string, PositionTier> = {
  대표이사: "exec", 사장: "exec", 부사장: "exec", CFO: "exec", 이사: "exec", 본부장: "exec", 원장: "exec", 소장: "exec", 위원: "exec",
  그룹장: "lead", 팀장: "lead",
  수석: "senior", 책임: "senior", 선임: "senior",
  담당: "staff", 사원: "staff",
  인턴: "temp", IMSI: "temp",
};
export function positionTier(position: string | null | undefined): PositionTier {
  if (!position) return "none";
  return TIER[position.trim()] ?? "staff";
}
