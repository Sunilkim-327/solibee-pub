// 재무 승인 판단 요약 (설계 검토(2026-10-14) P0-3) — HqReview 맨 위 카드. 서버 컴포넌트 (가로 스크롤 위치만 클라이언트 AutoScrollX)
// 위→아래: 한 줄 KPI → 예산 대비 집행 표(상신 엑셀 '프로젝트 운영비(작성금지)' 시트와 같은 행·열, 이 달 열 강조) → 결제자별 전월 비교 → 검토 이력(접힘)
// 표 밀도는 DESIGN §0 (머리 36·행 40·tabular). 잔액 음수·이 달 월 배정 초과 행은 왼쪽 warn 띠 + 금액 붉게. 모바일은 항목별 카드.
import Link from "next/link";
import { AutoScrollX } from "@/components/list/AutoScrollX";
import { Icon } from "@/components/icons";
import { BLOCKER_LABEL, overrideLabels, type SubmitOverride } from "@/lib/closing";
import { dash0, shortDateTime, won, ymKo } from "@/lib/format";
import { SELF_APPROVAL_HINT, deltaText, monthDelta, selfApprovalText, type ExpenseChange, type HqBudgetRow, type HqBudgetTable, type PayerCompareRow, type ReviewEvent, type SelfApproval } from "@/lib/hq-summary";
import { ledgerHref } from "@/lib/page-access";
import type { ClosingStatus } from "@/lib/types";

/** "10.03 18:00" (한국 시간, 없으면 빈 문자열) */
const at = (d: Date | null) => (d ? shortDateTime(d) : "");
const pct = (spent: number, planned: number) => (planned > 0 ? Math.round((spent / planned) * 100) : null);

export type HqSummaryProps = {
  ym: string;
  status: ClosingStatus;
  kpi: {
    total: number;
    count: number;
    /** 전월 (보여 줄 달에 없으면 null) */
    prev: { ym: string; total: number } | null;
    cumulative: { planned: number; spent: number; remaining: number };
    missing: number;
    flagged: number;
    unexplained: number;
    /** 출입증 상태 한 줄 — 쓰지 않으면 null */
    passText: string | null;
    passOk: boolean | null;
    submitNote: string | null;
    override: SubmitOverride | null;
  };
  table: HqBudgetTable;
  /** 자기 승인 경고 — 보는 사람(승인자) 본인이 입력한 이 달 본사 지출 (없으면 null). otherHq: 다른 재무 승인 담당이 있음 */
  selfApproval?: (SelfApproval & { otherHq: boolean }) | null;
  /** 결제자별 전월 비교 — 전월이 없으면 null */
  payers: PayerCompareRow[] | null;
  history: {
    /** 지금 반려 상태의 사유 또는 재마감 때 옮겨 둔 직전 사유 */
    rejectNote: { current: boolean; revoked: boolean; note: string; at: Date | null; by: string | null } | null;
    timeline: (ReviewEvent & { by: string })[];
    sinceAt: Date | null;
    changes: (ExpenseChange & { by: string; payer: string; item: string; itemAfter: string | null })[];
    truncated: boolean;
  };
};

const ACTION_KO: Record<ReviewEvent["action"], string> = { submit: "상신", reject: "반려", revoke: "승인 취소", approve: "승인" };
const CHANGE_KO: Record<ExpenseChange["action"], string> = { create: "등록", update: "수정", delete: "삭제" };

/** 월 머리글: "10월", 첫 열·1월에는 연도 */
function MonthHead({ ym, first }: { ym: string; first: boolean }) {
  const [y, m] = ym.split("-");
  return (
    <>
      {(first || m === "01") && <span className="block text-xs leading-3 font-medium text-fg-subtle">{y}</span>}
      {Number(m)}월
    </>
  );
}

