// 정산·예산 집계 조회 (서버 전용). 계산 자체는 lib/settlement.ts 순수함수에 위임한다.
import "server-only";
import { sortPeople } from "./org";
import { prisma } from "./db";
import { pendingPassChecks } from "./pass-statement-server";
import { currentYearMonth, formatDate, projectMonths, seoulTodayDate } from "./format";
import { isCurrentMember, servedInMonth } from "./membership";
import { proRate } from "./lifecycle";
import { budgetSummary, forecastTotal, monthlyByItem, payerUsage, settle, totalByMonth, type AmountRow, type SettlementInput } from "./settlement";
import { budgetLinesOf, budgetMonthSums, closingRows, expenseMonthSums, passCompanyLines, projectMembersOf } from "./queries";
import { applyPassDup } from "./pass-budget";
import { inputMemberIds, pmIds } from "./input-capable";
import { sqlDashItems, sqlDashLines, sqlInputSources, sqlPayerMonthSums, sqlProjectPeriods, sqlTodoExpenses, sqlUserInfo } from "./sql-loaders";
import { revokedMonths } from "./closing-server";
import { parseClosingStatus } from "./types";
import { bundleAlias, bundleLabel, bundleMembers, type BundleLine } from "./budget-bundle";

/** 결제자 마스터 (isPayer=true, 본사 역할 제외) — 여러 프로젝트(하위 포함 취합)면 합집합. leftAt: 이전 팀원의 철수일 (월별로 servedInMonth로 거른다) */
export async function getPayers(projectId: string | string[]) {
  const ids = Array.isArray(projectId) ? projectId : [projectId];
  // 비활성(퇴사·휴직) 사용자는 제외 — 그 달 지출이 있으면 '결제자 목록 외'로 이름이 나온다
  // (팀원 전체 조회를 요청 안에서 함께 쓴다 — 결제자·본사 역할·활성 조건은 여기서 거름)
  const members = (await projectMembersOf(ids.join(","))).filter((m) => m.isPayer && m.user.role !== "HQ" && m.user.active);
  // 여러 프로젝트에 걸친 사람은 가장 늦은 철수일 (어느 한 곳이라도 현재 팀원이면 null)
  const leftOf = new Map<string, Date | null>();
  for (const m of members) {
    const prev = leftOf.get(m.user.id);
    leftOf.set(m.user.id, prev === null || m.leftAt === null ? null : prev && prev > m.leftAt ? prev : m.leftAt);
  }
  // 직급 → 성명 순
  return [...new Map(sortPeople(members, (m) => m.user).map((m) => [m.user.id, { id: m.user.id, name: m.user.name, position: m.user.position, leftAt: leftOf.get(m.user.id) ?? null }])).values()];
}

/** 정산에 쓰는 지출 칸 (결제자 이름 포함) */
type SettleRow = SettlementInput & { payerName: string };

/**
 * 월 정산 (결제자별)
 * @param loaded 호출부가 이미 읽은 그 달의 전체 지출 (같은 프로젝트·월, 범위 제한 없음 — 다시 조회하지 않음)
 */
export async function getSettlement(projectId: string | string[], yearMonth: string, loaded?: Promise<SettleRow[]>) {
  const ids = Array.isArray(projectId) ? projectId : [projectId];
  const [expenses, payers] = await Promise.all([
    loaded ?? prisma.expense.findMany({ where: { projectId: { in: ids }, yearMonth }, include: { payer: { select: { name: true } } } })
      .then((list) => list.map((e) => ({ ...e, payerName: e.payer.name }))),
    getPayers(projectId),
  ]);
  // 이전 팀원은 철수한 달까지만 결제자 열에 (지출이 있으면 그 달에는 이름이 나온다)
  const result = settle(expenses, payers.filter((p) => servedInMonth(p, yearMonth)).map((p) => p.id));
  // 결제자 마스터에 없는 사람이 결제한 경우도 이름 표시
  const names = new Map<string, string>(payers.map((p) => [p.id, p.name]));
  for (const e of expenses) if (!names.has(e.payerId)) names.set(e.payerId, e.payerName);
  // 결제자 순서(직급 → 성명), 결제자 마스터에 없는 사람은 뒤에 이름순
  const order = new Map(payers.map((p, i) => [p.id, i]));
  const rows = Object.entries(result.byPayer).map(([id, amount]) => ({ id, name: names.get(id) ?? id, amount }))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || a.name.localeCompare(b.name, "ko"));
  return { ...result, rows, count: expenses.length };
}

