import { ProjectBudget, type BudgetItem, type BudgetLineInit, type PassCompany } from "@/components/ProjectBudget";
import { PageHeader } from "@/components/common";
import { BackTo } from "@/components/BackTo";
import { Icon } from "@/components/icons";
import { expenseMonthSums, getDashboard } from "@/lib/reports";
import { passCompanyLines } from "@/lib/queries";
import { passBudgetSpend } from "@/lib/pass-budget";
import { pageContext, projectRows } from "@/lib/access";
import { prisma } from "@/lib/db";
import { currentYearMonth, projectMonths, toYearMonth, ymKo } from "@/lib/format";
import { canEditBudget } from "@/lib/rules";
import { resolveYm } from "@/lib/master";
import { parseBundle } from "@/lib/budget-bundle";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";
import { ImportParentItems } from "@/components/budget/ImportParentItems";
import { BudgetMonthNav } from "@/components/budget/BudgetMonthNav";
import { wantedYm } from "@/lib/page-ctx-server";

/**
 * 프로젝트 운영비 — 이 프로젝트의 항목·예산을 관리하는 단 하나의 화면
 * (재무 승인 편집 / PM·조회 권한은 보기). 항목별 단가 × 기간(쓸 수 있는 횟수) = 계획, 지출, 잔액, 월별 사용.
 * 회사 공통 분류·공통 항목은 기준 정보 → 분류·항목 관리.
 */
