import { won } from "@/lib/format";
import { paceStatus, PACE_META } from "@/lib/settlement";
import { meterTone, MeterLegend, PaceTag } from "./Meter";

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const HATCH = "repeating-linear-gradient(135deg, var(--c-primary) 0 2px, transparent 2px 5px)";

/**
 * 프로젝트 전체 집행 — 주인공은 잔액. '배정 X 중 Y 사용 · n%'는 보조.
 * 막대: 마감분(마감 이상인 달, 진하게) · 작성중분(옅게) · 종료 시 예상(빗금) · 기간 경과 눈금(라벨 직접 표기).
 * 상태 판정은 paceStatus 하나. 아래 칸 순서는 엑셀과 같게 배정 → 집행 → 집행률.
 */
export function ProjectProgress({ planned, spent, forecast, elapsed, months, notes, confirmed, title = "프로젝트 전체 집행", className = "mb-5" }: {
  planned: number;
  spent: number;
  /** 종료 시 예상 총액 */
  forecast: number;
  /** 지난 개월수 (이번 달 포함) */
  elapsed: number;
  months: number;
  /** 계획·지출 아래 보조 줄 (예: 당초·변경 금액, 예산 없는 항목) */
  notes?: { planned?: React.ReactNode; spent?: React.ReactNode };
  /** 마감분(마감 이상인 달) 지출 — 주면 막대를 마감분/작성중으로 나눈다 */
  confirmed?: number;
  title?: string;
  className?: string;
}) {
  const rate = planned > 0 ? pct1(spent, planned) : null;
  const timeRate = pct1(elapsed, months);
  const remaining = planned - spent;
  const status = paceStatus({ rate, timeRate, forecast, planned });
  const forecastRate = planned > 0 ? pct1(forecast, planned) : 0;
  const leftover = planned - forecast;
  const fill = clamp(rate ?? 0);
  const fcEnd = clamp(forecastRate);
  const confFill = confirmed === undefined ? null : Math.min(fill, clamp(pct1(confirmed, planned)));
  const tone = meterTone(rate, status);
  // 경과 라벨: 끝에 가까우면 오른쪽 정렬
  const markerAlign = timeRate > 80 ? "-translate-x-full text-right" : timeRate < 20 ? "" : "-translate-x-1/2 text-center";

  return (
    <section className={`card px-4 py-4 sm:px-5 ${className}`} aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        {status === "ok" ? <span className="text-xs text-fg-muted">{PACE_META.ok.label}</span> : <PaceTag status={status} full />}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-fg-muted">잔액</span>
        <span className={`tabular text-amount font-bold tracking-tight ${remaining < 0 ? "text-status-rejected" : ""}`}>
          {won(remaining)}<span className="ml-0.5 text-base font-semibold">원</span>
        </span>
        {remaining < 0 && <span className="badge badge-bad">초과</span>}
      </div>

      {/* 막대 */}
      <div className="relative mt-3 h-3 rounded-full bg-surface-muted" role="img"
        aria-label={`집행률 ${rate ?? "-"}%${confirmed !== undefined ? `, 마감분 ${won(confirmed)}원` : ""}, 기간 경과 ${timeRate}%, 종료 시 예상 ${forecastRate}%`}>
        {fcEnd > fill && (
          <div className="absolute inset-y-0 rounded-r-full opacity-40" style={{ left: `${fill}%`, width: `${fcEnd - fill}%`, backgroundImage: HATCH }} />
        )}
        {confFill === null ? (
          <div className={`relative h-full rounded-full ${tone}`} style={{ width: `${fill}%` }} />
        ) : (
          <>
            <div className={`absolute inset-y-0 left-0 rounded-full opacity-40 ${tone}`} style={{ width: `${fill}%` }} />
            <div className={`relative h-full rounded-full ${tone}`} style={{ width: `${confFill}%` }} />
          </>
        )}
        <div className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-fg" style={{ left: `${clamp(timeRate)}%` }} />
      </div>
      <div className="relative mt-1 h-4 text-xs text-fg-muted">
        <span className={`tabular absolute whitespace-nowrap ${markerAlign}`} style={{ left: `${clamp(timeRate)}%` }}>
          오늘 · 기간 {timeRate}% ({elapsed}/{months}개월)
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {confirmed !== undefined && <MeterLegend confirmed={confirmed} draft={spent - confirmed} />}
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <span aria-hidden className="h-2 w-3 rounded-sm opacity-60" style={{ backgroundImage: HATCH }} />종료 시 예상
        </span>
      </div>

      <dl className="tabular mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
        <div><dt className="text-xs text-fg-muted">배정</dt><dd className="mt-0.5 font-semibold">{won(planned)}원</dd>{notes?.planned && <dd className="text-xs text-fg-muted">{notes.planned}</dd>}</div>
        <div><dt className="text-xs text-fg-muted">집행</dt><dd className="mt-0.5 font-semibold">{won(spent)}원</dd>{notes?.spent && <dd className="text-xs text-fg-muted">{notes.spent}</dd>}</div>
        <div><dt className="text-xs text-fg-muted">집행률</dt><dd className={`mt-0.5 font-semibold ${status === "over" ? "text-status-rejected" : ""}`}>{rate === null ? "-" : `${rate}%`}</dd><dd className="text-xs text-fg-muted">기간 경과 {timeRate}%</dd></div>
        <div title="누적 + 최근 3개월 평균 × 남은 개월">
          <dt className="text-xs text-fg-muted">종료 시 예상</dt>
          <dd className={`mt-0.5 font-semibold ${leftover < 0 && planned > 0 ? "text-amber-800" : ""}`}>{won(forecast)}원</dd>
          {planned > 0 && (
            <dd className="text-xs text-fg-muted">
              {leftover < 0 ? <span className="font-semibold text-amber-800">초과 예상 {won(-leftover)}원</span> : <>남을 예상 {won(leftover)}원</>}
            </dd>
          )}
        </div>
      </dl>
    </section>
  );
}