export async function getClosings(projectId: string) {
  const closings = await closingRows(projectId);
  return new Map(closings.map((c) => [c.yearMonth, { yearMonth: c.yearMonth, status: c.status }]));
}

/**
 * 프로젝트별·항목별·월별 지출 합계 (같은 요청 안에서 한 번만) — 예산 집계는 지출 행 대신 합계로 계산한다.
 * @param idsKey 프로젝트 id를 쉼표로 이은 값 (요청 캐시 키는 원시값)
 */
export { expenseMonthSums };

export type DashboardInput<P extends { id: string; startDate: Date; endDate: Date }> = {
  project: P;
  /** 함께 취합할 하위 프로젝트 (기간 포함) */
  children: { id: string; startDate: Date; endDate: Date }[];
  /** periods(기간·회)가 없으면 매월 항목으로 본다 */
  lines: (BundleLine & { projectId: string; planned: number; periods?: number })[];
  /** 지출 행 또는 프로젝트·항목·월 합계 행 */
  expenses: (AmountRow & { projectId: string })[];
  /** 분류 순서 → 항목 순서로 정렬된 항목 */
  items: { id: string; name: string; code?: string | null; projectId: string | null; categoryId: string; active: boolean; accountCode: string | null; category: { name: string } }[];
  closings: Map<string, { status: string }>;
  /** 이번 달 (소진 예측 경과 개월 기준) */
  now: string;
};

/**
 * 예산 대비 집행 현황 계산 (순수함수)
 * 취합(children 있음)이면 항목은 프로젝트마다 따로 있으므로 항목 코드(없으면 '분류+항목명')로 합친다.
 */
