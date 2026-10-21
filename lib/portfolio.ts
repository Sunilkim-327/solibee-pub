// 재무 승인용 전체 프로젝트 현황 집계 (서버 전용)
import "server-only";
import { accessibleProjects, isHqLike, type SessionUser } from "./access";
import { prisma, toNumber } from "./db";
import { currentYearMonth, projectMonths, formatPeriod, seoulTodayDate } from "./format";
import { PHASE_LABEL, closeBlockers, type ProjectPhase } from "./lifecycle";
import { buildTree, flattenTree, sortPeople } from "./org";
import { budgetSummary } from "./settlement";
import { currentMemberWhere } from "./membership";
import { parseClosingStatus, type ClosingStatus } from "./types";
import { budgetKey, bundleAlias } from "./budget-bundle";
import { sqlPassCompanyLines } from "./sql-loaders";
import { passBudgetSpend } from "./pass-budget";
import { isSettleChild, mergeSettleClosings, settleParentIds } from "./settle-group";

export type PortfolioRow = {
  id: string;
  name: string;
  code: string | null;
  departmentId: string | null;
  departmentPath: string;
  pms: string[];
  memberCount: number;
  period: [string, string];
  /** 표시용 기간 (일자까지) */
  dates: string;
  /** 진행 중이 아니면 단계 표시 (시작 전·종료 대기·종료) */
  phaseLabel: string | null;
  phase: ProjectPhase;
  /** 예산(단가·기간) 등록 여부 */
  hasBudget: boolean;
  /** 종료 대기 중이고 종료를 막는 사유가 없음 */
  closable: boolean;
  planned: number;
  spent: number;
  remaining: number;
  rate: number | null;
  timeRate: number;
  thisMonth: { ym: string; status: ClosingStatus; amount: number } | null;
  submitted: string[];
  rejected: string[];
  /** 프로젝트 월 목록 */
  months: string[];
  /** 월 → 마감 상태 (기록 없는 달은 빠짐 = 작성중) */
  statuses: Record<string, ClosingStatus>;
  /** 월 → 지출 합계 */
  monthSpent: Record<string, number>;
  /** 월 → 규정 점검(소명 필요) 건수 */
  flagged: Record<string, number>;
};

/** 지출 합계 행 (프로젝트·항목·월) — budgetSummary에는 itemId·amount만 쓰인다 */
export type SpentRow = { projectId: string; itemId: string; yearMonth: string; amount: number };

/** projectId별로 한 번에 묶기 (프로젝트마다 전체 목록을 다시 거르지 않게) */
export function bucketByProject<T extends { projectId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.projectId);
    if (list) list.push(r);
    else out.set(r.projectId, [r]);
  }
  return out;
}