/** 금액 칸: 0은 "-", 붉게 표시할 수 있음 */
const Amt = ({ v, bad, bold, className = "" }: { v: number; bad?: boolean; bold?: boolean; className?: string }) => (
  <span className={`tabular ${v === 0 && !bad ? "text-fg-subtle" : ""} ${bad ? "font-semibold text-status-rejected" : ""} ${bold ? "font-semibold" : ""} ${className}`}>{bad && v < 0 ? `-${won(-v)}` : v < 0 ? `-${won(-v)}` : dash0(v)}</span>
);

/**
 * 예산 대비 집행 표 (PC) — 엑셀 예산 시트와 같은 행. 열은 화면용으로 재배치:
 * 왼쪽 고정 3열(회계계정 80 · 분류 96 · 항목 176 = 352px) | 월별 열(가로 스크롤, 이 달 강조) | 오른쪽 고정 3열(계획·지출·잔액 각 120 = 360px).
 * 상세내역은 항목 셀 아래 작은 글자, 단가 × 기간은 항목 셀 툴팁. 고정 열 안쪽 가장자리에 페이드 그림자 — 스크롤에 반쯤 가린 숫자가 다른 수로 읽히지 않게.
 * scroll-pl/pr은 고정 열 폭만큼 — 키보드·scrollIntoView로 옮길 때 열이 고정 열 아래로 들어가지 않게.
 */
const EDGE_L = "shadow-[1px_0_0_var(--c-line),8px_0_8px_-8px_rgba(0,0,0,.18)]";
const EDGE_R = "shadow-[-1px_0_0_var(--c-line),-8px_0_8px_-8px_rgba(0,0,0,.18)]";
function BudgetTable({ t }: { t: HqBudgetTable }) {
  const cur = (i: number) => i === t.idx;
  const stickyBase = "sticky z-10 bg-surface";
  const rowBg = (r: HqBudgetRow) => (r.over || r.overMonth ? "bg-amber-50/40" : "");
  const right = "w-30 min-w-30 text-right";
  const itemTitle = (r: HqBudgetRow) => [r.itemName, r.detail, r.unitPrice !== null && r.periods !== null ? `단가 ${won(r.unitPrice)}원 × ${r.periods}` : null].filter(Boolean).join("\n");
  return (
    <AutoScrollX watch={t.ym} className="rounded-lg border border-line scroll-pl-[352px] scroll-pr-[360px]">
      <table className="table [&_tbody_td]:py-2 [&_tbody_tr]:h-10 [&_th]:h-9">
        <thead>
          <tr>
            <th className={`${stickyBase} left-0 w-20 min-w-20 !bg-surface-muted`}>분류<span className="block text-[11px] font-normal leading-3">회계계정</span></th>
            <th className={`${stickyBase} left-20 w-24 min-w-24 !bg-surface-muted`}>분류</th>
            <th className={`${stickyBase} left-44 w-44 min-w-44 !bg-surface-muted ${EDGE_L}`}>항목<span className="block text-[11px] font-normal leading-3">상세내역</span></th>
            {t.months.map((m, i) => (
              <th key={m} data-current={cur(i) ? "" : undefined} className={`min-w-24 text-right align-bottom whitespace-nowrap ${cur(i) ? "!bg-brand-100 !text-fg" : ""}`}>
                <MonthHead ym={m} first={i === 0} />
              </th>
            ))}
            <th className={`${stickyBase} right-60 ${right} !bg-surface-muted ${EDGE_R}`}>계획</th>
            <th className={`${stickyBase} right-30 ${right} !bg-surface-muted`}>지출</th>
            <th className={`${stickyBase} right-0 ${right} !bg-surface-muted`}>잔액</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => {
            const warn = r.over || r.overMonth;
            return (
              <tr key={r.key} className={rowBg(r)} title={warn ? `${r.over ? "잔액 음수" : ""}${r.over && r.overMonth ? " · " : ""}${r.overMonth ? `이 달 월 배정(${won(r.monthBudget ?? 0)}원) 초과` : ""}` : undefined}>
                <td className={`${stickyBase} left-0 whitespace-nowrap text-xs text-fg-muted ${rowBg(r)} ${warn ? "shadow-[inset_3px_0_0_var(--c-warn-500,#f59e0b)]" : ""}`}>{r.accountCode || "-"}</td>
                <td className={`${stickyBase} left-20 whitespace-nowrap text-xs ${rowBg(r)}`}>{r.categoryName}</td>
                <td className={`${stickyBase} left-44 max-w-44 ${EDGE_L} ${rowBg(r)}`} title={itemTitle(r)}>
                  <div className="truncate font-medium">
                    {r.itemName}
                    {warn && <span className="sr-only"> (예산 주의)</span>}
                  </div>
                  {r.detail && <div className="truncate text-[11px] leading-4 text-fg-2">{r.detail}</div>}
                </td>
                {r.months.map((v, i) => (
                  <td key={i} className={`text-right whitespace-nowrap ${cur(i) ? "bg-brand-50/60" : ""}`}>
                    <Amt v={v} bad={cur(i) && r.overMonth} bold={cur(i)} />
                  </td>
                ))}
                <td className={`${stickyBase} right-60 ${right} ${EDGE_R} ${rowBg(r)}`}><Amt v={r.planned} /></td>
                <td className={`${stickyBase} right-30 ${right} ${rowBg(r)}`}><Amt v={r.spent} /></td>
                <td className={`${stickyBase} right-0 ${right} ${rowBg(r)}`}><Amt v={r.remaining} bad={r.over} /></td>
              </tr>
            );
          })}
          <tr className="bg-surface-muted font-bold">
            <td className={`${stickyBase} left-0 !bg-surface-muted`} />
            <td className={`${stickyBase} left-20 !bg-surface-muted`}>총합계</td>
            <td className={`${stickyBase} left-44 !bg-surface-muted ${EDGE_L}`} />
            {t.totals.months.map((v, i) => (
              <td key={i} className={`text-right whitespace-nowrap ${cur(i) ? "bg-brand-50/60" : ""}`}><Amt v={v} bold /></td>
            ))}
            <td className={`${stickyBase} right-60 ${right} !bg-surface-muted ${EDGE_R}`}><Amt v={t.totals.planned} bold /></td>
            <td className={`${stickyBase} right-30 ${right} !bg-surface-muted`}><Amt v={t.totals.spent} bold /></td>
            <td className={`${stickyBase} right-0 ${right} !bg-surface-muted`}><Amt v={t.totals.remaining} bad={t.totals.remaining < 0} bold /></td>
          </tr>
        </tbody>
      </table>
    </AutoScrollX>
  );
}