export function buildDashboard<P extends { id: string; startDate: Date; endDate: Date }>(x: DashboardInput<P>) {
  const { project, children, closings, now } = x;
  const projectId = project.id;
  const merged = children.length > 0;
  // 하위 프로젝트는 이 프로젝트 기간에 해당하는 월만 귀속 (연차를 넘는 서브는 연차별로 나뉜다)
  // 예산도 같은 비율로 나눈다: 계획 × (귀속 개월 / 하위 전체 개월), 끝전은 마지막 연차에
  const months = projectMonths(project.startDate, project.endDate);
  const inPeriod = new Set(months);
  const childOf = new Map(children.map((c) => [c.id, c]));
  const lines = x.lines.map((l) => {
    if (l.projectId === projectId) return l;
    const c = childOf.get(l.projectId);
    return { ...l, planned: c ? proRate(l.planned, c, project) : 0 };
  });
  const expenses = x.expenses.filter((e) => e.projectId === projectId || inPeriod.has(e.yearMonth));
  const rawItems = x.items;
  // 항목 키: 단일 프로젝트는 항목 id, 취합이면 항목 코드(같은 코드 = 같은 항목 — 메인 항목 가져오기로 맞춘다), 코드가 없으면 분류+항목명
  const keyOf = new Map(rawItems.map((it) => [it.id, merged ? (it.code ? `code:${it.code.toLowerCase()}` : `${it.categoryId}|${it.name}`) : it.id]));
  // 묶음 예산: 묶인 항목의 지출은 대표 항목으로 (프로젝트별 예산 행 기준)
  const alias = bundleAlias(x.lines);
  const members = bundleMembers(x.lines);
  const key = (itemId: string) => { const k = alias.get(itemId) ?? itemId; return keyOf.get(k) ?? k; };
  const nameOfId = new Map(rawItems.map((it) => [it.id, it.name]));
  const bundleNames = new Map([...members].map(([primary, extras]) => [key(primary), extras.map((id) => nameOfId.get(id) ?? id)]));
  // 분류 전체 예산: 대표 항목 묶음이 그 분류의 (사용 중인) 항목을 모두 덮으면 분류 이름으로 표시
  const wholeCategory = new Set(
    [...members].filter(([primary, extras]) => {
      const it = rawItems.find((i) => i.id === primary);
      if (!it) return false;
      const cat = rawItems.filter((i) => i.projectId === it.projectId && i.categoryId === it.categoryId && i.active && i.id !== primary);
      return cat.length > 0 && cat.every((i) => extras.includes(i.id));
    }).map(([primary]) => key(primary)),
  );
  // 키별 대표 정보: 묶음이면 대표 항목 자신(묶인 항목 이름으로 덮지 않음), 그 외는 처음 나온 항목
  const itemByKey = new Map<string, (typeof rawItems)[number]>();
  for (const it of rawItems) {
    const k = key(it.id);
    if (!itemByKey.has(k) || (alias.has(itemByKey.get(k)!.id) && !alias.has(it.id))) itemByKey.set(k, it);
  }
  const items = [...itemByKey].map(([k, it]) => ({ ...it, id: k }));
  const calc = expenses.map((e) => ({ ...e, itemId: key(e.itemId) }));
  const summary = budgetSummary(lines.map((l) => ({ itemId: key(l.itemId), planned: l.planned })), calc);
  const monthly = monthlyByItem(calc);
  const byMonth = totalByMonth(calc);
  const elapsed = months.filter((m) => m <= now).length;
  // 매월 항목: 그 키의 예산 행이 모두 (행이 속한 프로젝트의) 기간 개월수 이상 — 아니면 비정기(월별 보기에서 누적으로)
  const monthCount = new Map<string, number>([[projectId, months.length], ...children.map((c) => [c.id, projectMonths(c.startDate, c.endDate).length] as [string, number])]);
  const irregular = new Set(
    x.lines.filter((l) => l.periods !== undefined && l.periods < (monthCount.get(l.projectId) ?? months.length)).map((l) => key(l.itemId)),
  );
  const itemOrder = new Map(items.map((it, i) => [it.id, i]));
  const itemInfo = new Map(items.map((it) => [it.id, it]));

  const rows = summary.rows
    .sort((a, b) => (itemOrder.get(a.itemId) ?? 0) - (itemOrder.get(b.itemId) ?? 0))
    .map((r) => {
      const it = itemInfo.get(r.itemId);
      const extras = bundleNames.get(r.itemId) ?? [];
      return {
        ...r,
        itemName: it
          ? wholeCategory.has(r.itemId) ? `${it.category.name} (분류 전체)`
            : extras.length ? bundleLabel(it.name, extras) : it.name
          : r.itemId,
        /** 묶음이면 대표 항목 외에 함께 묶인 항목 이름 (엑셀 월별 수식에 사용) */
        bundleItemNames: extras,
        baseItemName: it?.name ?? r.itemId,
        categoryName: it?.category.name ?? "",
        accountCode: it?.accountCode ?? null,
        months: months.map((ym) => monthly[r.itemId]?.[ym] ?? 0),
        forecast: forecastTotal(months.map((ym) => monthly[r.itemId]?.[ym] ?? 0), elapsed),
        /** 매월 쓰는 항목 (기간(회) ≥ 프로젝트 개월수) — false면 일부 달에만 쓰는 비정기 항목 */
        regular: !irregular.has(r.itemId),
      };
    });

  // 분류별 소계
  const byCategory = new Map<string, { name: string; planned: number; spent: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.categoryName) ?? { name: r.categoryName, planned: 0, spent: 0 };
    c.planned += r.planned;
    c.spent += r.spent;
    byCategory.set(r.categoryName, c);
  }

  return {
    project,
    months,
    rows,
    categories: [...byCategory.values()],
    totals: {
      planned: summary.totalPlanned,
      spent: summary.totalSpent,
      remaining: summary.totalRemaining,
      rate: summary.totalRate,
      forecast: forecastTotal(months.map((ym) => byMonth[ym] ?? 0), elapsed),
    },
    trend: months.map((ym) => ({
      yearMonth: ym,
      amount: byMonth[ym] ?? 0,
      status: parseClosingStatus(closings.get(ym)?.status),
    })),
  };
}

/** 대시보드 계산에 쓰는 칸만 (buildDashboard 입력) */
export const DASH_LINE_SELECT = { projectId: true, itemId: true, planned: true, periods: true, bundleItemIds: true } as const;
export const DASH_ITEM_SELECT = { id: true, name: true, code: true, projectId: true, categoryId: true, active: true, accountCode: true, category: { select: { name: true } } } as const;
/** 분류 순서 → 항목 순서 */
export const DASH_ITEM_ORDER = [{ category: { order: "asc" } }, { category: { name: "asc" } }, { order: "asc" }, { name: "asc" }] as const;

