import Link from "next/link";
import { ClosingActions } from "@/components/ClosingActions";
import { MonthSheetView, type SheetMark } from "@/components/closing/MonthSheetView";
import { RemindButton } from "@/components/RemindSheet";
import type { RemindPerson } from "@/lib/remind";
import { headers } from "next/headers";
import { Empty, PageHeader, StatusBadge, StickyAction } from "@/components/common";
import { ScrollToOnChange } from "@/components/ScrollToOnChange";
import { Icon } from "@/components/icons";
import { MonthLink } from "@/components/closing/MonthLink";
import { MonthNav } from "@/components/MonthNav";
import { withCtx } from "@/lib/page-ctx";
import { wantedYm } from "@/lib/page-ctx-server";
import { SettlementTrend } from "@/components/closing/SettlementTrend";
import { isHqLike, pageContext, projectRows } from "@/lib/access";
import { availableActions, defaultClosingMonth, isLocked, overrideLabels, parseSubmitOverride, type ClosingAction, type PassStatementState } from "@/lib/closing";
import { HqSummary } from "@/components/closing/HqSummary";
import { approveSummaryText, passStatusText, payerCompare } from "@/lib/hq-summary";
import { loadHqSummary } from "@/lib/hq-summary-server";
import { revokedClosingIds } from "@/lib/closing-server";
import { checklistSummary, closingChecklist, closingStage, type CheckItem } from "@/lib/closing-checklist";
import { prisma, toNumber } from "@/lib/db";
import { addMonths, currentYearMonth, dash0, formatDate, projectMonths, seoulToday, shortDateTime, won, ymKo } from "@/lib/format";
import { MONTH_PHASE_LABEL, monthPhase } from "@/lib/month-phase";
import { ledgerHref } from "@/lib/page-access";
import { projectPhase } from "@/lib/lifecycle";
import { servedInMonth } from "@/lib/membership";
import { getPayers } from "@/lib/reports";
import { PASS_PAY_METHOD, settle, type Settlement } from "@/lib/settlement";
import { CLOSING_LABEL, PAY_METHOD_LABEL, type ClosingStatus } from "@/lib/types";
import { flagLabel, isAdvisory, needsReview, parseFlags } from "@/lib/policy";
import { passCompanyLines, projectMembersOf } from "@/lib/queries";
import { sqlInputSources } from "@/lib/sql-loaders";
import { inputMemberIds } from "@/lib/input-capable";
import { canSeeAllRows } from "@/lib/rules";
import { passBudgetSpend, passDuplicateIds, passExcelRows, withPassDup } from "@/lib/pass-budget";
import { monthSheetData, passRowDate, payerLabels, type SheetExpense } from "@/lib/month-sheet";
import { getSettlementRange, orderPayers } from "@/lib/settlement-range";
import { settleGroup } from "@/lib/settle-server";
import { ApprovalRef } from "@/components/closing/ApprovalRef";
import { SNAPSHOT_LABEL, downloadStats, formatBytes, isSnapshotKind, shortSha, type SnapshotMeta } from "@/lib/snapshot";
import { listSnapshots } from "@/lib/snapshot-server";
import { excelItemName, mergeSettleClosings, partLabel, settleParentIds, settleWithParentMessage } from "@/lib/settle-group";

/** "10.03 18:00" (한국 시간, 없으면 빈 문자열) */
const fmtDateTime = (d: Date | null) => (d ? shortDateTime(d) : "");

type Closing = {
  id: string; status: string; closedAt: Date | null; submittedAt: Date | null; reviewedAt: Date | null; reviewedBy: string | null; reviewNote: string | null; approvalRef: string | null;
  /** PM 상신 메모 · 가드 무시 기록(JSON) · 재마감 때 옮겨 둔 직전 반려·승인 취소 사유 (P0-1·P0-3) */
  submitNote: string | null; submitOverride: string | null; lastReviewNote: string | null; lastReviewedAt: Date | null; lastReviewedBy: string | null;
};
type MonthRow = {
  ym: string; c?: Closing; status: ClosingStatus; s: Settlement; count: number; flagged: number;
  actions: ClosingAction[]; checks: CheckItem[];
  /** 이 달 미입력 팀원 (알림 문구용 — 화면을 떠나지 않고 바로 독촉) */
  missing: RemindPerson[];
  /** 메인과 함께 상신하는 서브가 있으면 구분별 합계 (메인 먼저) */
  parts: { id: string; label: string; total: number; count: number }[];
  /** 출입증 상태 — 묶음의 출입증 쓰는 프로젝트(구분)마다, 쓰지 않으면 null */
  pass: PassStatementState[] | null;
};

/** 마지막 단계 한 줄 (이전 단계는 title로) */
function lastStep(c: Closing | undefined, status: ClosingStatus, userName: Map<string, string>, revoked = false) {
  // 작성중(마감 해제 포함)이면 이전 마감·상신 시각은 표시하지 않는다
  if (!c || status === "DRAFT") return { text: "", all: "" };
  const steps = [
    c.closedAt && `마감 ${fmtDateTime(c.closedAt)}`,
    c.submittedAt && status !== "CLOSED" && `상신 ${fmtDateTime(c.submittedAt)}`,
    c.reviewedAt && `${revoked ? "승인 취소" : CLOSING_LABEL[status]} ${fmtDateTime(c.reviewedAt)}${c.reviewedBy ? ` · ${userName.get(c.reviewedBy) ?? ""}` : ""}`,
  ].filter(Boolean) as string[];
  return { text: steps.at(-1) ?? "", all: steps.join("\n") };
}

const STAGES = ["작성", "마감", "상신", "승인"] as const;

