import { PageHeading } from "./Nav";
import { Icon } from "./icons";
import { CLOSING_LABEL, type ClosingStatus } from "@/lib/types";
import { MONTH_PHASE_LABEL, type MonthPhase } from "@/lib/month-phase";
import { unlockHint } from "@/lib/closing";

/**
 * 화면 머리글 — 제목(h1)은 모든 화면 크기에서 본문에 한 번만 (PC 상단 바는 프로젝트·날짜만).
 * - meta: 제목 옆 상태 배지 등 (예: 확정 전, 기간)
 * - desc: 한 줄 설명
 * - children: 오른쪽 동작·맥락 (범위 토글, 보조 버튼 — 주요 버튼은 하나)
 * - month: 월 이동 (components/MonthNav) — 월 단위 화면은 모두 여기, 오른쪽 끝 같은 자리 (모바일은 한 줄 전체)
 */
export function PageHeader({ title, desc, meta, month, children }: { title: string; desc?: React.ReactNode; meta?: React.ReactNode; month?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PageHeading title={title} />
          {meta}
        </div>
        {desc && <p className="mt-1 text-sm text-fg-muted">{desc}</p>}
      </div>
      {(children || month) && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {children}
          {month}
        </div>
      )}
    </div>
  );
}

/** 자물쇠 아이콘 경로 (마감 표시) */
const LOCK = "M5.5 9V6.5a4.5 4.5 0 0 1 9 0V9M4.5 9h11v8h-11z";

/**
 * 마감 상태 배지 — 의미 고정: 예정=중립(흐리게) · 작성중=중립 · 마감 대기=경고(앰버) · 마감=중립(진하게)+자물쇠 · 상신=진행(파랑) · 승인=초록 · 반려=빨강.
 * 달 단위로 보이는 곳은 저장 상태 대신 `monthPhase(ym, status, todayString())`를 넘긴다 (기한 지난 작성중 달 = 마감 대기).
 */
const STATUS_STYLE: Record<MonthPhase, string> = {
  FUTURE: "badge-neutral text-fg-muted",
  DRAFT: "badge-neutral",
  PENDING_CLOSE: "badge-warn",
  CLOSED: "badge-neutral text-fg-2",
  SUBMITTED: "badge-info",
  APPROVED: "badge-ok",
  REJECTED: "badge-bad",
};

export function StatusBadge({ status }: { status: ClosingStatus | MonthPhase }) {
  return (
    <span className={`badge px-2 ${STATUS_STYLE[status]}`}>
      {status === "CLOSED" && <Icon d={LOCK} box={20} sw={1.8} className="size-3" />}
      {MONTH_PHASE_LABEL[status]}
    </span>
  );
}

/** 엑셀 검증 결과 (엑셀 양식의 TRUE/FALSE) — 정상은 회색 글자, 불일치만 빨간 배지 (정상을 초록으로 강조하지 않음) */
export function ValidBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="text-xs font-medium text-fg-muted" title="TRUE — 합계가 일치합니다">✓ 일치</span>
  ) : (
    <span className="badge badge-bad px-2" title="FALSE — 합계가 일치하지 않습니다">✕ 검증 불일치</span>
  );
}

export type StatTone = "ok" | "warn" | "danger";
const STAT_TONE: Record<StatTone, string> = {
  ok: "text-status-approved",
  warn: "text-amber-700",
  danger: "text-status-rejected",
};

