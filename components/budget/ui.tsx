"use client";

import { Meter as RateMeter, PaceTag, PACE_ICON } from "../Meter";
import { paceStatus, PACE_META } from "@/lib/settlement";
import { digits, gaugeTone, pct, type CategoryGaugeData } from "./model";
import { Icon } from "../icons";
import { won } from "@/lib/format";

/**
 * 집행률 막대 (공용 Meter) — 판정은 paceStatus 하나.
 * timeRate(기간 경과율)를 주면 경과 눈금 + 속도 판정, 없으면 100% 초과만 빨강.
 * showRate면 막대 오른쪽에 %와 상태 글자.
 */
export function Meter({ spent, planned, className = "", timeRate = null, showRate = false, confirmed }: {
  spent: number; planned: number; className?: string; timeRate?: number | null; showRate?: boolean;
  /** 마감분(마감 이상인 달) 지출 — 주면 마감분(진하게)/작성중(옅게)으로 나눈다 */
  confirmed?: number;
}) {
  const rate = pct(spent, planned);
  const confirmedRate = confirmed === undefined ? undefined : pct(confirmed, planned);
  const status = paceStatus({ rate, timeRate });
  if (!showRate) return <RateMeter rate={rate} status={status} marker={timeRate} confirmedRate={confirmedRate} className={className} />;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <RateMeter rate={rate} status={status} marker={timeRate} confirmedRate={confirmedRate} className="min-w-0 flex-1" />
      <span className={`tabular shrink-0 text-xs ${status === "over" ? "font-bold text-status-rejected" : "text-fg-muted"}`}>{rate === null ? "-" : `${rate}%`}</span>
      <PaceTag status={status} />
    </div>
  );
}

export function MoneyInput({ value, onChange, label, className = "w-32" }: { value: number; onChange: (n: number) => void; label: string; className?: string }) {
  return (
    <input className={`input tabular py-1.5 text-right ${className}`} inputMode="numeric" placeholder="0" aria-label={label}
      value={value ? won(value) : ""} onChange={(e) => onChange(digits(e.target.value))} />
  );
}

/** 기간(회) 입력값 → 0~120 */
export const periodsOf = (s: string) => Math.min(120, digits(s));

export function TrashIcon() {
  return <Icon name="trash" />;
}

/**
 * 분류 머리의 접기/펼치기 — chevron + 분류명이 한 버튼 (터치 44px / PC 32px).
 * 머리 오른쪽의 소계·버튼은 접혀 있어도 그대로 보이고 동작한다.
 */
export function FoldTitle({ name, folded, controls, onToggle }: { name: string; folded: boolean; controls: string; onToggle: () => void }) {
  return (
    <h2>
      <button type="button" onClick={onToggle} aria-expanded={!folded} aria-controls={controls} title={folded ? "펼치기" : "접기"}
        className="-ml-2 flex min-h-11 items-center gap-1 rounded-lg pr-2 pl-1 text-left hover:bg-surface-muted sm:min-h-8">
        <span className="flex size-7 shrink-0 items-center justify-center text-fg-muted" aria-hidden>
          <Icon name="chevron" className={`size-4 transition-transform ${folded ? "" : "rotate-90"}`} />
        </span>
        <span className="section-title">{name}</span>
      </button>
    </h2>
  );
}

// ───────────────────────── 분류 머리줄 게이지 — 일반 분류 카드·분류 전체 한 예산 카드가 같은 부품을 쓴다

const PILL = { neutral: "badge-neutral", info: "badge-info", warn: "badge-warn", bad: "badge-bad" } as const;

/** 집행률 알약 — `45.7%` + 정상이 아니면 상태 아이콘·글자 (색만으로 전하지 않기) */
function RatePill({ g }: { g: CategoryGaugeData }) {
  const tone = gaugeTone(g.status);
  const m = PACE_META[g.status];
  const icon = tone === "bad" ? PACE_ICON.bad : tone === "warn" ? PACE_ICON.warn : tone === "info" ? PACE_ICON.info : null;
  return (
    <span className={`badge ${PILL[tone]} tabular rounded-full px-2`} title={`집행률 ${g.rate}% · ${m.label}`}>
      {g.rate}%
      {icon && <><Icon d={icon} className="size-3.5" sw={1.8} />{m.short}</>}
    </span>
  );
}

