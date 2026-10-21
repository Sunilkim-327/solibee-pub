import Link from "next/link";
import { isUnexplained, needsReview } from "@/lib/policy";
import { LockNotice, PageHeader, StatusBadge } from "@/components/common";
import { SetupChecklist } from "@/components/SetupChecklist";
import { Icon } from "@/components/icons";
import { BackTo } from "@/components/BackTo";
import { ListRow } from "@/components/list/ListRow";
import { Meter, PaceTag, PACE_ICON } from "@/components/Meter";
import { MonthlyTable } from "@/components/MonthlyTable";
import { FilterRow, FilterTrigger, LEDGER_ID, LedgerFilterProvider, type LedgerFilters } from "@/components/list/LedgerFilter";
import { canManage, pageContext, type SessionUser } from "@/lib/access";
import { currentYearMonth, monthsLabel, projectMonths, seoulToday, won, ymKo } from "@/lib/format";
import { MonthNav } from "@/components/MonthNav";
import { wantedYm } from "@/lib/page-ctx-server";
import { monthAvailable, monthUsage, paceStatus, riskItems } from "@/lib/settlement";
import { getInputContext, getInputMaster, getInputTasks, getMaster, resolveYm } from "@/lib/master";
import { getClosings, getDashboard, getPayerMonth, getTodoData } from "@/lib/reports";
import { buildTodos, setupComplete, type TodoItem } from "@/lib/todo";
import { visibleSettlePayers } from "@/lib/input-capable";
import { canEditBudget, canSeeAllRows } from "@/lib/rules";
import { rollupScope } from "@/lib/scope";
import { PartFilter, ScopeToggle } from "@/components/ScopeToggle";
import { getSettlementRange } from "@/lib/settlement-range";
import { listExpenses } from "@/lib/expenses";
import { LedgerTabs, MyPassPanel } from "@/components/pass/MyPassPanel";
import { loadMyPassMonth } from "@/lib/pass-statement-server";
import { ledgerHref, PASS_TAB, passCheckHref, SETTLE_HASH } from "@/lib/page-access";
import { redirect } from "next/navigation";
import { closingStatusIn, isLocked, unlockHint } from "@/lib/closing";
import { memberInputOpen } from "@/lib/lifecycle";
import { MONTH_PHASE_LABEL, daysToDeadline, inputDeadlineLabel, inputDeadlineProblem, monthPhase } from "@/lib/month-phase";
import { PAY_METHOD_LABEL, type ClosingStatus } from "@/lib/types";
import { headers } from "next/headers";
import { prisma, sqlRows } from "@/lib/db";
import { closingRows } from "@/lib/queries";
import { revokedMonths } from "@/lib/closing-server";
import { memberExpectation } from "@/lib/pass-statement";
import { passItems } from "@/lib/pass-statement-server";
import { SummaryHead } from "@/components/list/SummaryBar";
import { SettlementMonthList } from "@/components/list/SettlementMonthList";
import { RemindButton } from "@/components/RemindSheet";
import type { RemindGroup } from "@/lib/remind";

const TODO_TONE: Record<TodoItem["tone"], string> = {
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-line bg-surface-muted text-fg",
};

/** 할 일 요약 글자 (접힌 머리줄) */
const TODO_SHORT: Record<TodoItem["key"], string> = {
  rejected: "반려", flag: "점검", noinput: "미입력", submitted: "승인 대기", toclose: "마감", tosubmit: "상신", pass: "출입증", setup: "준비",
};

/** 월말까지 남은 날 (선택 월이 이번 달일 때만) */
function daysToMonthEnd(ym: string): number | null {
  const today = seoulToday();
  if (today.slice(0, 7) !== ym) return null;
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(today.slice(8, 10));
}

/**
 * 월 요약의 숫자 칸 — filter: 누르면 같은 화면의 지출 내역을 거른다, href: 다른 화면(출입증·설정)이나 같은 화면 구역,
 * 둘 다 없으면 숫자만 (조회 전용).
 * 세 줄 구조 고정(라벨 / 금액·건수 / 보조 글자) — 보조 글자는 항상 자기 줄에 한 줄 말줄임, 없으면 min-h로 높이만 맞춰 칸마다 모양이 같다.
 */
type StatProps = { href?: string; filter?: Partial<LedgerFilters>; label: string; value: React.ReactNode; warn?: boolean; sub?: string };
function Stat({ href, filter, label, value, warn, sub }: StatProps) {
  const body = (
    <>
      <span className="truncate text-xs text-fg-muted">{label}</span>
      <span className={`tabular mt-0.5 flex items-center gap-1 text-base font-bold ${warn ? "text-amber-800" : ""}`}>
        {warn && <Icon d={PACE_ICON.warn} className="size-4 shrink-0" sw={1.8} />}
        <span className="min-w-0 truncate">{value}</span>
        {(href || filter) && <span aria-hidden className="ml-auto shrink-0 text-sm font-normal text-fg-subtle">›</span>}
      </span>
      <span className="block min-h-4 truncate text-xs font-medium text-fg-muted" title={sub}>{sub}</span>
    </>
  );
  const cls = "flex min-w-0 flex-col justify-center rounded-lg bg-surface-muted px-3 py-2";
  const press = `${cls} transition hover:bg-surface-muted/60 hover:ring-1 hover:ring-line-strong`;
  if (filter) return <FilterTrigger set={filter} className={press} pressedClassName="!bg-brand-50 ring-2 ring-primary" label={`${label} 내역 보기`}>{body}</FilterTrigger>;
  if (href) return <Link href={href} className={press}>{body}</Link>;
  return <div className={cls}>{body}</div>;
}

const STAT_GRID: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };

/** 지출 내역(표·필터·수정 시트)에 필요한 조회 — 월 지출 1회 + 마감·분류·입력 맥락 */
async function loadLedger(user: SessionUser, projectId: string, ids: string[], ym: string) {
  const [rows, closings, categories, inputCategories, context, tasks] = await Promise.all([
    // 수정은 지금 프로젝트의 건만 (함께 상신하는 서브 건은 서브에서)
    listExpenses(user, ids, ym, undefined, projectId),
    getClosings(projectId),
    getMaster(projectId),
    getInputMaster(user, projectId),
    getInputContext(user, projectId),
    getInputTasks(user, projectId),
  ]);
  return { rows, closings, categories, inputCategories, context, tasks };
}

/**
 * 현황 — 예전 '팀 현황'과 '월별 현황'을 한 화면으로 (한 달 기준).
 * 월 요약(지출·월 배정·소명 없음 등) → 할 일 → [팀원별 정산 | 지출 내역] → 주의 항목.
 * (예산 잔액·집행률은 프로젝트 운영비, 팀원별 정산 연간 추이는 마감·상신 화면 아래에)
 * 요약 칸·팀원 행을 누르면 같은 화면의 지출 내역이 걸러진다 (PC는 내역 옆 열, 모바일은 한 줄 스크롤).
 * - 팀원: '내 지출 내역' — 본인 건 요약(받을 돈·본인 부담 공제·소명 필요) + 내역 + 월별 정산(#settle, 예전 /settlement). 출입증 쓰는 프로젝트는 [카드 | 출입증] 탭 —
 *   출입증 탭(?tab=pass&ym=출입증 내역 월)은 업체 내역의 내 사용분 확인·업무 사용 표시 (예전 /expenses/new?mode=pass). PM·재무 승인은 출입증 정산(/pass)으로.
 * - 재무 승인·시스템 관리자: '프로젝트 현황' (하위 포함 취합)
 * - 조회 전용(상위 PM·조직장): 요약·예산만 (개별 지출 내역 없음)
 * 예전 주소 /monthly?… 는 미들웨어가 /dashboard?…#ledger 로 옮긴다.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ scope?: string; part?: string; ym?: string; check?: string; edit?: string; from?: string; tab?: string }> }) {
  const { user, project } = await pageContext();
  const { scope: scopeParam, part: partParam, ym: ymParam, check, edit, from, tab } = await searchParams;
  const member = user.role === "MEMBER";
  // 할 일: 이 프로젝트를 직접 운영하는 PM (조회 전용·종료 프로젝트·재무 승인 제외)
  const showTodo = canManage(user) && !user.readOnly;
  // 조회 전용(상위 PM·조직장)은 숫자만 — 개별 지출 내역·출입증 화면을 쓰지 않는다
  const view = user.readOnlyReason === "view";
  const showLedger = !view;
  // 출입증 탭 (팀원) — PM·재무 승인은 출입증 정산에서 확인·결정한다 (예전 주소·알림 링크로 들어온 경우)
  const passTabs = member && showLedger && project.clientPassEnabled;
  if (tab === PASS_TAB && !member && showLedger && project.clientPassEnabled) redirect(ymParam && /^\d{4}-\d{2}$/.test(ymParam) ? `/pass?ym=${ymParam}` : "/pass");
  const passTab = passTabs && tab === PASS_TAB;
  const now = currentYearMonth();
  // 집계 월 목록 = 이 프로젝트 기간 (getDashboard의 months와 같음) — 선택 월을 먼저 정해 조회를 동시에
  const allMonths = projectMonths(project.startDate, project.endDate);
  // ?ym= → 마지막 본 달(쿠키) → 이번 달
  const ym = resolveYm(await wantedYm(ymParam, allMonths), allMonths);
  // 팀원별 정산(개인 법인카드)은 팀원 내역을 보는 사람만 — 조회 권한(상위 PM·조직장)은 보지 않는다
  const seesAll = canSeeAllRows(user);

  const scopeP = rollupScope(user, project.id, scopeParam, partParam);
  // 출입증 탭에서는 카드 내역을 읽지 않고, 카드 탭에서는 출입증을 읽지 않는다
  const ledgerP = showLedger && !passTab ? scopeP.then((sc) => loadLedger(user, project.id, sc.ids, ym)) : null;
  // 팀원 화면은 본인 지출 요약과 내역만 — 예산·팀 집계를 읽지 않는다
  const teamP = member ? null : Promise.all([
    scopeP.then(async (sc) => {
      const [d, payers, range] = await Promise.all([
        // 예산: 함께 상신하는 서브·하위 포함 범위 (구분 필터로 메인을 빼면 고른 구분만 — 월 귀속은 이 프로젝트 기간 기준)
        getDashboard(project.id, sc.ids.filter((id) => id !== project.id), project, sc.ids.includes(project.id) ? undefined : sc.ids),
        getPayerMonth(sc.ids, ym),
        seesAll ? getSettlementRange(sc.ids, [ym]) : null,
      ]);
      return { d, payers, range };
    }),
    // 할 일·소명 없음: 메인과 함께 상신하는 서브 포함 (마감 준비 범위)
    // 정산 카드 범위(sc.ids)의 입력 대상 팀원도 함께 (팀원 조회는 결제자 조회와 같은 키라 추가 조회 없음)
    scopeP.then((sc) => getTodoData(project.id, ym > now ? ym : now, sc.group, sc.ids)),
  ]);
  // 팀원 출입증 탭: 출입증 내역 월 기준 (요청 달 → 이번 달 → 가장 최근에 올라온 달) — 모두 직접 SQL
  const myPassP = passTab ? loadMyPassMonth(user, project.id, now, ymParam) : null;
  // 팀원 정산(예전 내 정산 화면) — 본인 결제 건의 월별 받을 돈 · 마감 행(반려 사유·승인 취소) · 출입증 본인 부담 줄·항목 (서로 무관, 한 번에).
  // 카드(받을 돈)·출입증(공제) 두 탭을 아우르므로 탭과 무관하게 읽고, 두 탭 아래 공통으로 그린다
  const settleP = member && showLedger ? Promise.all([
    getSettlementRange([project.id], allMonths, { onlyPayerId: user.id }),
    closingRows(project.id),
    // 출입증 본인 부담 — 확정 전이면 예상액 (정해진 본인 부담 + 아직 정하지 않았고 업무 사용 표시도 안 한 건)
    project.clientPassEnabled
      ? prisma.passStatementLine.findMany({
          where: { userId: user.id, statement: { projectId: project.id } },
          select: { id: true, userId: true, date: true, time: true, usageItemId: true, amount: true, memberClaim: true, decision: true, statement: { select: { yearMonth: true, status: true } } },
        })
      : [],
    project.clientPassEnabled ? passItems(project.id) : [],
  ]) : null;
  const [scope, rawLedger, team, myPass, settle] = await Promise.all([scopeP, ledgerP, teamP, myPassP, settleP]);
  // 함께 상신하는 서브가 있으면 내역의 프로젝트 칸은 구분 이름 (운영·대응)
  const partOf = new Map(scope.parts.map((p) => [p.id, p.label]));
  const ledger = rawLedger && partOf.size
    ? { ...rawLedger, rows: rawLedger.rows.map((r) => (partOf.has(r.projectId) ? { ...r, projectName: partOf.get(r.projectId)! } : r)) }
    : rawLedger;

  const mLabel = `${Number(ym.slice(5))}월`;
  const today = seoulToday();
  const dDay = daysToMonthEnd(ym);
  const closingStatus = (ledger?.closings.get(ym)?.status as ClosingStatus | undefined) ?? "DRAFT";
  const locked = isLocked(closingStatus);
  // 팀원이 보는 달의 입력 기한 문제 (기한 지남) — 마감 잠금이 없을 때만 쓴다
  const deadlineProblem = member && !locked && ym <= now ? inputDeadlineProblem(ym, today) : null;
  const title = member ? "내 지출 내역" : user.role === "HQ" || user.role === "ADMIN" ? "프로젝트 현황" : "팀 현황";
  // 팀원에게 열린 지출 항목이 없으면(이 프로젝트 지출은 PM이 입력) 입력 버튼을 숨긴다 — 입력 항목은 내역 조회에서 이미 읽었다
  const canInput = !user.readOnly && (!member || (memberInputOpen(project) && (!ledger || ledger.inputCategories.length > 0)));

  /** 팀원: 작성중인 달의 입력 기한 (다음 달 3일, lib/month-phase) — 5일 전부터 D-n 강조. 입력 항목이 없는 팀원은 표시 없음 */
  const deadlineNote = (phase: string) => {
    if (!canInput) return null;
    // 기한이 지나 마감을 기다리는 달: 배지만으로는 뜻을 알기 어려워 기한을 함께 (입력 불가 안내는 내역 위 상자)
    if (phase === "PENDING_CLOSE") return <span className="tabular text-xs font-semibold text-amber-800">입력 기한 {inputDeadlineLabel(ym)} 지남</span>;
    if (phase !== "DRAFT") return null;
    const d = daysToDeadline(ym, today);
    return (
      <span className={`tabular text-xs font-semibold ${d <= 5 ? "text-amber-800" : "text-fg-muted"}`}>
        {d === 0 ? "오늘이 입력 기한" : d <= 5 ? `입력 기한까지 D-${d}` : `입력 기한 ${inputDeadlineLabel(ym)}`}
      </span>
    );
  };
  /** 월 요약 카드 머리 (달·단계·다음 처리·기한). 월 이동은 화면 머리글(MonthNav). action: 그 달의 다음 처리 링크 (PM) */
  const monthHead = (status: ClosingStatus, action?: React.ReactNode) => {
    // 저장 상태에 달력 시점을 더한 단계 — 기한 지난 작성중 달은 '마감 대기'
    const phase = monthPhase(ym, status, today);
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="tabular text-title font-bold">{ymKo(ym)}</h2>
        <StatusBadge status={phase} />
        {member ? deadlineNote(phase) : dDay !== null && (
          <span className={`tabular text-xs font-semibold ${dDay <= 5 ? "text-amber-800" : "text-fg-muted"}`}>
            {dDay === 0 ? "오늘 월말 — 마감 준비" : `월말까지 D-${dDay}`}
          </span>
        )}
        {action}
      </div>
    );
  };
  const statGrid = (stats: (StatProps | false)[], grid?: string) => {
    const list = stats.filter((x): x is StatProps => !!x);
    return <div className={`mt-3 grid gap-2 ${grid ?? STAT_GRID[list.length] ?? "grid-cols-2"}`}>{list.map((x) => <Stat key={x.label} {...x} />)}</div>;
  };

  // 메인과 함께 상신하는 서브: 마감 해제는 메인 PM
  const parentOfYm = scope.settleParentName(ym);
  const lockHintText = unlockHint(closingStatus, parentOfYm ? `${parentOfYm} PM` : "PM");
  const partName = scope.partId ? scope.parts.find((p) => p.id === scope.partId)?.label : null;
  // 월 이동 — 다른 월 화면과 같은 자리. 팀원 출입증 탭은 내 사용분이 올라온 달만 (없으면 숨김)
  const monthNav = myPass
    ? (myPass.months.length ? <MonthNav months={myPass.months} value={myPass.ym} /> : undefined)
    : <MonthNav months={allMonths} value={ym} />;
  // 다른 화면의 확인 항목에서 온 경우(?from=) — 스크롤해도 보이는 돌아가기 (주소·문구는 lib/page-ctx BACK_FROM)
  const back = <BackTo from={from} ym={ym} />;
  const header = (
    <PageHeader title={title} month={monthNav}
      // 프로젝트명은 상단 선택기에, 기간·예산은 프로젝트 운영비에 — 여기는 집계 범위(구분·함께 상신·하위 취합)만, 없으면 설명 줄 없음
      desc={[
        scope.parts.length ? (partName ? `${partName}만` : `함께 상신 ${scope.parts.slice(1).map((p) => p.label).join("·")} 포함`) : null,
        scope.on ? `하위 ${scope.children.length}개 프로젝트 취합` : null,
      ].filter(Boolean).join(" · ") || undefined}>
      {scope.parts.length > 0 && <PartFilter parts={scope.parts} current={scope.partId} />}
      {scope.canRollup && <ScopeToggle on={scope.on} childCount={scope.children.length} />}
      {canInput && showLedger && <Link className="btn-secondary hidden lg:inline-flex" href="/expenses/new">+ 지출 입력</Link>}
    </PageHeader>
  );

  /** 지출 내역 — 필터·규정 점검 탭·수정 시트 (예전 월별 현황) */
  const ledgerSection = ledger && (
    <section id={LEDGER_ID} className="min-w-0 scroll-mt-20" aria-label={`${mLabel} 지출 내역`}>
      <h2 className="section-title mb-3">{mLabel} 지출 내역 <span className="tabular font-medium text-fg-muted">{ledger.rows.length}건</span></h2>
      {locked && <LockNotice status={closingStatus} hint={lockHintText} />}
      {/* 팀원: 기한이 지난 달은 마감 전이어도 입력·수정 불가 (서버 403과 같은 문구) */}
      {!locked && deadlineProblem && <div className="alert alert-neutral mb-4"><span>{deadlineProblem}</span></div>}
      <MonthlyTable key={ym} initialCheck={check} initialEditId={edit}
        rows={ledger.rows} showProject={scope.ids.length > 1 || scope.ids[0] !== project.id} locked={locked || !!deadlineProblem} lockHint={deadlineProblem ?? lockHintText} projectId={project.id} role={user.role}
        categories={ledger.categories} inputCategories={ledger.inputCategories} context={ledger.context} lockedMonths={[...ledger.closings.values()].filter((c) => isLocked(c.status)).map((c) => c.yearMonth)}
        tasks={ledger.tasks} />
    </section>
  );

  // ── 팀원: 내 지출 요약 + 내역 ──
  if (!team) {
    const passName = project.clientPassName ?? "출입증";
    // ── 정산 (예전 '내 정산' 화면을 여기에) — 회사와 주고받을 돈의 월별 정리.
    // 받을 돈: 개인 법인카드로 결제한 금액 (정산표와 같은 기준) / 본인 부담 공제: 출입증 본인 부담 (급여에서 빠짐, 확정 전은 예정).
    // 들어오고 나가는 경로가 달라 합치지 않고 나란히. 출입증 회사 부담은 회사가 업체에 직접 내므로 여기 없다 (출입증 탭).
    // 월 요약의 받을 돈 칸과 아래 월별 정산 행은 같은 숫자 — 숫자는 한 번만 센다 (getSettlementRange)
    const deductHead = "본인 부담 공제";
    const settleStats: StatProps[] = [];
    let settleSection: React.ReactNode = null;
    if (settle) {
      const [{ byMonth, countOf }, crows, passLines, passItemList] = settle;
      // 마감 상태는 ledger가 없는 출입증 탭에서도 필요하므로 마감 행에서 만든다
      const closings = new Map(crows.map((c) => [c.yearMonth, { status: c.status }]));
      const revoked = await revokedMonths(crows);
      const notes = new Map(crows.map((c) => [c.yearMonth, c.reviewNote]));
      // 이번 달까지만 (앞으로의 달은 '작성중 -'만 늘어서므로 빼고)
      const mine = allMonths.filter((m) => m <= now || m === ym).map((m) => ({ ym: m, amount: byMonth[m].byPayer[user.id] ?? 0 }));
      const rejected = mine.filter((m) => closingStatusIn(closings, m.ym) === "REJECTED");
      const deductOf = new Map<string, { amount: number; confirmed: boolean }>();
      for (const m of new Set(passLines.map((l) => l.statement.yearMonth))) {
        const ls = passLines.filter((l) => l.statement.yearMonth === m);
        deductOf.set(m, { amount: memberExpectation(ls, passItemList).expected, confirmed: ls[0].statement.status === "CONFIRMED" });
      }
      const deductYm = deductOf.get(ym);
      // 승인 전인 달의 받을 돈 (마감·상신·반려 포함) — 승인된 달은 정산이 끝난 것으로 본다
      const pending = mine.filter((m) => m.amount > 0 && closingStatusIn(closings, m.ym) !== "APPROVED");
      const pendingTotal = pending.reduce((a, m) => a + m.amount, 0);
      // 정산 전 달을 단계별로 묶어 "상신 8월 · 마감 대기 9월 · 작성중 10월"처럼 — 작성중·마감 달은 아직 재무 승인 대기가 아니라서 한데 "승인 대기"라 하지 않는다
      const phaseOf = (m: string) => monthPhase(m, closingStatusIn(closings, m), today);
      const statusWord = (m: string) => (revoked.has(m) ? "승인 취소" : MONTH_PHASE_LABEL[phaseOf(m)]);
      const pendingByStatus = [...new Set(pending.map((m) => statusWord(m.ym)))].map((w) => `${w} ${monthsLabel(pending.filter((m) => statusWord(m.ym) === w).map((m) => m.ym))}`);
      const receive = byMonth[ym]?.byPayer[user.id] ?? 0;
      // 월 요약 칸: 이 달 받을 돈(승인된 달은 '정산됨') · 이 달 본인 부담 공제(확정/예정) — 달 상태 배지는 머리줄에 이미 있다
      settleStats.push({ href: SETTLE_HASH, label: `받을 돈${closingStatusIn(closings, ym) === "APPROVED" ? " (정산됨)" : ""}`, value: `${won(receive)}원`, sub: `${PAY_METHOD_LABEL.PERSONAL_CARD} ${countOf(ym, user.id)}건` });
      if (passTabs) {
        settleStats.push({
          href: passCheckHref(ym), label: `${deductHead}${deductYm?.confirmed ? " (확정)" : " 예정"}`, value: `${won(deductYm?.amount ?? 0)}원`,
          sub: deductYm ? `${passName} ${deductYm.confirmed ? "확정 · 급여 공제" : "확정 전"}` : passName,
        });
      }
      settleSection = (
        <section id="settle" className="card mt-4 scroll-mt-20 overflow-hidden" aria-label="정산">
          {/* 설명 줄은 두지 않는다 — 위 요약 칸(받을 돈 = 개인 법인카드, 본인 부담 공제 = 출입증)이 이미 말한다. 모바일에서 제목이 꺾이지 않게 nowrap */}
          <div className="card-head">
            <h2 className="section-title whitespace-nowrap">월별 정산</h2>
          </div>
          {/* 팀원이 가장 알고 싶은 '아직 못 받은 돈'을 먼저 — 승인되지 않은 달의 받을 돈 합계 */}
          <SummaryHead className="px-4 py-4 sm:px-5" label={pending.length > 0 ? "아직 못 받은 돈 (정산 전)" : "아직 못 받은 돈"} amount={pendingTotal}
            sub={pending.length > 0
              ? <span>{pendingByStatus.join(" · ")} — PM 마감·상신 → 재무 승인 후 정산돼요</span>
              : mine.some((m) => m.amount > 0)
                ? <span>받을 돈이 모두 승인됐어요</span>
                : <span>{PAY_METHOD_LABEL.PERSONAL_CARD} 지출이 아직 없어요</span>} />
          {rejected.length > 0 && (
            <div className="alert alert-danger mx-4 mb-4 block space-y-1 text-sm sm:mx-5" role="status">
              {rejected.map((m) => (
                <p key={m.ym}>
                  <b>{ymKo(m.ym)} {revoked.has(m.ym) ? "승인 취소됨" : "반려"}</b>{notes.get(m.ym) ? ` · 사유: ${notes.get(m.ym)}` : ""} — PM이 다시 상신하기 전에 고칠 것이 있는지 확인해 주세요.{" "}
                  <Link href={ledgerHref(m.ym)} className="font-semibold underline underline-offset-2">{Number(m.ym.slice(5))}월 내역 ›</Link>
                </p>
              ))}
            </div>
          )}
          {/* 월별: 받을 돈(달 상태 배지와 함께) | 본인 부담 공제(예정/확정) — 최근 달이 위. 행은 그 달 내 지출 내역, 공제 금액은 출입증 탭 */}
          <div className="border-t border-line">
            <SettlementMonthList showDeduct={passTabs} deductHead={deductHead}
              rows={[...mine].reverse().map((m) => ({
                ym: m.ym, label: ymKo(m.ym), amount: m.amount, deduct: deductOf.get(m.ym), current: m.ym === ym,
                status: revoked.has(m.ym) ? <span className="badge badge-bad">승인 취소됨</span> : <StatusBadge status={phaseOf(m.ym)} />,
                href: ledgerHref(m.ym), deductHref: passCheckHref(m.ym),
              }))} />
          </div>
        </section>
      );
    }
    if (myPass) {
      return (
        <>
          {header}
          <LedgerTabs pass passName={passName} cardYm={allMonths.includes(myPass.ym) ? myPass.ym : undefined} passYm={myPass.ym} />
          <MyPassPanel projectId={project.id} userId={user.id} passName={passName} pass={myPass} />
          {/* 월별 정산은 두 탭 공통 (카드 = 받을 돈, 출입증 = 공제) — 탭을 바꿔도 같은 자리에 있다 */}
          {settleSection}
          {/* 하단 고정 합계 바·하단 탭에 가려지지 않도록 */}
          <div className="h-16 lg:hidden" aria-hidden />
        </>
      );
    }
    const rows = ledger?.rows ?? [];
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const flagged = rows.filter((r) => needsReview(r.flags));
    const unexplained = flagged.filter(isUnexplained).length;

    return (
      <LedgerFilterProvider key={ym} initialCheck={check}>
        {header}
        {back}
        {passTabs && <LedgerTabs pass={false} passName={passName} cardYm={ymParam ? ym : undefined} passYm={ymParam ? ym : undefined} />}
        <section className="card mb-4 px-4 py-4 sm:px-5" aria-label={`${ymKo(ym)} 요약`}>
          {monthHead(closingStatus)}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs text-fg-muted">내 지출</span>
            <span className="tabular text-amount font-bold tracking-tight">{won(total)}<span className="ml-0.5 text-base font-semibold text-fg-muted">원</span></span>
            <span className="tabular text-sm text-fg-muted">{rows.length}건</span>
          </div>
          {statGrid([
            ...settleStats,
            { filter: flagged.length ? { check: unexplained ? "unexplained" : "flag" } : undefined, label: "소명 필요", value: `${unexplained}건`, warn: unexplained > 0, sub: flagged.length - unexplained > 0 ? `소명 완료 ${flagged.length - unexplained}건` : undefined },
            // 금액 칸이 셋이면(출입증) 모바일은 세로 1열 — 390px에 금액 셋이 한 줄에 안 들어간다
          ], settleStats.length === 2 ? "grid-cols-1 sm:grid-cols-3" : undefined)}
        </section>
        {ledgerSection}
        {settleSection}
      </LedgerFilterProvider>
    );
  }

  // ── PM·재무 승인·조회 전용 ──
  const [{ d, payers, range }, todoData] = team;
  const n = d.months.length;
  const idx = d.months.indexOf(ym);
  const elapsed = d.months.filter((m) => m <= now).length;
  const timeRate = n ? Math.round((elapsed / n) * 1000) / 10 : 0;
  const usage = monthUsage(d.rows, idx, n);
  const risks = riskItems(d.rows, timeRate);
  const status = d.trend[idx]?.status ?? "DRAFT";
  // 규정 점검: 소명 없는 건이 할 일 (할 일·지출 입력 배너·마감 체크리스트와 같은 기준), 소명한 건은 참고로
  // (구분 필터: 고른 구분의 건만)
  const inScope = new Set(scope.ids);
  const monthFlagged = todoData.expenses.filter((e) => e.yearMonth === ym && needsReview(e.flags) && inScope.has(e.projectId));
  const unexplained = monthFlagged.filter(isUnexplained).length;
  const explained = monthFlagged.length - unexplained;
  const passRequests = (todoData.passChecks ?? []).reduce((a, p) => a + p.count, 0);
  // 팀원 요청(업무 사용 표시, PM 확인 전)이 남은 가장 오래된 달로
  const passRequestYm = (todoData.passChecks ?? []).filter((p) => p.count > 0).map((p) => p.ym).sort()[0];
  // 미입력 팀원은 팀원별 정산에서 바로 보인다 (할 일에서는 뺀다)
  // 메인과 함께 상신하는 서브: 마감·상신은 메인 PM이 하므로 마감·상신 할 일은 빼고 안내만
  const settleParent = scope.settleParentName(ym);
  const todos = showTodo ? buildTodos({ ym, now, today, months: d.months, ...todoData })
    .filter((t) => t.key !== "setup" && t.key !== "noinput" && !(settleParent && (t.key === "toclose" || t.key === "tosubmit" || t.key === "submitted"))) : [];
  // 처리 순서: 반려·경고(마감·상신·소명·출입증) → 안내
  const TODO_RANK: Record<TodoItem["key"], number> = { rejected: 0, toclose: 1, tosubmit: 2, flag: 3, pass: 4, setup: 5, noinput: 6, submitted: 7 };
  todos.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : b.tone === "danger" ? 1 : a.tone === "warn" ? -1 : 1) || TODO_RANK[a.key] - TODO_RANK[b.key]);
  const ready = setupComplete(todoData.setup);
  const counts = todos.reduce<Partial<Record<TodoItem["key"], number>>>((a, t) => ({ ...a, [t.key]: (a[t.key] ?? 0) + 1 }), {});
  const s = range?.byMonth[ym];
  const showSettle = ready && !!s && !!range;
  // 정산 카드의 줄: 입력 대상 팀원(미입력 표시) · PM(금액만) · 입력할 수 없는 팀원(지출이 있을 때만 금액) — lib/input-capable
  const settleRows = visibleSettlePayers(payers, todoData.settleTargets, todoData.settlePms);
  const targetRows = settleRows.filter((p) => p.mode === "target");
  // 지난달·이번 달만 미입력을 센다 (앞으로의 달은 모두 미입력이라 의미 없음). 입력 대상 팀원이 없으면(PM만 입력) 칸을 숨긴다
  const idle = showSettle && ym <= now && targetRows.length > 0 ? targetRows.filter((p) => !p.entered).length : null;
  // 행을 눌러 내역을 거르는 건 내역이 있을 때만
  const press = !!ledger;
  // 알림 문구 (PM): 지난달·이번 달의 미입력 팀원, 소명 없는 점검 건의 결제자 — 결제자 목록 순서(직급 → 성명)
  let remind: RemindGroup[] = [];
  if (showTodo && showSettle && ym <= now) {
    const idleIds = targetRows.filter((p) => !p.entered && p.member).map((p) => p.id);
    const owed = new Map<string, number>();
    for (const e of monthFlagged.filter(isUnexplained)) owed.set(e.payerId, (owed.get(e.payerId) ?? 0) + 1);
    const ids = [...new Set([...idleIds, ...owed.keys()])];
    if (ids.length) {
      const rows = await sqlRows<{ id: string; email: string | null }>(`SELECT "id", "email" FROM "User" WHERE "id" IN (${ids.map(() => "?").join(",")})`, ids);
      const emailOf = new Map(rows.map((r) => [r.id, r.email]));
      const nameOf = new Map(payers.map((p) => [p.id, p.name]));
      const order = [...payers.map((p) => p.id), ...owed.keys()];
      const person = (id: string, count?: number) => ({ id, name: nameOf.get(id) ?? "결제자", email: emailOf.get(id) ?? null, ...(count ? { count } : {}) });
      remind = [
        { kind: "noinput", people: idleIds.map((id) => person(id)) },
        { kind: "unexplained", people: [...new Set(order)].filter((id) => owed.has(id)).map((id) => person(id, owed.get(id))) },
      ];
    }
  }
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;

  /** 팀원별 정산 — 입력 여부 + 개인 법인카드 정산 금액 + 공용·본사·계·검증. 행을 누르면 그 결제자의 내역만 */
  const settleCard = showSettle && s && range && (
    <section id="settle" className="card scroll-mt-20 overflow-hidden" aria-label="팀원별 정산">
      <div className="card-head">
        <h2 className="section-title">{settleRows.some((p) => p.mode !== "pm") ? "팀원별 " : ""}{mLabel} 정산</h2>
        <span className="ml-auto mr-2"><RemindButton groups={remind} ym={ym} projectName={project.name} origin={origin} projectId={project.id} /></span>
        {s.isValid
          ? <span className="text-xs font-medium text-fg-muted" title="팀원별 + 공용 법인카드 + 본사 = 총합계 (엑셀 검증 TRUE)">✓ 합계 일치</span>
          : <span className="badge badge-bad px-2" title="팀원별 + 공용 법인카드 + 본사 ≠ 총합계 (엑셀 검증 FALSE)">✕ 검증 불일치</span>}
      </div>
      <ul className="divide-y divide-line">
        {settleRows.map((p) => {
          const amount = s.byPayer[p.id] ?? 0;
          const meta = <>
            {p.entered ? <span className="tabular">개인 법인카드 {range.countOf(ym, p.id)}건</span> : p.mode === "target" ? <span className="badge badge-neutral">미입력</span> : p.mode === "pm" ? <span>PM</span> : null}
            {!p.member && <span className="truncate">· 결제자 목록 외</span>}
          </>;
          const value = <span className={`tabular text-base font-semibold sm:text-sm ${amount ? "" : "text-fg-subtle"}`}>{amount ? `${won(amount)}원` : "-"}</span>;
          return press && p.entered
            ? <FilterRow key={p.id} set={{ payer: p.id, method: "" }} lead={p.name.slice(0, 1)} title={p.name} meta={meta} value={value} ariaLabel={`${p.name} 지출 내역 보기`} />
            : <ListRow key={p.id} lead={p.name.slice(0, 1)} title={p.name} meta={meta} value={value} />;
        })}
        {(() => {
          const shared = <span className={`tabular text-base font-semibold sm:text-sm ${s.sharedCard ? "" : "text-fg-subtle"}`}>{s.sharedCard ? `${won(s.sharedCard)}원` : "-"}</span>;
          // 본사 = 본사 지출 (출입증 회사 부담 확정분은 상신 엑셀에서 본사 집행내역에 함께 들어가지만 여기서는 따로 보인다)
          const hqCard = s.hq - s.pass;
          const hq = <span className={`tabular text-base font-semibold sm:text-sm ${hqCard ? "" : "text-fg-subtle"}`}>{hqCard ? `${won(hqCard)}원` : "-"}</span>;
          return <>
            {press && s.sharedCard
              ? <FilterRow set={{ payer: "", method: "SHARED_CARD" }} lead="공" title={PAY_METHOD_LABEL.SHARED_CARD} value={shared} ariaLabel={`${PAY_METHOD_LABEL.SHARED_CARD} 내역 보기`} />
              : <ListRow lead="공" title={PAY_METHOD_LABEL.SHARED_CARD} value={shared} />}
            {press && hqCard
              ? <FilterRow set={{ payer: "HQ", method: "" }} lead="본" title="본사" value={hq} ariaLabel="본사 내역 보기" />
              : <ListRow lead="본" title="본사" value={hq} />}
            {s.pass > 0 && (
              <ListRow lead="출" title="출입증 회사 부담" href={view ? undefined : `/pass?ym=${ym}`}
                meta={<span className="truncate">월 확정분 · 상신 엑셀 본사 집행내역</span>}
                value={<span className="tabular text-base font-semibold sm:text-sm">{won(s.pass)}원</span>} />
            )}
          </>;
        })()}
      </ul>
      <div className="flex items-center justify-between border-t border-line-strong bg-surface-muted px-4 py-3 font-bold sm:px-5">
        <span>계</span>
        <span className="tabular">{won(s.total)}원</span>
      </div>
      {!s.isValid && <p className="alert alert-danger m-4 text-sm">팀원별 + 공용 법인카드 + 본사 합이 총합계와 다릅니다. 지출 내역에서 결제방법·본사 구분을 확인하세요.</p>}
    </section>
  );

  /** 주의 항목 — 초과·빠름·초과 예상만 (없으면 숨김) */
  const riskCard = risks.length > 0 && (
    <section className="card overflow-hidden" aria-label="주의 항목">
      <div className="card-head">
        <h2 className="section-title">주의 항목 <span className="tabular font-medium text-fg-muted">{risks.length}</span></h2>
        <span className="text-xs text-fg-muted">기간 경과 {timeRate}% 기준</span>
      </div>
      <ul className="divide-y divide-line">
        {risks.map((r) => (
          <ListRow key={r.itemId} href="/budget" title={r.itemName}
            meta={(() => {
              const avail = idx >= 0 ? monthAvailable(r.planned, n, r.months[idx] ?? 0, r.regular) : null;
              return (
                <span className="tabular truncate">
                  {r.rate ?? 0}%
                  {avail !== null && <> · {mLabel} 가용 <b className={avail < 0 ? "text-status-rejected" : "text-fg"}>{won(avail)}</b></>}
                </span>
              );
            })()}
            value={<div className={`tabular text-base font-bold sm:text-sm ${r.remaining < 0 ? "text-status-rejected" : ""}`}><span className="mr-1 text-xs font-medium text-fg-muted">잔액</span>{won(r.remaining)}원</div>}
            valueSub={<div className="flex justify-end"><PaceTag status={r.status} /></div>} chevron />
        ))}
      </ul>
    </section>
  );

  return (
    <LedgerFilterProvider key={ym} initialCheck={check}>
      {header}
      {back}

      {/* 1. 월 요약 — 지출·월 배정 + 누르면 내역을 거르는 칸 */}
      <section className="card mb-4 px-4 py-4 sm:px-5" aria-label={`${ymKo(ym)} 현황`}>
        {monthHead(status, showTodo && !settleParent && ym <= now && (
          // PM의 달 흐름(입력 → 마감 → 상신 → 승인)에서 지금 할 다음 처리 — 마감·상신 화면의 그 달로
          // (앞으로의 달은 마감·상신 화면에 아직 없으므로 단추도 없음)
          <Link href={`/closing?ym=${ym}`} className="btn-primary btn-sm ml-auto">
            {status === "REJECTED" ? "반려 사유 확인 ›" : status === "CLOSED" ? "상신하기 ›" : status === "SUBMITTED" ? "승인 대기 ›" : status === "APPROVED" ? "승인됨 ›" : monthPhase(ym, status, today) === "PENDING_CLOSE" ? "마감하기 ›" : "마감 준비 ›"}
          </Link>
        ))}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs text-fg-muted">지출</span>
          <span className="tabular text-amount font-bold tracking-tight">{won(usage.total)}<span className="ml-0.5 text-base font-semibold text-fg-muted">원</span></span>
        </div>
        {usage.budget > 0 ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <Meter rate={usage.rate} status={paceStatus({ rate: usage.rate })} size="md" className="min-w-0 flex-1" label="월 배정 대비 매월 항목 집행" />
              <span className={`tabular shrink-0 text-sm font-semibold ${usage.rate !== null && usage.rate > 100 ? "text-status-rejected" : ""}`}>{usage.rate ?? 0}%</span>
            </div>
            <p className="tabular mt-1 text-xs text-fg-muted">
              매월 항목 {won(usage.regularSpent)} / 월 배정 {won(usage.budget)}원
              {usage.irregularSpent > 0 && <> · 비정기 {won(usage.irregularSpent)}원 별도</>}
              {/* 항목별 월 배정·집행·남음은 운영비 월별 보기에서 (같은 달로 연다) */}
              {!member && <> · <Link href={`/budget?view=monthly&ym=${ym}`} className="font-semibold text-primary hover:underline">항목별 월 배정 ›</Link></>}
            </p>
          </>
        ) : <p className="mt-1 text-xs text-fg-muted">매월 쓰는 예산 항목이 없어 월 배정 비교를 하지 않습니다.</p>}
        {statGrid([
          // 시작 준비 = 재무 승인 담당의 예산 등록 하나 — 재무 승인 담당은 프로젝트 운영비로, PM은 PM 설정(안내)으로. PM 설정은 PM만 열 수 있다
          !ready && { href: view ? undefined : canEditBudget(user.role) ? "/budget" : "/settings", label: "시작 준비", value: "예산 등록 필요", warn: true },
          { filter: press && monthFlagged.length ? { check: unexplained ? "unexplained" : "flag" } : undefined, label: "소명 필요", value: `${unexplained}건`, warn: unexplained > 0, sub: explained > 0 ? `소명 완료 ${explained}건` : undefined },
          idle !== null && { href: "#settle", label: "미입력 팀원", value: `${idle}명`, warn: idle > 0 },
        ])}
      </section>

      {settleParent && (
        <p className="alert alert-info mb-4 text-sm">
          <span>마감·상신은 <b>{settleParent}</b> PM이 함께 진행합니다. 이 프로젝트에서는 팀원 입력·소명 확인만 합니다.</span>
        </p>
      )}

      {/* 2. 할 일 — 기본 접힘, 머리줄에 종류별 건수 */}
      {showTodo && (todos.length > 0 || !ready) && (
        // 처리할 것(경고·반려)이 있으면 펼쳐 둔다 — 안내만 있으면 접힘
        <details className="card group mb-4 overflow-hidden" open={!ready || todos.some((t) => t.tone !== "info") || undefined}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 sm:px-5">
            {/* 시작 준비(예산 등록)도 할 일 하나로 센다 — "할 일 0건 · 시작 준비 필요"가 되지 않게 */}
            <h2 className="section-title shrink-0">할 일 <span className="tabular">{todos.length + (ready ? 0 : 1)}건</span></h2>
            <span className="tabular min-w-0 flex-1 truncate text-xs text-fg-muted">
              {!ready && <span className="font-semibold text-amber-800">시작 준비 필요 · </span>}
              {(Object.keys(counts) as TodoItem["key"][]).map((k, i) => (
                <span key={k} className={k === "rejected" ? "font-semibold text-status-rejected" : ""}>{i > 0 && " · "}{TODO_SHORT[k]} {counts[k]}</span>
              ))}
            </span>
            <Icon name="chevronDown" className="size-4 shrink-0 text-fg-subtle transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-line px-4 py-3 sm:px-5">
            {!ready && <SetupChecklist setup={todoData.setup} className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4" />}
            {todos.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {todos.map((t, i) => (
                  <li key={`${t.key}-${i}`}>
                    <Link href={t.href} className={`flex h-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition hover:shadow-sm ${TODO_TONE[t.tone]}`}>
                      <div className="min-w-0">
                        <div className="font-semibold">{t.title}</div>
                        {t.detail && <div className="mt-0.5 line-clamp-2 text-label opacity-90">{t.detail}</div>}
                      </div>
                      <span aria-hidden className="shrink-0 opacity-60">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}

      {/* 3. 본문 — PC(넓은 화면): 지출 내역 | 옆 열(팀원별 정산·주의 항목). 모바일: 팀원별 정산 → 내역 → 주의 항목 한 줄 스크롤 */}
      {ledgerSection ? (
        <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-5">
          <div className="order-2 min-w-0 xl:order-none xl:col-start-1 xl:row-start-1">{ledgerSection}</div>
          <aside className="contents xl:col-start-2 xl:row-start-1 xl:flex xl:min-w-0 xl:flex-col xl:gap-4" aria-label="요약">
            {settleCard && <div className="order-1 xl:order-none">{settleCard}</div>}
            {riskCard && <div className="order-3 xl:order-none">{riskCard}</div>}
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          {settleCard}
          {riskCard}
        </div>
      )}
    </LedgerFilterProvider>
  );
}