type ProjectRow = Awaited<ReturnType<typeof prisma.project.findUniqueOrThrow>>;

/**
 * 예산 대비 집행 현황
 * @param withIds 함께 취합할 하위 프로젝트 id
 * @param loaded 호출부가 이미 읽은 프로젝트 (다시 조회하지 않음)
 * @param only 이 프로젝트들의 예산·지출만 (구분 필터 — 기간·월 귀속은 projectId 기준 그대로)
 */
export async function getDashboard(projectId: string, withIds: string[] = [], loaded?: ProjectRow, only?: string[]) {
  const ids = [projectId, ...withIds];
  const [project, lines, expenses, items, closings, children] = await Promise.all([
    loaded ?? prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    // 직접 SQL (DASH_LINE_SELECT·DASH_ITEM_SELECT/ORDER와 같은 칸·순서 — 현황이 매 요청 쓴다)
    sqlDashLines(ids),
    // 예산 집행 = 카드 지출 + 출입증 확정분 (연결 예산 항목)
    budgetMonthSums(ids.join(",")),
    sqlDashItems(ids),
    getClosings(projectId),
    sqlProjectPeriods(withIds),
  ]);
  const keep = only && new Set(only);
  return buildDashboard({
    project, children, closings, now: currentYearMonth(),
    lines: keep ? lines.filter((l) => keep.has(l.projectId)) : lines,
    expenses: keep ? expenses.filter((e) => keep.has(e.projectId)) : expenses,
    items: keep ? items.filter((i) => !!i.projectId && keep.has(i.projectId)) : items,
  });
}

/**
 * PM "이번 달 할 일" 입력 데이터 (계산은 lib/todo.ts buildTodos)
 * @param scopeIds 팀원별 정산 카드의 범위 (현황의 구분·하위 취합) — 그 범위의 '입력 대상 팀원'·PM도 함께 돌려준다
 */
export async function getTodoData(projectId: string, upToYm: string, groupIds: string[] = [projectId], scopeIds: string[] = groupIds) {
  const today = seoulTodayDate();
  const [budgetCount, sources, members, expenses, closings, passChecks, groupMembers, scopeMembers] = await Promise.all([
    // 예산 행은 입력 화면 조회와 함께 쓴다 (요청 안에서 한 번)
    budgetLinesOf(projectId).then((l) => l.length),
    // 입력 항목의 근거 (예산·팀원 지출 항목·과업 담당 항목) — 함께 상신·정산 범위 전체를 한 번에
    sqlInputSources([...new Set([projectId, ...groupIds, ...scopeIds])]),
    // 현재 팀원(본사 역할 제외) — 팀원 전체 조회를 함께 쓴다
    projectMembersOf(projectId).then((list) => sortPeople(
      list.filter((m) => m.user.role !== "HQ" && isCurrentMember(m, today))
        .map((m) => ({ isPm: m.isPm, isPayer: m.isPayer, user: { id: m.user.id, name: m.user.name, active: m.user.active, position: m.user.position } })),
      (m) => m.user,
    )),
    // 규정 점검: 출입증 중복 의심은 지금 출입증 결정 기준으로 다시 계산 (lib/pass-budget withPassDup)
    // 메인과 함께 상신하는 서브 지출 포함 (groupIds) — 마감 준비 점검(소명 없음 등)은 함께 상신하는 범위 전체
    Promise.all([sqlTodoExpenses(groupIds, upToYm), passCompanyLines(groupIds.join(","))])
      .then(([rows, pass]) => applyPassDup(rows.map((e) => ({ ...e, date: formatDate(e.date) })), pass)),
    closingRows(projectId).then(async (rows) => {
      // 반려 중 승인 취소로 돌아온 달은 할 일 문구를 '승인 취소됨'으로 (반려 상태가 없으면 조회 안 함)
      const revoked = await revokedMonths(rows);
      return rows.map((r) => ({ ...r, revoked: revoked.has(r.yearMonth) }));
    }),
    pendingPassChecks(projectId),
    // 팀원 전체 조회는 결제자 조회(getPayers)와 같은 키라 요청 안에서 함께 쓴다 (추가 조회 없음)
    projectMembersOf(groupIds.join(",")),
    projectMembersOf(scopeIds.join(",")),
  ]);
  const team = members.filter((m) => !m.isPm);
  // 미입력 확인 대상은 자기에게 열린 지출 항목이 있는 팀원만 (항목이 없는 팀원 지출은 PM이 입력한다)
  const groupTargets = inputMemberIds(groupMembers, sources);
  const payers = team.filter((m) => m.isPayer && m.user.active && groupTargets.has(m.user.id)).map((m) => ({ id: m.user.id, name: m.user.name }));
  // 미입력 확인 대상: 함께 상신하는 서브의 현재 결제자도 (메인 다음, 직급 → 성명)
  if (groupIds.length > 1) {
    // (현황의 팀원별 사용과 같은 팀원 조회를 함께 쓴다 — 메인 팀원은 위에서 정한 대로)
    for (const p of await getPayers(groupIds)) {
      if (p.leftAt === null && groupTargets.has(p.id) && !members.some((m) => m.user.id === p.id) && !payers.some((x) => x.id === p.id)) payers.push({ id: p.id, name: p.name });
    }
  }
  return {
    setup: { hasBudget: budgetCount > 0, hasMemberItems: sources.some((s) => s.projectId === projectId && s.kind === "member"), hasMembers: team.length > 0 },
    payers,
    /** 팀원별 정산 범위의 입력 대상 팀원 · PM (정산 카드의 '미입력' 표시·알림 문구) */
    settleTargets: inputMemberIds(scopeMembers, sources),
    settlePms: pmIds(scopeMembers),
    expenses,
    closings,
    passChecks,
  };
}