/** 단계 표시: 작성 → 마감 → 상신 → 승인 (반려면 마지막이 ✕) */
function Stepper({ status, compact, revoked }: { status: ClosingStatus; compact?: boolean; revoked?: boolean }) {
  const { done, failed } = closingStage(status);
  return (
    <ol className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`} aria-label={`진행 단계: ${CLOSING_LABEL[status]}`}>
      {STAGES.map((label, i) => {
        const isFail = failed && i === done;
        const reached = i < done;
        const isNow = !failed && i === done - 1;
        const dot = isFail ? "border-status-rejected bg-status-rejected text-on-primary"
          : reached ? (isNow && status !== "APPROVED" ? "border-primary bg-surface text-primary" : "border-primary bg-primary text-on-primary")
          : "border-line-strong bg-surface text-fg-subtle";
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className={`h-0.5 ${compact ? "w-2" : "w-4 sm:w-6"} rounded ${reached || isFail ? "bg-primary" : "bg-line"}`} />}
            <span className={`flex items-center gap-1 ${compact ? "" : "text-xs"}`}>
              <span aria-hidden className={`flex ${compact ? "size-4" : "size-5"} items-center justify-center rounded-full border-2 ${dot}`}>
                {isFail ? <Icon name="close" sw={2.4} className="size-2.5" /> : reached && !isNow ? <Icon name="check" sw={2.6} className="size-2.5" /> : isNow ? <span className="size-1.5 rounded-full bg-primary" /> : null}
              </span>
              {!compact && <span className={`font-medium ${isFail ? "text-status-rejected" : isNow ? "text-fg" : reached ? "text-fg-2" : "text-fg-muted"}`}>{isFail ? (revoked ? "승인 취소" : "반려") : label}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 마감 준비 체크리스트 (안내용 — 마감을 막지 않는다) */
function Checklist({ items }: { items: CheckItem[] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {items.map((it) => {
        const body = (
          <>
            <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${it.ok ? "bg-surface-muted text-fg-muted" : "bg-amber-100 text-amber-800"}`}>
              {it.ok ? "✓" : "!"}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-semibold ${it.ok ? "text-fg-2" : "text-fg"}`}>
                {it.label}{!it.ok && <span className="sr-only"> (확인 필요)</span>}
              </span>
              {it.detail && <span className={`block text-xs ${it.ok ? "text-fg-muted" : "text-amber-800"}`}>{it.detail}</span>}
            </span>
            {it.href && <Icon name="disclose" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
          </>
        );
        return (
          <li key={it.key}>
            {it.href
              ? <Link href={it.href} className="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-muted">{body}</Link>
              : <div className="flex items-start gap-3 px-3 py-2.5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** 처리 버튼 옆 안내 — 역할·처리 종류별 (재무 승인에게 PM용 마감 안내를 보이지 않게) */
function actionHint(r: MonthRow, role: string, ready: boolean) {
  if (r.actions.includes("approve")) return "상신 내용을 확인한 뒤 승인하거나, 사유를 적어 반려하세요.";
  if (r.actions.includes("revoke")) return "오류가 있으면 사유를 적어 승인 취소하세요. PM이 수정 후 다시 상신합니다.";
  if (r.actions.includes("close")) return ready ? "마감 준비가 끝났습니다." : "확인할 항목이 있어도 마감할 수 있습니다 (검증 불일치 제외).";
  if (r.actions.includes("submit")) return "마감한 내용을 재무 승인 담당에게 상신하세요. 고칠 것이 있으면 마감 해제 후 수정합니다.";
  return role === "ADMIN" ? "시스템 관리자는 조회만 할 수 있습니다. 마감 해제는 PM, 반려·승인 취소는 재무 승인 담당이 합니다." : "";
}

/** 엑셀 단추 이름 — 마감 전에는 미리보기, 마감 후에는 상신 양식, 승인된 달은 저장된 승인본 (lib/snapshot-server) */
const excelLabel = (status: ClosingStatus) => (status === "APPROVED" ? "승인본 엑셀" : isLocked(status) ? "상신 양식 엑셀" : "엑셀 미리보기");

export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const { user, project } = await pageContext(["MANAGER", "HQ", "ADMIN"]);
  const months = projectMonths(project.startDate, project.endDate);
  const now = currentYearMonth();
  // 메인과 함께 상신: 메인이면 서브 지출·정산·점검을 함께, 서브면 마감·상신 없이 메인 상태만 (lib/settle-group.ts)
  const group = await settleGroup(project.id);
  const groupIds = group.ids;
  const inGroup = { projectId: groupIds.length > 1 ? { in: groupIds } : project.id };
  const partOf = new Map([project, ...group.kids].map((p) => [p.id, partLabel(p)]));
  // 출입증 쓰는 프로젝트(구분) — 메인 상신이 서브 출입증도 잠그므로 체크리스트·가드·판단 요약은 묶음 전체를 본다 (P0-1 ③)
  const passProjects = [project, ...group.kids].filter((p) => p.clientPassEnabled);

  const [{ closings, userName }, sums, { rows: flaggedRows, passRows, passLines }, otherSubmitted, payers, passStatements, inputTargets] = await Promise.all([
    // 마감 기록 + 검토자 이름 (검토한 사람·직전 반려 사유를 남긴 사람만 조회)
    prisma.monthlyClosing.findMany({ where: { projectId: { in: [project.id, ...(group.parent ? settleParentIds(await projectRows(), project.id) : [])] } } }).then(async (all) => {
      // 서브: 그 달 메인의 마감 행이 우선 (메인 마감이 서브도 잠근다)
      const closings = group.parent ? mergeSettleClosings(all.filter((c) => c.projectId === project.id), all.filter((c) => c.projectId !== project.id)) : all;
      const ids = [...new Set(closings.flatMap((c) => [c.reviewedBy, c.lastReviewedBy]).filter((id): id is string => !!id))];
      const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      return { closings, userName: new Map(users.map((u) => [u.id, u.name])) };
    }),
    // 정산·입력 확인용 합계: 월·결제자·결제방법·본사별 (지출 행 전체를 읽지 않는다)
    prisma.expense.groupBy({
      by: ["projectId", "yearMonth", "payerId", "payMethod", "isHq"],
      where: inGroup,
      _sum: { amount: true },
      _count: true,
    }),
    // 규정 점검 결과가 있는 건만 (점검·소명 확인용) — 출입증 중복 의심은 지금 출입증 결정 기준으로 다시 계산 (lib/pass-budget)
    // + 출입증 회사 부담 줄 (확정분은 정산 총합계·본사에, 상신 엑셀과 같게)
    passCompanyLines(groupIds.join(",")).then(async (pass) => {
      const select = { id: true, projectId: true, yearMonth: true, payerId: true, flags: true, justification: true, date: true, amount: true, detail: true, isHq: true, itemId: true, item: { select: { name: true } }, payer: { select: { name: true } } } as const;
      const linked = [...new Set(pass.map((l) => l.linkedItemId).filter((x): x is string => !!x))];
      const [flagged, maybeDup] = await Promise.all([
        prisma.expense.findMany({ where: { ...inGroup, flags: { not: null } }, select, orderBy: { date: "asc" } }),
        linked.length ? prisma.expense.findMany({ where: { ...inGroup, flags: null, isHq: false, itemId: { in: linked } }, select, orderBy: { date: "asc" } }) : [],
      ]);
      const all = [...flagged, ...maybeDup].sort((a, b) => a.date.getTime() - b.date.getTime());
      const dup = passDuplicateIds(all.map((e) => ({ ...e, date: formatDate(e.date) })), pass);
      const rows = all.map((e) => ({ ...e, flags: withPassDup(e.flags, dup.has(e.id)) })).filter((e) => e.flags);
      return { rows, passRows: passBudgetSpend(pass).confirmedRows, passLines: pass };
    }),
    // 이 화면은 지금 고른 프로젝트만 다룬다. 재무 승인에게는 다른 프로젝트의 승인 대기 건수만 바로가기로 (목록은 전체 프로젝트 화면)
    // (프로젝트 기간·종료는 요청 안에서 이미 읽은 전체 프로젝트 목록에서 — 관계 조회 없이)
    isHqLike(user)
      ? Promise.all([prisma.monthlyClosing.findMany({ where: { status: "SUBMITTED", projectId: { not: project.id } }, select: { projectId: true } }), projectRows()])
          .then(([list, nodes]) => { const byId = new Map(nodes.map((p) => [p.id, p])); return list.flatMap((c) => { const p = byId.get(c.projectId); return p ? [{ project: p }] : []; }); })
      : [],
    // 입력 n/m명 — 결제자 마스터 (현황·정산표와 같은 기준)
    getPayers(groupIds.length > 1 ? groupIds : project.id),
    passProjects.length
      ? prisma.passStatement.findMany({ where: { projectId: { in: passProjects.map((p) => p.id) } }, select: { projectId: true, yearMonth: true, status: true } })
      : [],
    // 미입력 확인 대상: 자기에게 열린 지출 항목이 있는 팀원만 (PM·항목 없는 팀원 제외 — 팀원 조회는 결제자 조회와 함께 쓴다)
    Promise.all([projectMembersOf(groupIds.join(",")), sqlInputSources(groupIds)]).then(([members, sources]) => inputMemberIds(members, sources)),
  ]);
  // 보관된 프로젝트는 제외 (전체 프로젝트 목록과 같은 기준)
  const nowDate = new Date();
  const otherWaiting = otherSubmitted.filter((c) => projectPhase(c.project, nowDate) !== "ARCHIVED").length;
  /** 재무 승인 검토용 월 시트 데이터 (그 달 지출만 읽는다) */
  const loadSheet = async (ym: string) => {
    const prefixById = new Map<string, string | null>([[project.id, project.excelPrefix], ...group.kids.map((k) => [k.id, k.excelPrefix] as [string, string | null])]);
    const prefixOf = (id: string) => prefixById.get(id);
    const raw = await prisma.expense.findMany({
      where: { ...inGroup, yearMonth: ym },
      select: {
        id: true, projectId: true, isHq: true, payMethod: true, payerId: true, payer: { select: { name: true } }, date: true, amount: true, detail: true,
        headcount: true, attendees: true, itemId: true, yearMonth: true, item: { select: { name: true, categoryId: true, category: { select: { name: true } } } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    // 항목 이름 = 구분명_항목 (메인·서브 함께 상신) — 엑셀과 같게
    const expenses: SheetExpense[] = raw.map((e) => { const px = prefixOf(e.projectId); return px ? { ...e, item: { ...e.item, name: excelItemName(px, e.item.name) } } : e; });
    const pass = passExcelRows(passLines.map((l) => { const px = prefixOf(l.projectId); return px && l.linkedItemName ? { ...l, linkedItemName: excelItemName(px, l.linkedItemName) } : l; }), ym);
    const payersIn = payers.filter((p) => servedInMonth(p, ym));
    return monthSheetData({ ym, expenses, pass, payersIn, labelOf: payerLabels(payersIn, expenses).labelOf, passDate: passRowDate(ym, project.endDate), passVendor: project.clientPassName ?? undefined });
  };
  // 월별로 한 번만 나눠 둔다 (합계 행은 정산 계산에 그대로 쓴다 — 결제자·결제방법·본사별 합이므로 결과가 같다)
  type SumRow = { projectId: string; payerId: string; payMethod: string; isHq: boolean; itemId: string; yearMonth: string; amount: number; count: number };
  const byMonth = new Map<string, SumRow[]>();
  for (const g of sums) {
    const row: SumRow = { projectId: g.projectId, payerId: g.payerId, payMethod: g.payMethod, isHq: g.isHq, itemId: "", yearMonth: g.yearMonth, amount: toNumber(g._sum.amount), count: g._count };
    const list = byMonth.get(g.yearMonth);
    if (list) list.push(row);
    else byMonth.set(g.yearMonth, [row]);
  }
  // 출입증 회사 부담 확정분: 본사 집행으로 (건수에는 넣지 않음 — 카드 지출 건수)
  for (const r of passRows) {
    const row: SumRow = { projectId: r.projectId, payerId: "", payMethod: PASS_PAY_METHOD, isHq: true, itemId: r.itemId, yearMonth: r.yearMonth, amount: r.amount, count: 0 };
    const list = byMonth.get(r.yearMonth);
    if (list) list.push(row);
    else byMonth.set(r.yearMonth, [row]);
  }
  const flagsOf = new Map<string, typeof flaggedRows>();
  for (const e of flaggedRows) {
    const list = flagsOf.get(e.yearMonth);
    if (list) list.push(e);
    else flagsOf.set(e.yearMonth, [e]);
  }
  const closingOf = new Map(closings.map((c) => [c.yearMonth, c]));
  // 보여 줄 달 — 앞으로의 달은 마감 기록이 있을 때만 (해제해 작성중으로 돌아간 달은 다시 숨김), 최근 달이 위
  // (아래 상세 조회를 한 번에 하려고 고른 달을 먼저 정한다 — 상태·년월만으로 정해진다)
  const statusAt = (ym: string) => (closingOf.get(ym)?.status ?? "DRAFT") as ClosingStatus;
  const shownMonths = months.filter((m) => m <= now || (closingOf.has(m) && closingOf.get(m)!.status !== "DRAFT")).reverse();
  // 선택한 달: ?ym= → 마지막 본 달(쿠키) → 역할별 지금 처리할 달 (재무 승인: 승인 대기 / PM: 반려 → 마감 → 지난 작성중) → 이번 달 → 가장 최근 달
  const wanted = await wantedYm((await searchParams).ym, shownMonths);
  const fallback = defaultClosingMonth(shownMonths.map((ym) => ({ ym, status: statusAt(ym) })), user.role, now);
  const selectedYm = shownMonths.find((m) => m === wanted) ?? shownMonths.find((m) => m === fallback) ?? shownMonths[0] ?? null;
  // 재무 승인 상세의 팀원별 정산: 결제자 목록(직급 → 성명) + 목록 밖 결제자 이름
  const hqView = isHqLike(user);
  const payerName = new Map<string, string>(payers.map((p) => [p.id, p.name]));
  const unknown = hqView ? [...new Set(sums.map((g) => g.payerId))].filter((id) => !payerName.has(id)) : [];
  const selectedClosingId = selectedYm ? closingOf.get(selectedYm)?.id ?? null : null;
  const selectedClosing = selectedYm ? closingOf.get(selectedYm) ?? null : null;
  const [people, revoked, sheet, h, range, snapshots, hq] = await Promise.all([
    // 미입력 알림 문구용 이메일 + (재무 승인) 목록 밖 결제자 이름 — 한 번에
    prisma.user.findMany({ where: { id: { in: [...new Set([...payers.map((p) => p.id), ...unknown])] } }, select: { id: true, name: true, email: true } }),
    // 반려 상태 중 '승인 취소'로 돌아온 달 (표시만 다르게 — 상태 값은 같다)
    revokedClosingIds(shownMonths.flatMap((ym) => { const c = closingOf.get(ym); return c?.status === "REJECTED" ? [c.id] : []; })),
    // 재무 승인 검토: 고른 달의 집행내역을 상신 엑셀 월 시트와 같은 구성으로 (lib/month-sheet — 엑셀 출력과 같은 계산). 그 달 지출만 읽는다
    hqView && selectedYm ? loadSheet(selectedYm) : null,
    headers(),
    // 팀원별 정산 연간 추이: 함께 상신하는 서브 포함(groupIds) × 프로젝트 기간 전체 — 현황의 팀원별 정산과 같은 범위.
    // 다른 사람 이름·금액을 보는 사람만 (조회 전용 상위 PM·조직장 제외), 보여 줄 달이 있을 때만
    canSeeAllRows(user) && shownMonths.length ? getSettlementRange(groupIds, months) : null,
    // 고른 달의 상신본·승인본 (파일 없이) + 다운로드 기록(Export 감사 기록, entityId = 스냅샷 id) — 횟수·마지막 내려받은 사람
    selectedClosingId && canSeeAllRows(user) ? listSnapshots(selectedClosingId).then(async (list) => {
      if (!list.length) return { list, stats: new Map<string, { count: number; last: { at: Date; userId: string } }>(), names: new Map<string, string>() };
      const logs = await prisma.auditLog.findMany({ where: { entity: "Export", entityId: { in: list.map((x) => x.id) } }, select: { entityId: true, userId: true, createdAt: true } });
      const stats = downloadStats(logs);
      const ids = [...new Set([...list.map((x) => x.createdBy), ...[...stats.values()].map((x) => x.last.userId)])];
      const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      return { list, stats, names: new Map(users.map((u) => [u.id, u.name])) };
    }) : null,
    // 재무 승인 판단 요약 (P0-3): 예산 대비 집행(상신 엑셀과 같은 데이터)·검토 이력·반려 이후 바뀐 지출
    // 자기 승인 경고(P0-3 ④)는 승인할 사람(재무 승인 담당) 기준 — 시스템 관리자는 승인하지 않으므로 계산 안 함
    hqView && selectedYm ? loadHqSummary({ projectId: project.id, ym: selectedYm, groupIds, closing: selectedClosing, approverId: user.role === "HQ" ? user.id : null }) : null,
  ]);
  const emailOf = new Map(people.map((u) => [u.id, u.email]));
  for (const u of people) if (!payerName.has(u.id)) payerName.set(u.id, u.name);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const passOf = new Map(passStatements.map((p) => [`${p.projectId}|${p.yearMonth}`, p.status === "CONFIRMED" ? "CONFIRMED" as const : "OPEN" as const]));
  /** 그 달 출입증 상태 — 구분별 (회사 부담인데 연결 예산 항목이 없는 줄은 확정해도 본사 집행내역·예산에 빠지므로 건수를 함께) */
  const passStatesOf = (ym: string): PassStatementState[] | null => passProjects.length
    ? passProjects.map((p) => ({
      projectId: p.id, label: partOf.get(p.id)!, status: passOf.get(`${p.id}|${ym}`) ?? "NONE",
      unlinked: passLines.filter((l) => l.projectId === p.id && l.yearMonth === ym && l.decision === "OVERTIME" && !l.linkedItemId).length,
    }))
    : null;

  const rowOf = (ym: string): MonthRow => {
    const c = closingOf.get(ym);
    const status = (c?.status ?? "DRAFT") as ClosingStatus;
    const list = byMonth.get(ym) ?? [];
    const flagged = flagsOf.get(ym) ?? [];
    const s = settle(list, hqView ? payers.filter((p) => servedInMonth(p, ym)).map((p) => p.id) : []);
    const pass = passStatesOf(ym);
    return {
      ym, c, status, s, count: list.reduce((a, g) => a + g.count, 0), pass,
      flagged: flagged.length,
      // 입력 대상인데 이 달 지출이 없는 팀원 (체크리스트의 "미입력"과 같은 기준)
      missing: payers.filter((p) => servedInMonth(p, ym) && inputTargets.has(p.id) && !list.some((g) => g.payerId === p.id && g.payMethod !== PASS_PAY_METHOD)).map((p) => ({ id: p.id, name: p.name, email: emailOf.get(p.id) ?? null })),
      // 서브(메인과 함께 상신)는 단독 마감·상신 없음
      actions: user.readOnly || group.parent ? [] : availableActions(status, user.role),
      parts: group.kids.length ? [project, ...group.kids].map((p) => {
        const mine = list.filter((g) => g.projectId === p.id);
        return { id: p.id, label: partOf.get(p.id)!, total: mine.reduce((a, g) => a + g.amount, 0), count: mine.reduce((a, g) => a + g.count, 0) };
      }) : [],
      checks: closingChecklist({
        ym, isValid: s.isValid,
        payers: payers.filter((p) => servedInMonth(p, ym) && inputTargets.has(p.id)),
        // 결제자별 입력 여부(합계 행) + 점검·소명(점검 건)
        expenses: [...list.filter((g) => g.payMethod !== PASS_PAY_METHOD).map((g) => ({ payerId: g.payerId, flags: null, justification: null })), ...flagged],
        pass,
      }),
    };
  };
  // 최근 달이 위 (년월 기준 — 반려된 달은 테두리·배지로 구분)
  const rows = shownMonths.map(rowOf);

  /** 이번 달 작성중 — 아직 쓰는 중이라 처리할 달이 아니다 */
  const isOngoing = (r: MonthRow) => r.ym === now && r.status === "DRAFT";
  const ongoing = rows.find(isOngoing) ?? null;
  const todo = rows.filter((r) => r.status !== "APPROVED" && !isOngoing(r));
  const isRevoked = (r: MonthRow) => !!r.c && revoked.has(r.c.id);
  // 작성중인 지난 달은 팀원 입력 기한(다음 달 3일)이 지나면 '마감 대기' (lib/month-phase)
  const today = seoulToday();
  const phaseOf = (r: MonthRow) => monthPhase(r.ym, r.status, today);
  const badgeOf = (r: MonthRow) => (isRevoked(r) ? <span className="badge badge-bad">승인 취소됨</span> : isOngoing(r) ? <span className="badge badge-info">진행 중</span> : <StatusBadge status={phaseOf(r)} />);
  // 처리 후 안내할 다음 달 (처리할 달 중 이 달이 아닌 첫 달)
  const nextOf = (ym: string) => todo.find((r) => r.ym !== ym)?.ym ?? null;
  const done = rows.filter((r) => r.status === "APPROVED");
  const selected = rows.find((r) => r.ym === selectedYm) ?? null;

  /** 처리할 달·승인 완료 목록의 한 줄 (누르면 그 달 상세) */
  const listRow = (r: MonthRow) => {
    const sum = checklistSummary(r.checks);
    const isSel = r.ym === selected?.ym;
    return (
      <li key={r.ym}>
        <MonthLink href={`/closing?ym=${r.ym}`} selected={isSel} chevron
          className={`relative flex items-center gap-3 px-4 py-3 transition-colors ${isSel ? "bg-brand-50" : "hover:bg-surface-muted"}`}>
          {isSel && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary" />}
          {!isSel && r.status === "REJECTED" && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-status-rejected" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold">{ymKo(r.ym)}</span>
              {badgeOf(r)}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {!hqView && <Stepper status={r.status} compact revoked={isRevoked(r)} />}
              <span className={`truncate text-xs ${sum.ok || isOngoing(r) || hqView || r.status === "SUBMITTED" || r.status === "CLOSED" ? "text-fg-muted" : "font-medium text-amber-800"}`}>
                {r.status === "APPROVED" || isOngoing(r) || hqView ? `${r.count}건` : r.status === "SUBMITTED" ? `승인 대기 · ${r.count}건` : r.status === "CLOSED" ? `상신 전 · ${r.count}건` : sum.text}
              </span>
            </div>
          </div>
          <span className="tabular shrink-0 text-right text-sm font-semibold">{won(r.s.total)}<span className="text-xs font-normal text-fg-muted">원</span></span>
        </MonthLink>
      </li>
    );
  };

  /** 재무 승인: 달 카드 (가로 목록) — 년월·상태·총합계·건수. 누르면 아래 상세가 그 달로 */
  const monthChip = (r: MonthRow) => {
    const isSel = r.ym === selected?.ym;
    return (
      <li key={r.ym} className="shrink-0">
        <MonthLink href={`/closing?ym=${r.ym}`} selected={isSel}
          className={`block min-w-[9.5rem] rounded-xl border px-4 py-3 transition-colors ${isSel ? "border-primary bg-brand-50 ring-2 ring-primary/20" : r.status === "REJECTED" ? "border-status-rejected/40 bg-surface hover:bg-surface-muted" : isOngoing(r) || r.status === "DRAFT" ? "border-dashed border-line-strong bg-surface text-fg-muted hover:bg-surface-muted" : "border-line bg-surface hover:bg-surface-muted"}`}>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">{ymKo(r.ym)}</span>
            {badgeOf(r)}
          </div>
          <div className="tabular mt-1 flex items-baseline gap-2 text-sm">
            <span className="font-semibold">{won(r.s.total)}<span className="text-xs font-normal text-fg-muted">원</span></span>
            <span className="text-xs text-fg-muted">{r.count}건</span>
          </div>
        </MonthLink>
      </li>
    );
  };

  // 엑셀(팀원별 정산·참석자 개인정보 포함)은 조회 권한(상위 PM·조직장)이 받을 수 없다
  const canExcel = user.readOnlyReason !== "view";

  /** 연간 추이 (맨 아래, 기본 접힘) — 누적 팀원 정산·검증 불일치 달 찾기용. 고른 달 열을 강조한다 */
  const trend = range && (
    <div className="mt-5">
      <SettlementTrend range={range} allMonths={months} ym={selected?.ym ?? now}
        yearTeamTotal={months.reduce((a, m) => a + Object.values(range.byMonth[m].byPayer).reduce((x, y) => x + y, 0), 0)}
        invalidMonths={months.filter((m) => !range.byMonth[m].isValid)} />
    </div>
  );

  /** 재무 승인 검토용: 팀원별 정산(개인 법인카드 + 공용 법인카드 + 본사 = 계)과 규정 점검 건의 소명 */
  /**
   * 재무 승인 검토 — 상신 엑셀 월 시트와 같은 구성의 집행내역(규정 점검·소명은 해당 줄에) + 팀원별 정산금액(접힘).
   * 재무 승인은 팀원별 금액보다 집행내역 자체를 보고 승인·반려를 판단한다.
   */
  const HqReview = ({ r }: { r: MonthRow }) => {
    if (!sheet) return null;
    const flagged = (flagsOf.get(r.ym) ?? []).filter((e) => needsReview(e.flags));
    const unexplained = flagged.filter((e) => !e.justification?.trim()).length;
    // 판단 요약 입력 — 전월은 보여 줄 달 목록에서 (없으면 비교 생략)
    const prevRow = rows.find((x) => x.ym === addMonths(r.ym, -1)) ?? null;
    const override = parseSubmitOverride(r.c?.submitOverride);
    const rejectNow = r.status === "REJECTED" && !!r.c?.reviewNote;
    const rejectNote = rejectNow
      ? { current: true, revoked: isRevoked(r), note: r.c!.reviewNote!, at: r.c!.reviewedAt, by: r.c!.reviewedBy ? userName.get(r.c!.reviewedBy) ?? null : null }
      : r.c?.lastReviewNote ? { current: false, revoked: false, note: r.c.lastReviewNote, at: r.c.lastReviewedAt, by: r.c.lastReviewedBy ? userName.get(r.c.lastReviewedBy) ?? null : null } : null;
    const summary = hq && (
      <HqSummary
        ym={r.ym} status={r.status}
        kpi={{
          total: r.s.total, count: r.count, prev: prevRow ? { ym: prevRow.ym, total: prevRow.s.total } : null,
          cumulative: { planned: hq.table.totals.planned, spent: hq.table.totals.spent, remaining: hq.table.totals.remaining },
          missing: r.missing.length, flagged: flagged.length, unexplained,
          passText: passStatusText(r.pass), passOk: r.pass ? r.pass.every((p) => p.status === "CONFIRMED" && p.unlinked === 0) : null,
          submitNote: r.c?.submitNote ?? null, override,
        }}
        table={hq.table}
        selfApproval={hq.selfApproval}
        payers={prevRow ? payerCompare(r.s.byPayer, prevRow.s.byPayer, (id) => payerName.get(id) ?? id, payers.map((p) => p.id)) : null}
        history={{
          rejectNote,
          timeline: hq.timeline.map((e) => ({ ...e, by: hq.userName.get(e.byId) ?? "" })),
          sinceAt: hq.sinceAt,
          changes: hq.changes.map((c) => ({
            ...c, by: hq.userName.get(c.byId) ?? "", payer: c.payerId ? hq.userName.get(c.payerId) ?? payerName.get(c.payerId) ?? "" : "",
            item: c.itemId ? hq.itemName.get(c.itemId) ?? "" : "", itemAfter: c.itemAfterId ? hq.itemName.get(c.itemAfterId) ?? "" : null,
          })),
          truncated: hq.changesTruncated,
        }}
      />
    );
    const marks = new Map<string, SheetMark>(flagged.map((e) => [e.id, {
      labels: parseFlags(e.flags).filter((c) => !isAdvisory(c)).map((c) => flagLabel(c, e.item.name)),
      justification: e.justification?.trim() || null,
    }]));
    const line = (label: React.ReactNode, amount: number, cls = "") => (
      <div className={`flex items-baseline justify-between gap-3 py-1.5 ${cls}`}>
        <span className="min-w-0 truncate">{label}</span>
        <span className={`tabular shrink-0 ${amount ? "" : "text-fg-subtle"}`}>{dash0(amount)}</span>
      </div>
    );
    return (
      <>
        {summary}
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="section-title">집행내역 <span className="text-xs font-normal text-fg-muted">상신 엑셀 월 시트와 같은 구성</span></h3>
            <span className={`text-xs ${flagged.length === 0 ? "text-fg-muted" : unexplained ? "font-semibold text-status-rejected" : "font-medium text-amber-800"}`}>
              {flagged.length === 0 ? "규정 점검에 걸린 건 없음" : `규정 점검 ${flagged.length}건${unexplained ? ` · 소명 필요 ${unexplained}건` : " · 모두 소명됨"}`}
            </span>
          </div>
          {(() => {
            // 확정된 회사 부담인데 연결 예산 항목이 없어 표에 빠진 줄 — 재무 승인이 바로 알 수 있게
            const miss = passLines.filter((l) => l.yearMonth === r.ym && l.confirmed && l.decision === "OVERTIME" && !l.linkedItemId);
            if (!miss.length) return null;
            const names = [...new Set(miss.map((l) => l.usageItemName))].join(", ");
            return (
              <div className="alert alert-warn mb-2 block text-sm">
                출입증 회사 부담 <b className="tabular">{miss.length}건 {won(miss.reduce((a, l) => a + l.amount, 0))}원</b>이 예산 항목에 연결되지 않아 본사 집행내역에 빠졌습니다 (항목: {names}).{" "}
                <Link href={withCtx("/budget?from=closing", { ym: r.ym })} className="font-semibold underline underline-offset-2">프로젝트 운영비에서 연결 ›</Link>
              </div>
            );
          })()}
          <MonthSheetView sheet={sheet} marks={marks} />
        </div>
        <details className="group/slots">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="section-title">팀원별 정산금액</span>
            <span className="flex items-center gap-2 text-xs">
              <span className={r.s.isValid ? "text-fg-muted" : "font-semibold text-status-rejected"}>{r.s.isValid ? "✓ 합계 일치" : "✕ 검증 불일치"}</span>
              <Icon name="down" sw={1.8} className="size-4 text-fg-subtle transition-transform group-open/slots:rotate-180" />
            </span>
          </summary>
          <div className="mt-2 divide-y divide-line rounded-xl border border-line px-3 text-sm">
            {sheet.slots.map((p) => <div key={p.label}>{line(p.label, p.amount)}</div>)}
            {line(<span className="text-fg-muted">{PAY_METHOD_LABEL.SHARED_CARD}</span>, r.s.sharedCard)}
            {line(<span className="text-fg-muted">{PAY_METHOD_LABEL.HQ}</span>, r.s.hq - r.s.pass)}
            {r.s.pass > 0 && line(<span className="text-fg-muted">출입증 회사 부담 (본사 집행)</span>, r.s.pass)}
            {line(<b>계</b>, r.s.total, "font-bold")}
          </div>
        </details>
      </>
    );
  };

  /** 상신본·승인본 (고른 달) — 한 줄씩: 종류 v버전 · 시각 · 만든 사람 · 크기 · SHA-256 앞 12자 · 다운로드 횟수(마지막) + 내려받기 */
  const SnapshotList = ({ closingId, list, stats, names }: { closingId: string; list: SnapshotMeta[]; stats: ReturnType<typeof downloadStats>; names: Map<string, string> }) => (
    <div>
      <h3 className="section-title mb-1.5">상신본·승인본 <span className="text-xs font-normal text-fg-muted">상신·승인 시점에 저장한 엑셀</span></h3>
      <ul className="divide-y divide-line rounded-xl border border-line text-sm">
        {list.map((sn) => {
          const st = stats.get(sn.id);
          return (
            <li key={sn.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1">
                <b>{isSnapshotKind(sn.kind) ? SNAPSHOT_LABEL[sn.kind] : sn.kind} v{sn.version}</b>
                <span className="text-fg-muted"> · {fmtDateTime(sn.createdAt)} · {names.get(sn.createdBy) ?? ""} · {formatBytes(sn.size)} · </span>
                <span className="tabular text-xs text-fg-muted" title={`SHA-256 ${sn.sha256}`}>SHA-256 {shortSha(sn.sha256)}</span>
                <span className="block text-xs text-fg-muted break-keep sm:inline sm:before:content-['_·_']">
                  {st ? `다운로드 ${st.count}회(마지막 ${fmtDateTime(st.last.at)} ${names.get(st.last.userId) ?? ""})` : "다운로드 없음"}
                </span>
              </span>
              <a className="btn-ghost btn-sm shrink-0" href={`/api/closings/${closingId}/snapshots/${sn.id}`} title={sn.fileName}><Icon name="download" />내려받기</a>
            </li>
          );
        })}
      </ul>
    </div>
  );

  /** 선택한 달 상세 */
  const detail = (r: MonthRow) => {
    const step = lastStep(r.c, r.status, userName, isRevoked(r));
    const sum = checklistSummary(r.checks);
    const hasActions = r.actions.length > 0;
    // 상신 정보: PM 상신 메모 · 가드를 넘긴 사유(출입증 확정 전 등) — 상신 이후 상태에서만 (마감 해제·재마감하면 다음 상신 때 새로 적는다)
    const override = parseSubmitOverride(r.c?.submitOverride);
    const submitInfo = r.c && r.status !== "DRAFT" && r.status !== "CLOSED" && (override || r.c.submitNote) ? (
      <div className="rounded-xl border border-line px-4 py-2.5 text-sm" aria-label="상신 정보">
        {override && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="badge badge-warn">확인 항목을 넘겨 상신</span>
            <span className="text-xs text-fg-muted">{overrideLabels(override)}</span>
            <span className="basis-full">사유 · {override.reason}</span>
          </div>
        )}
        {r.c.submitNote && <div className={override ? "mt-1" : ""}><span className="text-xs text-fg-muted">상신 메모 · </span>{r.c.submitNote}</div>}
      </div>
    ) : null;
    // 승인 확인 패널 한 줄 (재무 승인): 총액·규정 점검(소명 없음)·출입증·예산 초과 항목 + 자기 승인 경고(본인이 입력한 본사 지출 — 차단 아님)
    const hqFlagged = (flagsOf.get(r.ym) ?? []).filter((e) => needsReview(e.flags));
    const hqUnexplained = hqFlagged.filter((e) => !e.justification?.trim()).length;
    const approveSummary = r.actions.includes("approve")
      ? {
        text: approveSummaryText({ total: r.s.total, flagged: hqFlagged.length, unexplained: hqUnexplained, passText: passStatusText(r.pass), warnCount: hq?.table.warnCount ?? 0 }),
        unexplained: hqUnexplained,
        selfApproval: hq?.selfApproval ?? null,
      }
      : undefined;
    return (
      // overflow-clip: hidden과 같이 모서리를 자르되 스크롤 컨테이너가 되지 않아 안쪽 집행내역 표 머리글 sticky가 산다
      <section className="card overflow-clip" aria-labelledby="sel-h">
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="sel-h" className="section-title">{ymKo(r.ym)}</h2>
                {badgeOf(r)}
              </div>
              {!hqView && <div className="mt-2"><Stepper status={r.status} revoked={isRevoked(r)} /></div>}
            </div>
            <Link href={ledgerHref(r.ym)} className="btn-secondary btn-sm">지출 내역 ›</Link>
          </div>

          {r.status === "REJECTED" && r.c?.reviewNote && (
            <div className="alert alert-danger">
              <div><b>{isRevoked(r) ? "승인 취소됨 · 사유" : "반려 사유"}</b> · {r.c.reviewNote}
                {/* 다음 행동은 실제로 할 수 있는 사람 기준: 메인 PM만 다시 마감·상신한다 (서브 PM은 수정만, 재무 승인·조회는 기다림) */}
                <div className="mt-0.5 text-xs">
                  {hasActions ? "내용을 수정한 뒤 다시 마감·상신하세요."
                    : group.parent ? `내용을 수정하면 ${(group.parentFor(r.ym) ?? group.parent).name} PM이 다시 마감·상신합니다.`
                    : "PM이 내용을 수정한 뒤 다시 마감·상신합니다."}
                </div>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-3 gap-3 rounded-xl bg-surface-muted px-4 py-3">
            {/* 좁은 화면: 총합계가 잘리지 않게 두 칸 */}
            <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-xs text-fg-muted">총합계</dt><dd className="tabular truncate text-xl font-bold sm:text-kpi">{won(r.s.total)}<span className="text-xs font-normal text-fg-muted">원</span></dd></div>
            <div><dt className="text-xs text-fg-muted">건수</dt><dd className="tabular text-xl font-bold sm:text-kpi">{r.count}<span className="text-xs font-normal text-fg-muted">건</span></dd></div>
            {step.text && <div className="col-span-3 min-w-0 sm:col-span-1"><dt className="text-xs text-fg-muted">마지막 처리</dt><dd className="tabular truncate text-sm font-medium" title={step.all || undefined}>{step.text}</dd></div>}
          </dl>

          {submitInfo}

          {r.parts.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="구분별 합계">
              <span className="text-xs text-fg-muted">구분별 (함께 상신)</span>
              {r.parts.map((p) => (
                <span key={p.id} className="tabular"><b>{p.label}</b> {won(p.total)}원 <span className="text-xs text-fg-muted">{p.count}건</span></span>
              ))}
            </div>
          )}

          {hqView ? <HqReview r={r} /> : (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="section-title">마감 준비</h3>
                {/* 미입력 팀원 독촉은 여기서 바로 (현황으로 갔다 올 필요 없이) */}
                {r.missing.length > 0 && r.status === "DRAFT" && <RemindButton groups={[{ kind: "noinput", people: r.missing }]} ym={r.ym} projectName={project.name} origin={origin} projectId={project.id} />}
                <span className={`text-xs ${sum.ok ? "text-fg-muted" : "font-medium text-amber-800"}`}>{sum.ok ? "준비 완료" : `확인 ${r.checks.filter((c) => !c.ok).length}건`}</span>
              </div>
              <Checklist items={r.checks} />
            </div>
          )}

          {/* 재마감 뒤에도 직전 반려·승인 취소 사유가 남는다 (lastReviewNote) — 재무 승인은 판단 요약의 검토 이력에서 본다 */}
          {!hqView && r.status !== "REJECTED" && (r.c?.reviewNote || r.c?.lastReviewNote) && (
            <p className="text-xs text-fg-muted"><b className="text-status-rejected">이전 반려 사유</b> · {r.c.reviewNote ?? r.c.lastReviewNote}</p>
          )}
          {r.status === "APPROVED" && r.c && (
            <ApprovalRef closingId={r.c.id} value={r.c.approvalRef} editable={user.role === "HQ" && !user.readOnly} />
          )}
          {snapshots && r.c && snapshots.list.length > 0 && <SnapshotList closingId={r.c.id} {...snapshots} />}
          {canExcel && (
            <div className="flex flex-wrap items-center gap-1">
              <a className="btn-ghost btn-sm" href={`/api/projects/${project.id}/export?ym=${r.ym}`}
                title={r.status === "APPROVED" ? "승인 시점에 저장한 승인본을 그대로 받습니다" : r.status === "SUBMITTED" ? "상신 시점에 저장한 상신본을 그대로 받습니다" : undefined}>
                <Icon name="download" />{excelLabel(r.status)}
              </a>
              {r.status === "APPROVED" && hqView && (
                <a className="btn-ghost btn-sm text-xs text-fg-muted" href={`/api/projects/${project.id}/export?ym=${r.ym}&live=1`}
                  title="지금 데이터로 다시 만든 엑셀 (파일 이름에 _수정본_현재)">현재 데이터로 다시 생성</a>
              )}
              {/* 기존 상신 통합문서와 병행: 이 달 월 시트 하나만 (기존 파일에 옮겨 붙이기) */}
              <a className="btn-ghost btn-sm" href={`/api/projects/${project.id}/export?ym=${r.ym}&sheet=month`}
                title={`기존 상신 엑셀에 옮겨 붙일 ${Number(r.ym.slice(5))}월 시트만 받습니다${isLocked(r.status) ? "" : " (작성 중 — 파일 이름에 표시)"}`}>
                <Icon name="download" />{Number(r.ym.slice(5))}월 시트만 받기
              </a>
            </div>
          )}
          {!hasActions && !group.parent && (user.readOnly || user.role !== "MANAGER") && (
            <p className="text-xs text-fg-muted">{user.readOnly ? "조회 전용입니다." : "마감·상신은 PM이 합니다."}</p>
          )}
        </div>
        {hasActions && (
          <StickyAction className="px-3 pb-3">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted lg:hidden">{ymKo(r.ym)} · {MONTH_PHASE_LABEL[phaseOf(r)]}</span>
            <span className="hidden min-w-0 flex-1 text-sm text-fg-muted lg:block">{actionHint(r, user.role, sum.ok)}</span>
            <ClosingActions projectId={project.id} yearMonth={r.ym} closingId={r.c?.id} actions={r.actions} valid={r.s.isValid} nextYm={nextOf(r.ym)} approveSummary={approveSummary} />
          </StickyAction>
        )}
      </section>
    );
  };

  return (
    <div>
      <PageHeader title="마감 · 상신"
        desc={group.kids.length ? `작성 → 마감 → 상신 → 승인. 함께 상신하는 ${group.kids.map(partLabel).join("·")} 지출이 포함됩니다.` : "작성 → 마감 → 상신 → 승인. 반려되면 PM이 수정 후 다시 마감·상신합니다."}
        // 월 이동 — 다른 월 화면과 같은 자리 (목록은 최근 달이 위라 오래된 달부터로 뒤집어 넘긴다)
        month={selectedYm ? <MonthNav months={[...shownMonths].reverse()} value={selectedYm} /> : undefined}>
        {otherWaiting > 0 && user.role === "HQ" && (
          <Link href="/projects" className="badge badge-info min-h-9 px-3 hover:underline">
            다른 프로젝트 승인 대기 {otherWaiting}건 ›
          </Link>
        )}
      </PageHeader>

      {group.parent && (
        <div className="alert alert-info mb-4">
          <div>
            <b>{settleWithParentMessage(group.parent.name)}</b>
            <div className="mt-0.5 text-sm">{group.parent.name}이(가) 마감하면 이 프로젝트의 같은 달 지출도 잠깁니다. 여기서는 팀원 입력과 소명을 확인하세요.</div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty card icon="inbox" title="아직 마감할 달이 없습니다">프로젝트 기간이 시작되면 달마다 마감·상신할 수 있습니다.</Empty>
      ) : hqView ? (
        /* 재무 승인: 달 카드를 위에 가로로, 그 아래 고른 달의 월 시트를 전체 폭으로 (월 시트 아홉 열이 잘리지 않게) */
        <div className="space-y-5">
          <section aria-labelledby="todo-h">
            <h2 id="todo-h" className="section-title mb-2">검토할 달 <span className="tabular text-primary">{todo.filter((m) => m.status === "SUBMITTED" || m.status === "REJECTED").length}</span></h2>
            {todo.length === 0 && !ongoing ? (
              <Empty card icon="inbox">모든 달이 승인됐습니다.</Empty>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label="처리할 달">
                {[...todo, ...(ongoing ? [ongoing] : [])].sort((a, b) => b.ym.localeCompare(a.ym)).map(monthChip)}
              </ul>
            )}
          </section>
          {done.length > 0 && (
            <details className="group/done" open={todo.length === 0 || selected?.status === "APPROVED"}>
              <summary className="mb-2 flex min-h-10 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span className="section-title">승인 완료 <span className="tabular text-fg-muted">{done.length}</span></span>
                <Icon name="down" sw={1.8} className="size-4 text-fg-subtle transition-transform group-open/done:rotate-180" />
              </summary>
              <ul className="flex flex-wrap gap-2" aria-label="승인 완료">{done.map(monthChip)}</ul>
            </details>
          )}
          <div id="month-detail" className="scroll-mt-16">
            {selected && <ScrollToOnChange targetId="month-detail" dep={selected.ym} />}
            {selected && detail(selected)}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          {/* PM: 목록(처리할 달·승인 완료) → 상세: PC는 목록 왼쪽·상세 오른쪽 고정, 모바일은 상세가 위·목록이 아래 — 달을 누르면 상세가 바뀌고 모바일은 상세로 스크롤 */}
          <div className="lg:order-2">
            <div id="month-detail" className="scroll-mt-16 lg:sticky lg:top-20">
              {selected && <ScrollToOnChange targetId="month-detail" dep={selected.ym} />}
              {selected && detail(selected)}
            </div>
          </div>

          <div className="space-y-5 lg:order-1">
            {ongoing && (
              <section aria-labelledby="ongoing-h">
                <h2 id="ongoing-h" className="section-title mb-2">진행 중</h2>
                <ul className="card divide-y divide-line overflow-hidden">{listRow(ongoing)}</ul>
              </section>
            )}
            <section aria-labelledby="todo-h">
              <h2 id="todo-h" className="section-title mb-2">처리할 달 <span className="tabular text-primary">{todo.length}</span></h2>
              {/* 이번 달만 있는 새 프로젝트(승인된 달도 없음)는 "모두 승인"이 아니라 아직 처리할 달이 없는 것 */}
              {todo.length === 0 ? (
                <Empty card icon="inbox">{ongoing && done.length === 0 ? "아직 처리할 달이 없습니다. 이번 달이 지나면 마감할 수 있습니다." : ongoing ? "지난 달은 모두 승인됐습니다." : "모든 달이 승인됐습니다."}</Empty>
              ) : (
                <ul className="card divide-y divide-line overflow-hidden">{todo.map(listRow)}</ul>
              )}
            </section>

            {done.length > 0 && (
              <details className="group/done" open={todo.length === 0 || selected?.status === "APPROVED"}>
                <summary className="mb-2 flex min-h-10 cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
                  <span className="section-title">승인 완료 <span className="tabular text-fg-muted">{done.length}</span></span>
                  <Icon name="down" sw={1.8} className="size-4 text-fg-subtle transition-transform group-open/done:rotate-180" />
                </summary>
                <ul className="card divide-y divide-line overflow-hidden">{done.map(listRow)}</ul>
              </details>
            )}
          </div>
        </div>
      )}
      {trend}
    </div>
  );
}
