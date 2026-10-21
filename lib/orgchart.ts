// 조직도 화면 데이터 (서버 전용) — 부서 트리 + 부서원 + 조직에 속한 프로젝트
import "server-only";
import { projectVisibility, type SessionUser } from "./access";
import { prisma, toNumber } from "./db";
import { formatDate, projectMonths, formatPeriod, seoulTodayDate } from "./format";
import { currentMemberWhere } from "./membership";
import { buildTree, flattenTree, byPositionThenName, sortPeople } from "./org";
import { parseRole } from "./types";
import { sqlPassCompanyLines } from "./sql-loaders";
import { passBudgetSpend } from "./pass-budget";

import type { OrgDept, OrgPerson, OrgProject } from "./dto";
export type { OrgDept, OrgPerson, OrgProject };

/**
 * 개인정보: 사번·입사일은 시스템 관리자에게만, 소속 프로젝트는 볼 수 있는 프로젝트만 전달한다.
 * withPeople=false면 임직원 목록을 보내지 않는다 (체계도에서 프로젝트를 만들 권한이 없을 때).
 */
export async function getOrgChart(user: SessionUser, opts: { includeInactive: boolean; withLoginId: boolean; withPeople?: boolean }) {
  const admin = user.role === "ADMIN";
  const withPeople = opts.withPeople ?? true;
  const [depts, users, projects, vis] = await Promise.all([
    prisma.department.findMany({
      select: { id: true, name: true, code: true, parentId: true, order: true, active: true, headId: true, epsEnabled: true, head: { select: { name: true } } },
    }),
    !withPeople ? [] : prisma.user.findMany({
      where: opts.includeInactive ? {} : { active: true },
      select: {
        id: true, name: true, loginId: true, position: true, joinDate: true, role: true, departmentId: true, active: true, employeeNo: true, externalSource: true,
        memberships: { where: currentMemberWhere(seoulTodayDate()), select: { isPm: true, projectId: true, project: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      select: {
        id: true, name: true, code: true, departmentId: true, parentId: true, startDate: true, endDate: true,
        members: { where: currentMemberWhere(seoulTodayDate()), select: { isPm: true, user: { select: { name: true, position: true } } } },
      },
      orderBy: { startDate: "asc" },
    }),
    projectVisibility(user),
  ]);
  const canSee = (id: string) => !vis || vis.has(id);
  const seen = projects.filter((p) => canSee(p.id)).map((p) => p.id);
  const [planned, spent, passLines] = await Promise.all([
    prisma.budgetLine.groupBy({ by: ["projectId"], where: { projectId: { in: seen } }, _sum: { planned: true } }),
    prisma.expense.groupBy({ by: ["projectId"], where: { projectId: { in: seen } }, _sum: { amount: true } }),
    // 예산 집행 = 카드 + 출입증 확정분 (연결 예산 항목)
    sqlPassCompanyLines(seen),
  ]);
  const plannedBy = new Map(planned.map((x) => [x.projectId, toNumber(x._sum.planned)]));
  const spentBy = new Map(spent.map((x) => [x.projectId, toNumber(x._sum.amount)]));
  for (const r of passBudgetSpend(passLines).confirmedRows) spentBy.set(r.projectId, (spentBy.get(r.projectId) ?? 0) + r.amount);

  const tree: OrgDept[] = flattenTree(buildTree(depts.filter((d) => opts.includeInactive || d.active))).map((d) => ({
    id: d.id, name: d.name, code: d.code, parentId: d.parentId, order: d.order, depth: d.depth, path: d.path, active: d.active,
    headId: d.headId, headName: d.head?.name ?? null, epsEnabled: d.epsEnabled,
  }));
  const people: OrgPerson[] = [...users].sort(byPositionThenName).map((u) => ({
    id: u.id,
    name: u.name,
    // 계정 정보는 볼 수 있는 화면에만 (아니면 키 자체를 넣지 않아 응답을 줄인다)
    ...(opts.withLoginId ? { loginId: u.loginId } : {}),
    position: u.position,
    ...(admin ? { joinDate: u.joinDate ? formatDate(u.joinDate) : null, employeeNo: u.employeeNo } : {}),
    role: parseRole(u.role) ?? "MEMBER",
    departmentId: u.departmentId,
    active: u.active,
    external: !!u.externalSource,
    projects: u.memberships.filter((m) => canSee(m.projectId)).map((m) => ({ name: m.project.name, isPm: m.isPm })),
  }));
  const orgProjects: OrgProject[] = projects.map((p) => {
    const months = projectMonths(p.startDate, p.endDate);
    const accessible = canSee(p.id);
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      departmentId: p.departmentId,
      parentId: p.parentId,
      period: [months[0], months[months.length - 1]],
      dates: formatPeriod(p.startDate, p.endDate),
      pms: sortPeople(p.members.filter((m) => m.isPm), (m) => m.user).map((m) => m.user.name),
      memberCount: p.members.length,
      accessible,
      planned: accessible ? plannedBy.get(p.id) ?? 0 : null,
      spent: accessible ? spentBy.get(p.id) ?? 0 : null,
    };
  });
  return { depts: tree, people, projects: orgProjects };
}