/** ?view=monthly — 월별 보기로 열기 (현황 월 요약의 링크) · ?ym= 월별 보기에서 고른 달 */
export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ from?: string; view?: string; ym?: string }> }) {
  const { from, view, ym: ymParam } = await searchParams;
  const { user, project } = await pageContext(["MANAGER", "HQ", "ADMIN"]);
  const [d, lines, monthlyRows, items, categories, templates, changes, passLines, nodes] = await Promise.all([
    // 전체 집행·추이 (대시보드와 같은 집계 — 묶음 예산·종료 시 예상 포함)
    getDashboard(project.id, [], project),
    prisma.budgetLine.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" } }),
    // 항목×월 지출 합계 (getDashboard와 같은 조회를 함께 쓴다)
    expenseMonthSums(project.id),
    prisma.item.findMany({ where: { projectId: project.id }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
    prisma.category.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.item.findMany({ where: { projectId: null, active: true }, select: { id: true, name: true, code: true, categoryId: true, perPersonLimit: true } }),
    prisma.contractChange.findMany({ where: { projectId: project.id }, orderBy: { seq: "asc" }, select: { id: true, seq: true, title: true, startDate: true } }),
    // 출입증 회사 부담 (현황 집계와 같은 조회 — 연결 예산 항목의 확정분은 집행에 더한다)
    passCompanyLines(project.id),
    // 상위(메인) 프로젝트 이름 — 서브면 '메인 항목 가져오기' (요청 안에서 읽은 전체 프로젝트를 다시 쓴다)
    projectRows(),
  ]);
  const parent = project.parentId ? nodes.find((n) => n.id === project.parentId) ?? null : null;
  const readOnly = !canEditBudget(user.role) || !!user.readOnly;
  const months = projectMonths(project.startDate, project.endDate);
  const now = currentYearMonth();
  const elapsed = months.filter((m) => m <= now).length;
  // 월별 보기의 달: ?ym= → 마지막 본 달(쿠키) → 이번 달
  const ym = resolveYm(await wantedYm(ymParam, months), months);
  const original = lines.filter((l) => !l.changeId).reduce((a, l) => a + l.planned, 0);
  const delta = lines.filter((l) => l.changeId).reduce((a, l) => a + l.planned, 0);

  // 항목×월 합계 하나로 월별·항목별 집행을 함께 만든다 — 집행 = 카드 + 출입증 확정분(연결 예산 항목, 출입증 내역 월)
  const pass = passBudgetSpend(passLines);
  const monthly: Record<string, Record<string, number>> = {};
  const spent: Record<string, number> = {};
  for (const r of [...monthlyRows, ...pass.confirmedRows]) {
    const v = r.amount;
    (monthly[r.itemId] ??= {})[r.yearMonth] = (monthly[r.itemId]?.[r.yearMonth] ?? 0) + v;
    spent[r.itemId] = (spent[r.itemId] ?? 0) + v;
  }

  const toItem = (i: (typeof items)[number]): BudgetItem => ({
    id: i.id, name: i.name, code: i.code, categoryId: i.categoryId, perPersonLimit: i.perPersonLimit, hardBudget: i.hardBudget, needsAttendees: i.needsAttendees, active: i.active, linkedItemId: i.linkedItemId,
  });
  // 출입증 항목별 회사 부담: 확정된 달 합계·월별, 확정 전 합계 (결정됨 + 팀원 요청)
  const passCompany: Record<string, PassCompany> = pass.byPassItem;

  return (
    <div>
      <PageHeader title="프로젝트 운영비"
        desc={readOnly ? "항목별 배정과 집행 현황입니다. 예산은 재무 승인 담당이 등록합니다." : undefined}
        // 월 이동은 월별 보기일 때만 (다른 월 화면과 같은 자리)
        month={<BudgetMonthNav months={months} value={ym} />}>
        {!readOnly && parent && <ImportParentItems projectId={project.id} parentName={parent.name} settleWithParent={project.settleWithParent} />}
        {readOnly && user.readOnlyReason !== "view" && <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-fg-muted">{user.readOnlyReason === "closed" ? <><Icon name="lock" className="size-3.5" />종료된 프로젝트</> : user.readOnlyReason === "admin" ? "시스템 관리자 조회" : "조회 전용"}</span>}
      </PageHeader>
      {/* 마감 준비·재무 승인 검토의 "연결 예산 항목" 안내에서 온 경우 — 그 달(?ym=)로 돌아간다 */}
      <BackTo from={from} ym={ymParam && months.includes(ymParam) ? ymParam : undefined} />
      <ProjectBudget
        // 항목 가져오기 뒤에는 새 항목으로 다시 그린다
        key={`${project.id}:${items.length}`}
        projectId={project.id}
        readOnly={readOnly}
        period={{ start: months[0] ?? "", end: months[months.length - 1] ?? "", months: months.length }}
        months={months.map((ym, i) => ({ ym, label: i === 0 || ym.endsWith("-01") ? ymKo(ym) : `${Number(ym.slice(5))}월` }))}
        categories={categories.filter((c) => c.id !== PASS_CATEGORY_ID)}
        items={items.filter((i) => i.categoryId !== PASS_CATEGORY_ID).map(toItem)}
        passItems={items.filter((i) => i.categoryId === PASS_CATEGORY_ID).map(toItem)}
        passEnabled={project.clientPassEnabled}
        templates={templates.filter((t) => t.categoryId !== PASS_CATEGORY_ID)}
        passTemplates={templates.filter((t) => t.categoryId === PASS_CATEGORY_ID)}
        passCompany={passCompany}
        initialLines={lines.map((l): BudgetLineInit => ({ itemId: l.itemId, detail: l.detail, unitPrice: l.unitPrice, periods: l.periods, changeId: l.changeId, bundleItemIds: parseBundle(l.bundleItemIds) }))}
        spent={spent}
        monthly={monthly}
        changes={changes.map((c) => ({ id: c.id, label: `변경 ${c.seq}차 · ${c.title}`, from: toYearMonth(c.startDate) }))}
        contract={changes.length ? { original, delta } : null}
        elapsed={elapsed}
        forecast={d.totals.forecast}
        closings={Object.fromEntries(d.trend.map((t) => [t.yearMonth, t.status]))}
        now={now}
        initialView={view === "monthly" ? "monthly" : "items"}
        ym={ym}
        burn={{ months: d.months, amounts: d.trend.map((t) => t.amount), statuses: d.trend.map((t) => t.status), now, elapsed }}
      />
    </div>
  );
}