/** KPI 카드 */
export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: StatTone }) {
  return (
    <div className="card min-w-0 px-4 py-4 sm:px-5">
      <div className="text-label font-medium text-fg-muted">{label}</div>
      <div className={`tabular mt-1.5 truncate text-xl font-bold tracking-tight sm:text-kpi ${tone ? STAT_TONE[tone] : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
    </div>
  );
}

/** 빈 상태 아이콘 (24px 격자 선 아이콘) */
const EMPTY_ICON = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z",
  search: "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM20 20l-3.5-3.5",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  project: "M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z",
  upload: "M12 15V3m0 0-4 4m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
} as const;
export type EmptyIcon = keyof typeof EMPTY_ICON;

/**
 * 빈 상태 안내 — (선택) 아이콘 · 제목 · 한 줄 설명(children) · 해결 버튼 하나(action).
 * card: 카드 모양으로 감싼다 (목록 밖에 단독으로 놓일 때)
 */
export function Empty({ children, action, title, icon, card, className = "" }: {
  children?: React.ReactNode; action?: React.ReactNode; title?: string; icon?: EmptyIcon; card?: boolean; className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 px-5 py-10 text-center text-sm text-fg-muted ${card ? "card" : ""} ${className}`}>
      {icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-fg-subtle">
          <Icon d={EMPTY_ICON[icon]} box={24} sw={1.8} className="size-6" />
        </span>
      )}
      {(title || children) && (
        <div className="max-w-sm">
          {title && <p className="text-base font-bold text-fg">{title}</p>}
          {children && <div className={title ? "mt-1 leading-relaxed" : ""}>{children}</div>}
        </div>
      )}
      {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * 화면 하단 고정 동작 바 — 화면당 주요 동작 하나(예: 월 확정).
 * 모바일은 하단 탭 바로 위, PC는 본문 아래쪽에 떠 있는 카드. 본문 흐름 안에(sticky) 두므로 내용과 겹치지 않는다.
 */
export function StickyAction({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-bottom-bar className={`sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-20 lg:bottom-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur">
        {children}
      </div>
    </div>
  );
}

// ── 불러오는 중 뼈대 ────────────────────────────────────
const bone = "rounded bg-surface-muted";

/** 머리글 뼈대 — title을 알면 실제 제목을 바로 보여 준다 */
export function SkeletonHeader({ title }: { title?: React.ReactNode }) {
  return (
    <div className="mb-5">
      {title ? <p className="text-h1 font-bold tracking-tight">{title}</p> : <div className={`h-7 w-40 ${bone}`} />}
      <div className={`mt-2 h-4 w-64 max-w-full ${bone}`} />
    </div>
  );
}
export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card px-5 py-4">
          <div className={`h-3 w-16 ${bone}`} />
          <div className={`mt-3 h-6 w-28 ${bone}`} />
        </div>
      ))}
    </div>
  );
}
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <div className={`size-9 shrink-0 rounded-full ${bone}`} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className={`h-4 w-1/3 ${bone}`} />
            <div className={`h-3 w-2/3 ${bone}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
/** 트리 + 목록 (조직도·체계도) */
export function SkeletonTree() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="card hidden space-y-2.5 p-4 lg:block">
        <div className={`h-10 ${bone}`} />
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className={`h-4 ${bone}`} style={{ marginLeft: `${(i % 3) * 14}px` }} />)}
      </div>
      <SkeletonList rows={5} />
    </div>
  );
}
/** 화면 전체 뼈대 */
export function SkeletonPage({ title, kind = "dashboard" }: { title?: React.ReactNode; kind?: "dashboard" | "list" | "tree" }) {
  return (
    <div className="animate-pulse" aria-busy="true">
      <SkeletonHeader title={title} />
      {kind === "dashboard" && <><SkeletonCards /><SkeletonList rows={5} /></>}
      {kind === "list" && <SkeletonList />}
      {kind === "tree" && <SkeletonTree />}
      <span className="sr-only">불러오는 중…</span>
    </div>
  );
}

/** hint: 잠금 해제 안내를 바꿀 때 (예: 메인과 함께 상신하는 서브 — 메인 PM이 해제) */
export function LockNotice({ status, hint }: { status: ClosingStatus; hint?: string }) {
  return (
    <div className="alert alert-neutral mb-4">
      <Icon d={LOCK} box={20} sw={1.8} />
      <span>
        이 달은 <b>{CLOSING_LABEL[status]}</b> 상태라 지출을 입력·수정할 수 없습니다. {hint ?? unlockHint(status)}
      </span>
    </div>
  );
}
