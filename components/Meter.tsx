import { paceStatus, PACE_META, type PaceStatus } from "@/lib/settlement";
import { Icon } from "./icons";

/** 상태 아이콘 경로 (20 box) */
export const PACE_ICON = {
  warn: "M10 3.5 17.5 16h-15L10 3.5zM10 8.5v3M10 13.8v.2",
  bad: "M10 16V5m0 0-4.5 4.5M10 5l4.5 4.5",
  info: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9.5v4M10 6.8v.2",
};

const FILL: Record<"neutral" | "warn" | "bad", string> = {
  neutral: "bg-primary",
  warn: "bg-chart-warn",
  bad: "bg-rose-500",
};

/**
 * 집행률 막대 색 — 판정은 lib/settlement의 paceStatus 하나로.
 * status를 안 주면 rate만으로 판정(100% 초과만 빨강). 예산 없음(null)은 회색.
 */
export function meterTone(rate: number | null, status?: PaceStatus) {
  const s = status ?? paceStatus({ rate });
  return s === "none" ? "bg-line-strong" : FILL[PACE_META[s].tone];
}

/**
 * 집행률 막대 (공용). rate는 % 값, 예산 없음 = null.
 * 너비는 className으로 지정 (예: w-full, w-24). size lg = 12px, md = 8px, sm = 6px
 * @param status paceStatus 결과 — 주면 그 색 (기간 대비 판정)
 * @param marker 기간 경과율(%) — 주면 막대 위에 세로 눈금
 */
export function Meter({ rate, className = "", size = "sm", status, marker, label, confirmedRate }: {
  rate: number | null;
  className?: string;
  size?: "sm" | "md" | "lg";
  status?: PaceStatus;
  marker?: number | null;
  /**
   * 마감분 비율(%) — 주면 막대를 마감분(진하게, 마감 이상인 달) / 작성중(옅게)으로 나눈다. 범례는 MeterLegend
   */
  confirmedRate?: number | null;
  /** 스크린리더용 이름 (주면 progressbar로 노출, 없으면 장식 — 옆에 숫자가 있을 때) */
  label?: string;
}) {
  const w = rate === null ? 0 : Math.max(0, Math.min(100, rate));
  const h = size === "lg" ? "h-3" : size === "md" ? "h-2" : "h-1.5";
  const a11y = label
    ? { role: "progressbar", "aria-label": label, "aria-valuenow": rate ?? 0, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuetext": rate === null ? "예산 없음" : `${rate}%` }
    : { "aria-hidden": true };
  return (
    <div className={`relative ${h} rounded-full bg-surface-muted ${className}`} {...a11y}>
      {confirmedRate == null ? (
        <div className={`h-full rounded-full ${meterTone(rate, status)}`} style={{ width: `${w}%` }} />
      ) : (
        <>
          <div className={`absolute inset-y-0 left-0 rounded-full opacity-40 ${meterTone(rate, status)}`} style={{ width: `${w}%` }} />
          <div className={`relative h-full rounded-full ${meterTone(rate, status)}`} style={{ width: `${Math.max(0, Math.min(w, confirmedRate))}%` }} />
        </>
      )}
      {marker != null && (
        <span className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded-full bg-fg/70" style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
          title={`기간 경과 ${marker}%`} />
      )}
    </div>
  );
}

/** 상태 글자 — 정상·예산 없음은 표시하지 않는다 (색만으로 전달하지 않기 위한 짝) */
export function PaceTag({ status, className = "", full = false }: { status: PaceStatus; className?: string; full?: boolean }) {
  if (status === "ok" || status === "none") return null;
  const m = PACE_META[status];
  const cls = m.tone === "bad" ? "text-rose-700" : m.tone === "warn" ? "text-amber-800" : "text-fg-muted";
  const d = m.tone === "bad" ? PACE_ICON.bad : m.tone === "warn" ? PACE_ICON.warn : PACE_ICON.info;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${cls} ${className}`} title={m.label}>
      <Icon d={d} className="size-3.5" sw={1.8} />{full ? m.label : m.short}
    </span>
  );
}

/** 마감분 / 작성중 범례 (confirmedRate 막대와 함께) */
export function MeterLegend({ confirmed, draft, className = "" }: { confirmed?: number; draft?: number; className?: string }) {
  const amt = (v?: number) => (v === undefined ? "" : ` ${v.toLocaleString("ko-KR")}`);
  return (
    <span className={`tabular inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted ${className}`}>
      <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-3 rounded-sm bg-primary" />마감분{amt(confirmed)}</span>
      <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-3 rounded-sm bg-primary opacity-40" />작성중{amt(draft)}</span>
    </span>
  );
}