export async function getPortfolio(user: SessionUser): Promise<PortfolioRow[]> {
  const projects = await accessibleProjects(user);
  // 재무 승인·시스템 관리자는 전체 프로젝트를 보므로 id 목록 조건 없이 조회 (IN 목록이 커지지 않게)
  const where = isHqLike(user) ? {} : { projectId: { in: projects.map((p) => p.id) } };
  const [lines, spentGroups, closings, members, depts, openPass, flagGroups, passLines] = await Promise.all([
    prisma.budgetLine.findMany({ where, select: { projectId: true, itemId: true, planned: true, bundleItemIds: true } }),
    // 지출은 행 전체 대신 프로젝트·항목·월 합계만
    prisma.expense.groupBy({ by: ["projectId", "itemId", "yearMonth"], where, _sum: { amount: true } }),
    prisma.monthlyClosing.findMany({ where, select: { projectId: true, yearMonth: true, status: true } }),
    prisma.projectMember.findMany({
      where: { ...where, ...currentMemberWhere(seoulTodayDate()) },
      select: { projectId: true, isPm: true, user: { select: { name: true, role: true, position: true } } },
    }),
    prisma.department.findMany({ select: { id: true, name: true, parentId: true, order: true } }),
    prisma.passStatement.findMany({ where: { ...where, status: "OPEN" }, select: { projectId: true, yearMonth: true } }),
    // 규정 점검 건 (월별 소명 필요)
    prisma.expense.groupBy({ by: ["projectId", "yearMonth"], where: { ...where, flags: { not: null } }, _count: true }),
    // 출입증 회사 부담 확정분 (연결 예산 항목) — 예산 집행에 더한다
    sqlPassCompanyLines(projects.map((p) => p.id)),
  ]);
  const nowDate = seoulTodayDate();
  const deptPath = new Map(flattenTree(buildTree(depts)).map((d) => [d.id, d.path]));
  const now = currentYearMonth();
  const linesOf = bucketByProject(lines);
  const spentOf = bucketByProject<SpentRow>(spentGroups.map((g) => ({ projectId: g.projectId, itemId: g.itemId, yearMonth: g.yearMonth, amount: toNumber(g._sum.amount) })));
  const passOfProject = bucketByProject<SpentRow>(passBudgetSpend(passLines).confirmedRows);
  const closingsOf = bucketByProject(closings);
  // 메인과 함께 상신하는 서브: 마감 상태는 그 달 메인의 상태 (표시·종료 판단). 승인 대기·반려 목록은 메인에만 (중복 안내 방지)
  const effective = (id: string) => {
    const parents = settleParentIds(projects, id);
    const own = closingsOf.get(id) ?? [];
    return parents.length ? mergeSettleClosings(own, parents.flatMap((pid) => closingsOf.get(pid) ?? [])) : own;
  };
  const membersOf = bucketByProject(members);
  const passOf = bucketByProject(openPass);
  const flagsOf = bucketByProject(flagGroups);

  return projects.map((p) => {
    const own = linesOf.get(p.id) ?? [];
    const alias = bundleAlias(own);
    // 합계 행에는 결제 정보가 없다 — budgetSummary는 itemId·amount만 쓰므로 빈 값으로 채움
    const ex = (spentOf.get(p.id) ?? []).map((e) => ({ ...e, itemId: budgetKey(alias, e.itemId), payMethod: "", isHq: false, payerId: "" }));
    // 예산 집행 = 카드 + 출입증 확정분 (종료 가능 판단은 카드 지출 달 기준 그대로)
    const spend = [...ex, ...(passOfProject.get(p.id) ?? []).map((e) => ({ ...e, itemId: budgetKey(alias, e.itemId) }))];
    const b = budgetSummary(own, spend);
    const months = projectMonths(p.startDate, p.endDate);
    const elapsed = months.filter((m) => m <= now).length;
    const pc = effective(p.id);
    const settleChild = isSettleChild(p);
    const ym = months.includes(now) ? now : null;
    const pm = membersOf.get(p.id) ?? [];
    return {
      id: p.id,
      name: p.name,
      phaseLabel: p.phase === "ACTIVE" ? null : PHASE_LABEL[p.phase],
      phase: p.phase,
      hasBudget: own.length > 0,
      closable: p.phase === "WRAPUP" && closeBlockers(p, pc, [...new Set(ex.map((e) => e.yearMonth))], nowDate, (passOf.get(p.id) ?? []).map((x) => x.yearMonth)).length === 0,
      code: p.code,
      departmentId: p.departmentId,
      departmentPath: p.departmentId ? deptPath.get(p.departmentId) ?? "" : "",
      pms: sortPeople(pm.filter((m) => m.isPm), (m) => m.user).map((m) => m.user.name),
      memberCount: pm.length,
      period: [months[0], months[months.length - 1]],
      dates: formatPeriod(p.startDate, p.endDate),
      planned: b.totalPlanned,
      spent: b.totalSpent,
      remaining: b.totalRemaining,
      rate: b.totalRate,
      timeRate: Math.round((elapsed / months.length) * 1000) / 10,
      thisMonth: ym
        ? {
            ym,
            status: parseClosingStatus(pc.find((c) => c.yearMonth === ym)?.status),
            amount: spend.filter((e) => e.yearMonth === ym).reduce((a, e) => a + e.amount, 0),
          }
        : null,
      submitted: settleChild ? [] : pc.filter((c) => c.status === "SUBMITTED").map((c) => c.yearMonth).sort(),
      rejected: settleChild ? [] : pc.filter((c) => c.status === "REJECTED").map((c) => c.yearMonth).sort(),
      months,
      statuses: Object.fromEntries(pc.map((c) => [c.yearMonth, parseClosingStatus(c.status)])),
      monthSpent: spend.reduce<Record<string, number>>((a, e) => ({ ...a, [e.yearMonth]: (a[e.yearMonth] ?? 0) + e.amount }), {}),
      flagged: Object.fromEntries((flagsOf.get(p.id) ?? []).map((g) => [g.yearMonth, g._count])),
    };
  });
}