/** 프로젝트 PM 이름 (빈 화면·마감 안내에 표시) */
export async function getPmNames(projectId: string) {
  const pms = (await projectMembersOf(projectId)).filter((m) => m.isPm);
  return sortPeople(pms, (p) => p.user).map((p) => p.user.name);
}

/** 예산 행 비교용 칸 */
type BudgetAuditLine = { itemId: string; detail: string; unitPrice: number; periods: number; changeId: string | null; bundleItemIds: string | null };

/**
 * 예산 일괄 저장 감사 기록용 요약 (순수함수) — 전체 행 대신 행 수·계획 합계·바뀐 항목 id만 남긴다.
 * 항목별 행 구성(상세·단가·기간·과업·묶음)이 달라진 항목을 changedItemIds로 (추가·삭제 포함, 순서만 바뀐 것은 제외)
 */
export function budgetAuditSummary(before: BudgetAuditLine[], after: (BudgetAuditLine & { planned: number })[]) {
  const sig = (lines: BudgetAuditLine[]) => {
    const m = new Map<string, string[]>();
    for (const l of lines) {
      const list = m.get(l.itemId) ?? [];
      list.push(JSON.stringify([l.detail, l.unitPrice, l.periods, l.changeId ?? null, l.bundleItemIds ?? null]));
      m.set(l.itemId, list);
    }
    return new Map([...m].map(([k, v]) => [k, v.sort().join("\n")]));
  };
  const a = sig(before);
  const b = sig(after);
  const changedItemIds = [...new Set([...a.keys(), ...b.keys()])].filter((id) => a.get(id) !== b.get(id)).sort();
  return { count: after.length, prevCount: before.length, planned: after.reduce((s, l) => s + l.planned, 0), changedItemIds };
}

/**
 * 팀원별 그 달 사용 (PM 홈) — 본사 지출 제외, 결제방법 무관 결제자별 합계.
 * 결제자 전원(그 달 재직)을 0원으로 포함하고, 입력이 없으면 entered=false.
 */
export async function getPayerMonth(projectId: string | string[], yearMonth: string) {
  const ids = Array.isArray(projectId) ? projectId : [projectId];
  const [groups, payers] = await Promise.all([
    sqlPayerMonthSums(ids, yearMonth),
    getPayers(projectId),
  ]);
  const known = new Map(payers.map((p) => [p.id, p.name]));
  const unknown = groups.map((g) => g.payerId).filter((id) => !known.has(id));
  const extra = unknown.length ? await sqlUserInfo(unknown) : [];
  for (const u of extra) known.set(u.id, u.name);
  return payerUsage(
    payers.filter((p) => servedInMonth(p, yearMonth)),
    groups.map((g) => ({ payerId: g.payerId, name: known.get(g.payerId) ?? "-", amount: g.amount, count: g.count })),
  );
}