/**
 * 집행률 막대 — 6px·모서리 full. 네이비 단색: 마감분(진하게) / 작성중(primary-mid).
 * 기간 경과 눈금은 1px 세로선 (상단 '운영비 전체 집행' 카드와 같은 의미). 상태색은 막대가 아니라 알약이 맡는다.
 */
function GaugeBar({ g, className = "" }: { g: CategoryGaugeData; className?: string }) {
  const w = Math.max(0, Math.min(100, g.rate ?? 0));
  const conf = g.confirmedRate === null ? null : Math.min(w, g.confirmedRate);
  return (
    <span className={`relative block h-1.5 rounded-full bg-line ${className}`} role="img"
      aria-label={`집행률 ${g.rate ?? "-"}%${g.marker !== null ? `, 기간 경과 ${g.marker}%` : ""}`}>
      {conf === null ? (
        <span className="block h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
      ) : (
        <>
          <span className="absolute inset-y-0 left-0 rounded-full bg-brand-300" style={{ width: `${w}%` }} />
          <span className="relative block h-full rounded-full bg-primary" style={{ width: `${conf}%` }} />
        </>
      )}
      {g.marker !== null && (
        <span className="absolute -top-1 -bottom-1 w-px bg-fg/60" style={{ left: `${g.marker}%` }} title={`기간 경과 ${g.marker}%`} />
      )}
    </span>
  );
}

/**
 * 머리줄 오른쪽 묶음: 잔액(주인공 16px) · 아래 '배정 X 중 Y 집행' · 옆에 집행률 알약 + 막대(PC).
 * 좁은 화면의 막대는 CategoryGaugeRow(머리줄 아래 한 줄).
 */
export function CategoryGauge({ g }: { g: CategoryGaugeData }) {
  return (
    <div className="flex items-center gap-3">
      <span className="tabular text-right leading-tight">
        <span className="text-xs text-fg-muted">잔액 </span>
        <b className={`text-base font-semibold ${g.remaining < 0 ? "text-status-rejected" : ""}`}>{won(g.remaining)}</b>
        <span className="mt-0.5 block text-xs text-fg-muted">배정 {won(g.planned)} 중 {won(g.spent)} 집행</span>
      </span>
      {g.rate !== null && (
        <span className="hidden items-center gap-2 sm:flex">
          <RatePill g={g} />
          <GaugeBar g={g} className="w-32" />
        </span>
      )}
    </div>
  );
}

/** 좁은 화면: 머리줄 아래 전체 폭 막대 + 알약 (요약이므로 접혀 있어도 보인다) */
export function CategoryGaugeRow({ g }: { g: CategoryGaugeData }) {
  if (g.rate === null) return null;
  return (
    <div className="flex items-center gap-3 border-t border-line px-5 py-2.5 sm:hidden">
      <GaugeBar g={g} className="min-w-0 flex-1" />
      <RatePill g={g} />
    </div>
  );
}

/**
 * 분류 카드 머리 — 두 카드(일반·분류 전체 한 예산)가 같은 높이·정렬·글자 크기·버튼 자리를 갖도록 한 부품으로.
 * 순서: 접기 토글(분류명) → N개 항목 → [배지] → 게이지 → 버튼. 게이지는 접혀 있어도 보인다.
 */
export function CategoryHead({ name, folded, controls, onToggle, count, badge, gauge, action }: {
  name: string; folded: boolean; controls: string; onToggle: () => void; count: number;
  badge?: React.ReactNode; gauge: CategoryGaugeData; action?: React.ReactNode;
}) {
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2 sm:py-1.5">
        <FoldTitle name={name} folded={folded} controls={controls} onToggle={onToggle} />
        <span className="text-xs text-fg-muted">{count}개 항목</span>
        {badge && <span className="badge badge-primary rounded-full px-2">{badge}</span>}
        <div className="ml-auto flex items-center gap-3">
          <CategoryGauge g={gauge} />
          {action}
        </div>
      </header>
      <CategoryGaugeRow g={gauge} />
    </>
  );
}
