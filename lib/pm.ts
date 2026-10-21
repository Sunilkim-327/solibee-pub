// 프로젝트 PM 지정 ↔ PM 권한 자동 부여·회수
import type { PrismaClient } from "@prisma/client";
import type { Db as DbClient, Tx } from "./db";
import { isWritablePhase, projectPhase, type ProjectPhase } from "./lifecycle";
import { parseRole, type Role } from "./types";

// 시드(prisma/seed.ts)는 확장 없는 PrismaClient를 넘긴다
type Db = DbClient | Tx | PrismaClient;

/**
 * PM 지정 상태에 따른 역할 변경 — 순수함수
 * - 팀원이 어느 프로젝트든 PM으로 지정되면 → PM(MANAGER) 권한 부여 (자동 부여 표시)
 * - 자동 부여된 PM이 모든 프로젝트에서 PM이 아니게 되면 → 팀원으로 회수
 * - 시스템 관리자가 직접 정한 PM, 재무 승인·시스템 관리자 역할은 건드리지 않는다
 */
export function pmRoleChange(role: Role, isPmAnywhere: boolean, autoGranted: boolean): { role: Role; pmAutoGranted: boolean } | null {
  if (isPmAnywhere && role === "MEMBER") return { role: "MANAGER", pmAutoGranted: true };
  if (!isPmAnywhere && role === "MANAGER" && autoGranted) return { role: "MEMBER", pmAutoGranted: false };
  return null;
}

/** 역할 ↔ PM 지정 불변식 위반 (scripts/check-invariants.ts) */
export type PmInvariantViolation = {
  userId: string;
  name: string;
  /** PM_ROLE: PM으로 지정됐는데 MANAGER가 아님 · STALE_AUTO_GRANT: 자동 부여 PM인데 어느 프로젝트에서도 PM이 아님 · AUTO_GRANT_FLAG: 자동 부여 표시가 MANAGER가 아닌 역할에 남음 */
  kind: "PM_ROLE" | "STALE_AUTO_GRANT" | "AUTO_GRANT_FLAG";
  role: string;
  pmProjects: number;
};

/**
 * User.role=MANAGER와 ProjectMember.isPm은 같은 사실을 두 곳에 저장한다(pmRoleChange로 맞춤). 어긋난 사용자를 찾는 순수함수.
 * - 어느 프로젝트에서든 isPm이면 role=MANAGER
 * - pmAutoGranted면 isPm인 프로젝트가 하나는 있어야 한다 (없으면 MEMBER로 복귀됐어야 함)
 * - pmAutoGranted는 MANAGER에만 붙는다
 */
export function pmInvariantViolations(users: { id: string; name: string; role: string; pmAutoGranted: boolean }[], members: { userId: string; isPm: boolean }[]): PmInvariantViolation[] {
  const pmCount = new Map<string, number>();
  for (const m of members) if (m.isPm) pmCount.set(m.userId, (pmCount.get(m.userId) ?? 0) + 1);
  const out: PmInvariantViolation[] = [];
  for (const u of users) {
    const pmProjects = pmCount.get(u.id) ?? 0;
    const base = { userId: u.id, name: u.name, role: u.role, pmProjects };
    if (pmProjects > 0 && u.role !== "MANAGER") out.push({ ...base, kind: "PM_ROLE" });
    if (u.pmAutoGranted && u.role !== "MANAGER") out.push({ ...base, kind: "AUTO_GRANT_FLAG" });
    else if (u.pmAutoGranted && pmProjects === 0) out.push({ ...base, kind: "STALE_AUTO_GRANT" });
  }
  return out;
}

/**
 * 프로젝트 안에서의 실제 역할: PM(MANAGER) 권한이 있어도 이 프로젝트의 PM이 아니면 팀원으로 동작
 * (PM 지정 이전부터 시스템 관리자가 PM 역할을 준 사용자는 팀원 정보로 판단)
 */
export function roleInProject(role: Role, membership: { isPm: boolean } | null): Role {
  if (role === "MANAGER" && membership && !membership.isPm) return "MEMBER";
  return role;
}

type ScopedUser = { role: Role; readOnly?: boolean; readOnlyReason?: "view" | "closed" | "admin" };
type Dated = { startDate: Date; endDate: Date; closedAt: Date | null; archivedAt: Date | null };

/**
 * 프로젝트 안의 사용자 — 순수함수 (접근 가능 여부는 호출 전에 확인).
 * - 재무 승인·시스템 관리자: 역할 그대로
 * - 팀원: 프로젝트 역할 (PM이 아니면 팀원)
 * - 팀원이 아님(상위 PM·조직장 조회): PM 화면을 조회 전용으로
 * - 시스템 관리자: 프로젝트 데이터는 조회 전용 (admin) — 시스템 관리자의 일은 시스템 운영, 프로젝트 화면은 지원(요청 확인)용
 * - 종료·보관된 프로젝트: 모두 조회 전용 (closed가 admin보다 우선)
 */
export function projectScopedUser<U extends ScopedUser>(user: U, project: Dated, membership: { isPm: boolean } | null, now?: Date): { user: U; phase: ProjectPhase } {
  let me: U = user;
  if (user.role !== "HQ" && user.role !== "ADMIN") {
    me = membership ? { ...user, role: roleInProject(user.role, membership) } : { ...user, role: "MANAGER", readOnly: true, readOnlyReason: "view" };
  }
  if (user.role === "ADMIN") me = { ...me, readOnly: true, readOnlyReason: "admin" };
  const phase = projectPhase(project, now);
  if (!isWritablePhase(phase)) me = { ...me, readOnly: true, readOnlyReason: "closed" };
  return { user: me, phase };
}

/** 대상 사용자들의 PM 권한을 현재 PM 지정 상태에 맞춘다. 변경 내역을 돌려준다. */
export async function syncPmRoles(db: Db, userIds: string[]) {
  const changes: { userId: string; name: string; from: Role; to: Role }[] = [];
  const ids = [...new Set(userIds)];
  if (!ids.length) return changes;
  // 대상 사용자·PM 지정 여부를 한 번에 읽고, 바뀌는 사용자만 갱신
  const [users, pms] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true, pmAutoGranted: true } }),
    db.projectMember.findMany({ where: { userId: { in: ids }, isPm: true }, select: { userId: true }, distinct: ["userId"] }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const isPm = new Set(pms.map((m) => m.userId));
  for (const id of ids) {
    const user = byId.get(id);
    const role = parseRole(user?.role);
    if (!user || !role) continue;
    const next = pmRoleChange(role, isPm.has(id), user.pmAutoGranted);
    if (!next) continue;
    await db.user.update({ where: { id }, data: next });
    changes.push({ userId: id, name: user.name, from: role, to: next.role });
  }
  return changes;
}
