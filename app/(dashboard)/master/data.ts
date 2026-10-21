import "server-only";
import { sortPeople } from "@/lib/org";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { orderTree } from "@/lib/hierarchy";
import { PHASE_LABEL, projectPhase } from "@/lib/lifecycle";
import { USER_SELECT } from "@/lib/users";
import { parseRole } from "@/lib/types";
import { ensurePassCategory } from "@/lib/pass-statement-server";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";

/**
 * 기준 정보·프로젝트 체계도(만들기)·조직도(계정 관리)가 같이 쓰는 조회 — 화면 배치만 나눴고 데이터는 같다.
 * 재무 승인·시스템 관리자 화면에서만 부른다 (호출하는 화면이 권한을 확인).
 */
const loadCategories = () => prisma.category.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], include: { items: { orderBy: [{ order: "asc" }, { name: "asc" }] } } });

export async function loadCategoriesEnsured() {
  // 출입증 분류가 없을 때만 만든다 (최초 1회)
  const loaded = await loadCategories();
  if (loaded.some((c) => c.id === PASS_CATEGORY_ID)) return loaded;
  await ensurePassCategory();
  return loadCategories();
}

export async function loadAdminUsers() {
  const users = await prisma.user.findMany({ select: USER_SELECT }).then((list) => sortPeople(list, (u) => u));
  return users.map((u) => ({
    ...u,
    role: parseRole(u.role) ?? "MEMBER",
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    tempPasswordExpiresAt: u.tempPasswordExpiresAt?.toISOString() ?? null,
    joinDate: u.joinDate ? formatDate(u.joinDate) : null,
  }));
}

/** PM 후보·팀원 표시용 사람 목록 (직급 → 성명 순) — 계정 관리 칸(사번·입사일·잠금·로그인 기록 등)은 읽지 않는다 */
export async function loadPeople() {
  const users = await prisma.user.findMany({ select: { id: true, name: true, loginId: true, role: true, position: true, departmentId: true, active: true } })
    .then((list) => sortPeople(list, (u) => u));
  return users.map((u) => ({ ...u, role: parseRole(u.role) ?? "MEMBER" }));
}

export const loadDepartments = () => prisma.department.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] });

export async function loadMasterProjects() {
  const projects = await prisma.project.findMany({
    include: {
      members: true, department: { select: { name: true } }, series: { select: { name: true } },
      budgets: { select: { item: { select: { id: true, name: true } } } },
      _count: { select: { budgets: true } },
    },
    orderBy: { startDate: "desc" },
  });
  return orderTree(projects).map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    departmentName: p.department?.name ?? null,
    departmentId: p.departmentId,
    startDate: formatDate(p.startDate),
    endDate: formatDate(p.endDate),
    parentId: p.parentId,
    settleWithParent: p.settleWithParent,
    excelPrefix: p.excelPrefix,
    depth: p.depth,
    members: p.members.map((m) => ({ userId: m.userId, isPayer: m.isPayer, isPm: m.isPm })),
    phase: projectPhase(p),
    phaseLabel: PHASE_LABEL[projectPhase(p)],
    seriesName: p.series?.name ?? null,
    round: p.round,
    closed: !!p.closedAt,
    archived: !!p.archivedAt,
    budgetItems: [...new Map(p.budgets.map((b) => [b.item.id, b.item])).values()],
    budgetLineCount: p._count.budgets,
    passEnabled: p.clientPassEnabled,
    passName: p.clientPassName,
  }));
}