/** 예산 대비 집행 (모바일) — 항목별 카드: 계획·지출 / 잔액·이 달 2열×2행 (390px에서 8자리 금액이 잘리지 않게 — 한 칸 약 147px, 10,000,000이 약 80px) */
function BudgetCards({ t }: { t: HqBudgetTable }) {
  const cell = (label: string, v: number, bad = false) => (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className="tabular text-sm whitespace-nowrap"><Amt v={v} bad={bad} /></div>
    </div>
  );
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {t.rows.map((r) => {
        const warn = r.over || r.overMonth;
        return (
          <li key={r.key} className={`px-3 py-2.5 ${warn ? "border-l-[3px] border-l-amber-500 bg-amber-50/40" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold">{r.itemName}</span>
              <span className="shrink-0 text-xs text-fg-muted">{r.categoryName}{r.accountCode ? ` · ${r.accountCode}` : ""}</span>
            </div>
            {r.detail && <div className="mt-0.5 truncate text-xs text-fg-2">{r.detail}</div>}
            <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1.5">
              {cell("계획", r.planned)}
              {cell("지출", r.spent)}
              {cell("잔액", r.remaining, r.over)}
              {cell("이 달", r.thisMonth, r.overMonth)}
            </div>
          </li>
        );
      })}
      <li className="grid grid-cols-2 gap-x-2 gap-y-1.5 bg-surface-muted px-3 py-2.5 font-bold">
        {cell("계획", t.totals.planned)}
        {cell("지출", t.totals.spent)}
        {cell("잔액", t.totals.remaining, t.totals.remaining < 0)}
        {cell("이 달", t.totals.thisMonth)}
      </li>
    </ul>
  );
}

export function HqSummary({ ym, status, kpi, table, selfApproval = null, payers, history }: HqSummaryProps) {
  const delta = monthDelta(kpi.total, kpi.prev?.total ?? null);
  const rate = pct(kpi.cumulative.spent, kpi.cumulative.planned);
  const hasReject = !!history.rejectNote || history.timeline.some((e) => e.action === "reject" || e.action === "revoke");
  const Kpi = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
  return (
    <section className="rounded-xl border border-line" aria-labelledby="hq-summary-h">
      <div className="card-head">
        <h3 id="hq-summary-h" className="section-title break-keep">승인 판단 요약 <span className="text-xs font-normal text-fg-muted">{ymKo(ym)}</span></h3>
        {table.warnCount > 0 && <span className="badge badge-warn">예산 주의 {table.warnCount}개</span>}
      </div>
      <div className="space-y-4 p-4">
        {/* 한 줄 KPI */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-7">
          <Kpi label="이 달 총합계"><span className="tabular text-base font-bold">{won(kpi.total)}</span><span className="text-xs font-normal text-fg-muted">원 · {kpi.count}건</span></Kpi>
          <Kpi label={kpi.prev ? `전월 (${ymKo(kpi.prev.ym)})` : "전월"}>
            {kpi.prev ? (
              <span className="flex flex-wrap items-baseline gap-1.5">
                <span className="tabular">{won(kpi.prev.total)}<span className="text-xs font-normal text-fg-muted">원</span></span>
                {delta.diff !== null && (delta.warn
                  ? <span className="badge badge-warn">{deltaText(delta)}</span>
                  : <span className="tabular text-xs text-fg-muted">{deltaText(delta)}</span>)}
              </span>
            ) : <span className="text-fg-muted">없음</span>}
          </Kpi>
          <Kpi label="누적 집행률 · 잔액">
            <span className="tabular">{rate === null ? "-" : `${rate}%`}</span>
            <span className="text-xs text-fg-muted"> · 잔액 </span>
            <Amt v={kpi.cumulative.remaining} bad={kpi.cumulative.remaining < 0} />
            <span className="text-xs text-fg-muted">원</span>
          </Kpi>
          <Kpi label="미입력 팀원">{kpi.missing ? <span className="badge badge-warn">{kpi.missing}명</span> : <span className="text-fg-muted">없음</span>}</Kpi>
          <Kpi label="규정 점검">
            {kpi.flagged === 0 ? <span className="text-fg-muted">없음</span> : (
              <Link href={ledgerHref(ym, { check: kpi.unexplained ? "unexplained" : "flag", from: "closing" })} className="underline-offset-2 hover:underline">
                {kpi.flagged}건{kpi.unexplained ? <span className="ml-1 badge badge-bad">소명 필요 {kpi.unexplained}건</span> : <span className="text-xs text-fg-muted"> · 모두 소명</span>}
              </Link>
            )}
          </Kpi>
          <Kpi label="출입증">
            {kpi.passText === null ? <span className="text-fg-muted">쓰지 않음</span> : kpi.passOk ? <span>{kpi.passText}</span> : <span className="badge badge-warn">{kpi.passText}</span>}
          </Kpi>
          <Kpi label="상신 메모 · 사유">
            {kpi.override ? <span className="badge badge-warn">확인 항목 넘김</span> : kpi.submitNote ? <span>메모 있음</span> : <span className="text-fg-muted">없음</span>}
          </Kpi>
        </dl>
        {(kpi.submitNote || kpi.override || selfApproval) && (
          <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
            {kpi.override && (
              <div>
                <span className="badge badge-warn mr-1.5 align-middle">확인 항목 넘김</span>
                <b>{overrideLabels(kpi.override)}</b><span className="text-fg-muted"> · 사유:</span> {kpi.override.reason}
              </div>
            )}
            {kpi.submitNote && <div className={kpi.override ? "mt-1" : ""}><span className="text-fg-muted">PM 상신 메모 · </span>{kpi.submitNote}</div>}
            {/* 자기 승인 (P0-3 ④) — 경고만, 승인은 막지 않는다. 승인 기록에 남는다 */}
            {selfApproval && (
              <div className={kpi.override || kpi.submitNote ? "mt-1" : ""}>
                <span className="badge badge-warn mr-1.5 align-middle">자기 승인</span>
                <span className="tabular">{selfApprovalText(selfApproval)}</span>
                {selfApproval.otherHq && <span className="text-fg-muted"> · {SELF_APPROVAL_HINT}</span>}
              </div>
            )}
          </div>
        )}

        {/* 예산 대비 집행 */}
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold break-keep">예산 대비 집행 <span className="text-xs font-normal text-fg-muted">{ymKo(ym)}까지 · 함께 상신하는 서브 포함 · 상신 엑셀 ‘프로젝트 운영비’ 시트와 같은 행</span></h4>
            {table.warnCount > 0 && <span className="text-xs font-medium text-amber-800">잔액 음수 또는 이 달 월 배정 초과 {table.warnCount}개 — 왼쪽 띠·붉은 금액</span>}
          </div>
          {table.rows.length === 0 ? <p className="text-sm text-fg-muted">예산 행이 없습니다.</p> : (
            <>
              <div className="hidden sm:block"><BudgetTable t={table} /></div>
              <div className="sm:hidden"><BudgetCards t={table} /></div>
            </>
          )}
        </div>

        {/* 결제자별 전월 비교 */}
        {payers && kpi.prev && payers.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-sm font-semibold">결제자별 전월 대비 <span className="text-xs font-normal text-fg-muted">팀원별 정산금액 · ±30% 이상 강조</span></h4>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="table">
                <thead><tr><th>결제자</th><th className="text-right">{ymKo(ym)}</th><th className="text-right">{ymKo(kpi.prev.ym)}</th><th className="text-right">증감</th></tr></thead>
                <tbody>
                  {payers.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td className="text-right"><Amt v={p.current} /></td>
                      <td className="text-right"><Amt v={p.prev} /></td>
                      <td className="text-right">
                        {p.warn ? <span className="badge badge-warn">{deltaText(p)}</span> : <span className="tabular text-xs text-fg-muted">{deltaText(p)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 검토 이력 — 반려 이력이 있으면 펼침 */}
        <details className="group/hist rounded-lg border border-line" open={hasReject || undefined}>
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-semibold">
              검토 이력
              {history.rejectNote && <span className={`ml-2 badge ${status === "APPROVED" ? "badge-neutral" : "badge-bad"}`}>{history.rejectNote.current ? (history.rejectNote.revoked ? "승인 취소됨" : "반려됨") : "이전 반려"}</span>}
              {history.sinceAt && <span className="ml-2 text-xs font-normal text-fg-muted">반려 이후 바뀐 지출 {history.changes.length}{history.truncated ? "+" : ""}건</span>}
            </span>
            <Icon name="down" sw={1.8} className="size-4 shrink-0 text-fg-subtle transition-transform group-open/hist:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-line px-3 py-3 text-sm">
            {/* 승인된 달의 지난 반려 사유는 이미 해소된 것 — 붉은 알림 대신 중립 줄. 반려·재상신 중에는 알림 */}
            {history.rejectNote && (status === "APPROVED" ? (
              <p className="text-fg-2">
                <span className="text-fg-muted">이전 반려·승인 취소 사유{history.rejectNote.at ? ` (${at(history.rejectNote.at)}${history.rejectNote.by ? ` · ${history.rejectNote.by}` : ""})` : ""} · </span>
                {history.rejectNote.note}
              </p>
            ) : (
              <div className="alert alert-danger block">
                <b>{history.rejectNote.current ? (history.rejectNote.revoked ? "승인 취소 사유" : "반려 사유") : "이전 반려·승인 취소 사유"}</b>
                {history.rejectNote.at && <span className="text-xs"> · {at(history.rejectNote.at)}{history.rejectNote.by ? ` · ${history.rejectNote.by}` : ""}</span>}
                <div className="mt-0.5">{history.rejectNote.note}</div>
              </div>
            ))}
            {history.timeline.length > 0 && (
              <ol className="divide-y divide-line rounded-lg border border-line">
                {history.timeline.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                    <span className="tabular w-24 shrink-0 text-xs text-fg-muted">{at(e.at)}</span>
                    <span className={`font-medium ${e.action === "reject" || e.action === "revoke" ? "text-status-rejected" : ""}`}>{ACTION_KO[e.action]}</span>
                    <span className="text-xs text-fg-muted">{e.by}</span>
                    {e.blockers.length > 0 && <span className="badge badge-warn">{[...new Set(e.blockers.map((c) => BLOCKER_LABEL[c]))].join(" · ")}</span>}
                    {e.approvalRef && <span className="tabular text-xs text-fg-muted">결재 {e.approvalRef}</span>}
                    {e.unexplainedOverride !== null && <span className="badge badge-warn" title="소명 없는 규정 점검이 있는데 사유를 적고 승인함">소명 없음 {e.unexplainedOverride}건 승인</span>}
                    {e.selfApproval && <span className="badge badge-warn" title={`${selfApprovalText(e.selfApproval)} — 자기 승인`}>자기 승인 {e.selfApproval.count}건</span>}
                    {(e.note || e.overrideReason) && <span className="min-w-0 basis-full text-fg-2">{e.overrideReason ? `사유: ${e.overrideReason}` : ""}{e.overrideReason && e.note ? " · " : ""}{e.note ? `${e.action === "submit" ? "메모" : "사유"}: ${e.note}` : ""}</span>}
                  </li>
                ))}
              </ol>
            )}
            {history.sinceAt && (
              <div>
                <div className="mb-1 text-xs text-fg-muted">반려 이후({at(history.sinceAt)}) 바뀐 지출 {history.changes.length}건{history.truncated ? " (최근 50건의 기록만)" : ""}</div>
                {history.changes.length === 0 ? <p className="text-xs text-fg-muted">바뀐 지출이 없습니다.</p> : (
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="table">
                      <thead><tr><th>시각</th><th>구분</th><th>결제자</th><th>항목</th><th className="text-right">금액 (전 → 후)</th><th>세부내역</th><th>처리</th></tr></thead>
                      <tbody>
                        {history.changes.map((c) => (
                          <tr key={c.id}>
                            <td className="tabular whitespace-nowrap text-xs text-fg-muted">{at(c.at)}</td>
                            <td><span className={`badge ${c.action === "delete" ? "badge-bad" : c.action === "create" ? "badge-info" : "badge-neutral"}`}>{CHANGE_KO[c.action]}{c.movedOut ? " (다른 달로)" : ""}</span></td>
                            <td className="whitespace-nowrap">{c.payer}</td>
                            <td className="whitespace-nowrap">{c.item}{c.itemAfter ? <span className="text-fg-muted"> → {c.itemAfter}</span> : null}</td>
                            <td className="tabular whitespace-nowrap text-right">
                              {c.action === "update" && c.amountBefore !== c.amountAfter
                                ? <><span className="text-fg-muted line-through">{won(c.amountBefore ?? 0)}</span> → <b>{won(c.amountAfter ?? 0)}</b></>
                                : won((c.action === "delete" ? c.amountBefore : c.amountAfter) ?? 0)}
                            </td>
                            <td className="max-w-64 truncate text-xs text-fg-2" title={c.detail ?? undefined}>{c.detail}</td>
                            <td className="whitespace-nowrap text-xs text-fg-muted">{c.by}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {!history.rejectNote && history.timeline.length === 0 && <p className="text-xs text-fg-muted">{status === "DRAFT" || status === "CLOSED" ? "아직 상신 전입니다." : "검토 기록이 없습니다."}</p>}
          </div>
        </details>
      </div>
    </section>
  );
}
