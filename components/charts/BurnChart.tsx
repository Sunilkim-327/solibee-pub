"use client";

import { useState } from "react";
import { dash0, won, ymKo } from "@/lib/format";
import type { BurnPoint } from "@/lib/settlement";
import { CLOSING_LABEL, type ClosingStatus } from "@/lib/types";
import { Icon } from "../icons";
import { compactWon, niceMax } from "./scale";

const STATUS_MARK: Record<ClosingStatus, { d: string; cls: string }> = {
  APPROVED: { d: "m5 10 3.5 3.5L15 7", cls: "text-status-approved" },
  SUBMITTED: { d: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.5V10l2.5 1.5", cls: "text-sky-700" },
  REJECTED: { d: "M5.5 5.5l9 9M14.5 5.5l-9 9", cls: "text-status-rejected" },
  CLOSED: { d: "M6 9V7a4 4 0 1 1 8 0v2M5 9h10v7H5z", cls: "text-fg-muted" },
  DRAFT: { d: "M9.2 10h1.6", cls: "text-fg-subtle" },
};

const HATCH = "repeating-linear-gradient(135deg, var(--c-primary) 0 2px, transparent 2px 4px)";

/**
 * 누적 집행 추이 (번업) / 월별 지출 — SVG·CSS만으로 그린다 (차트 라이브러리 없음).
 * 누적: 실적(실선) · 계획 누적(점선, 회색) · 종료 시 예상(점선, 브랜드색). 월별: 막대 + 월 평균 예산 기준선.
 * 아래 줄은 월별 마감 상태(아이콘+글자 툴팁). 막대·점을 누르거나 올리면 그 달 상세.
 */
export function BurnChart({ points, statuses, now, footer, className = "mb-5", defaultMode = "cum", table = true }: {
  points: BurnPoint[];
  statuses: ClosingStatus[];
  /** 이번 달 "YYYY-MM" */
  now: string;
  footer?: React.ReactNode;
  className?: string;
  /** 처음 보이는 보기 — "month": 월 막대 + 월 배정 기준선, "cum": 누적 번업 */
  defaultMode?: "cum" | "month";
  /** 아래 '표로 보기' (월별 합계 표) — 바깥에 같은 표가 있으면 끈다 */
  table?: boolean;
}) {
  const [mode, setMode] = useState<"cum" | "month">(defaultMode);
  const n = points.length;
  const nowIdx = points.findIndex((p) => p.yearMonth === now);
  const lastActual = points.reduce((a, p, i) => (p.actual !== null ? i : a), -1);
  const [sel, setSel] = useState<number | null>(null);
  if (n === 0) return null;

  const planned = points[n - 1].plan;
  const monthPlan = Math.round(planned / n);
  const max = mode === "cum"
    ? niceMax(Math.max(planned, ...points.map((p) => Math.max(p.actual ?? 0, p.forecast ?? 0))))
    : niceMax(Math.max(monthPlan, ...points.map((p) => p.amount)));
  const y = (v: number) => 100 - (v / max) * 100;
  const x = (i: number) => i + 0.5;
  const line = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
  const ticks = [0, max / 2, max];
  const active = sel ?? (nowIdx >= 0 ? nowIdx : lastActual);
  const p = active >= 0 ? points[active] : null;
  const future = (i: number) => i > lastActual;

  return (
    <section className={`card overflow-hidden ${className}`} aria-label="집행 추이">
      <div className="card-head flex-wrap gap-3">
        <h2 className="section-title">집행 추이</h2>
        <div className="seg ml-auto" role="tablist" aria-label="보기">
          <button type="button" role="tab" aria-selected={mode === "cum"} onClick={() => setMode("cum")}>누적</button>
          <button type="button" role="tab" aria-selected={mode === "month"} onClick={() => setMode("month")}>월별</button>
        </div>
      </div>

      <div className="px-4 pt-3 pb-4 sm:px-5">
        {/* 범례 (색만으로 구분하지 않게 선 모양도 함께) */}
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          {mode === "cum" ? (
            <>
              <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" aria-hidden />집행 누적</li>
              <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-fg-subtle" aria-hidden />배정 누적</li>
              <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-primary" aria-hidden />종료 시 예상</li>
            </>
          ) : (
            <>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" aria-hidden />월 집행</li>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm opacity-60" style={{ backgroundImage: HATCH }} aria-hidden />미리 입력</li>
              <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-fg-subtle" aria-hidden />월 평균 배정 {compactWon(monthPlan)}</li>
            </>
          )}
        </ul>

        {/* 선택한 달 요약 (툴팁 대신 고정 위치 — 모바일에서 손가락에 가리지 않게) */}
        {p && (
          <div className="tabular mb-2 flex min-h-10 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm" aria-live="polite">
            <b>{ymKo(p.yearMonth)}</b>
            <span className="text-fg-muted">집행 <b className="text-fg">{won(p.amount)}</b></span>
            {mode === "cum" && (
              p.actual !== null
                ? <span className="text-fg-muted">누적 <b className="text-fg">{won(p.actual)}</b> / 배정 {won(p.plan)}</span>
                : <span className="text-fg-muted">예상 누적 <b className="text-fg">{won(p.forecast ?? 0)}</b> / 배정 {won(p.plan)}</span>
            )}
            {mode === "month" && <span className="text-fg-muted">월 평균 배정 {won(monthPlan)}</span>}
            {!future(active) && <span className="text-xs text-fg-muted">· {CLOSING_LABEL[statuses[active] ?? "DRAFT"]}</span>}
          </div>
        )}

        <div className="relative h-40 pl-12 sm:h-52">
          {/* 눈금선 */}
          {ticks.map((t) => (
            <div key={t} className="absolute right-0 left-12 border-t border-line" style={{ top: `${y(t)}%` }}>
              <span className="tabular absolute -left-12 w-11 -translate-y-1/2 whitespace-nowrap pr-1.5 text-right text-xs text-fg-subtle">{compactWon(t)}</span>
            </div>
          ))}
          <div className="absolute inset-y-0 right-0 left-12">
            {mode === "cum" ? (
              <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden>
                <polyline points={line(points.map((q) => q.plan))} fill="none" stroke="var(--c-fg-subtle)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                <polyline points={line(points.map((q) => q.forecast))} fill="none" stroke="var(--c-primary)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <polyline points={line(points.map((q) => q.actual))} fill="none" stroke="var(--c-primary)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
            ) : (
              <>
                <div className="absolute inset-0 flex items-end">
                  {points.map((q, i) => (
                    <div key={q.yearMonth} className="flex h-full flex-1 items-end justify-center">
                      <div className={`w-3/5 max-w-6 rounded-t ${future(i) ? "opacity-60" : "bg-primary"} ${i === active ? "ring-2 ring-fg/40 ring-offset-1 ring-offset-surface" : ""}`}
                        style={{ height: `${(q.amount / max) * 100}%`, backgroundImage: future(i) ? HATCH : undefined }} />
                    </div>
                  ))}
                </div>
                <div className="absolute right-0 left-0 border-t-2 border-dashed border-fg-subtle" style={{ top: `${y(monthPlan)}%` }} aria-hidden />
              </>
            )}
            {/* 선택 세로선·점 */}
            {active >= 0 && (
              <div className="pointer-events-none absolute inset-y-0 w-px bg-fg/25" style={{ left: `${(x(active) / n) * 100}%` }} />
            )}
            {mode === "cum" && p && (p.actual ?? p.forecast) !== null && (
              <span className={`pointer-events-none absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-surface ${p.actual !== null ? "bg-primary" : "bg-brand-300"}`}
                style={{ left: `${(x(active) / n) * 100}%`, bottom: `${100 - y((p.actual ?? p.forecast)!)}%` }} />
            )}
            {/* 누르는 영역: 달마다 세로 띠 전체 */}
            <div className="absolute inset-0 flex">
              {points.map((q, i) => (
                <button key={q.yearMonth} type="button" className="h-full flex-1 focus-visible:bg-primary/5 focus-visible:outline-none"
                  aria-label={`${ymKo(q.yearMonth)} 집행 ${won(q.amount)}원`} aria-pressed={i === active}
                  onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)} />
              ))}
            </div>
          </div>
        </div>

        {/* x축: 월 */}
        <div className="mt-1.5 flex pl-12 text-xs text-fg-muted">
          {points.map((q, i) => (
            <span key={q.yearMonth} className={`tabular flex-1 whitespace-nowrap text-center ${i === nowIdx ? "font-semibold text-fg" : ""} ${n > 8 && i % 2 === 1 && i !== nowIdx ? "max-sm:invisible" : ""}`}>
              {Number(q.yearMonth.slice(5))}
            </span>
          ))}
        </div>
        {/* 마감 상태 */}
        <div className="mt-1 flex pl-12" aria-label="월별 마감 상태">
          {points.map((q, i) => {
            if (future(i)) return <span key={q.yearMonth} className="flex-1" />;
            const s = statuses[i] ?? "DRAFT";
            const m = STATUS_MARK[s];
            return (
              <span key={q.yearMonth} className={`flex flex-1 justify-center ${m.cls}`} title={`${ymKo(q.yearMonth)} ${CLOSING_LABEL[s]}`}>
                <Icon d={m.d} className="size-3.5" sw={2} />
                <span className="sr-only">{ymKo(q.yearMonth)} {CLOSING_LABEL[s]}</span>
              </span>
            );
          })}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-12 text-xs text-fg-muted" aria-hidden>
          {(["APPROVED", "SUBMITTED", "REJECTED", "CLOSED"] as const).map((s) => (
            <li key={s} className="flex items-center gap-1"><span className={STATUS_MARK[s].cls}><Icon d={STATUS_MARK[s].d} className="size-3" sw={2} /></span>{CLOSING_LABEL[s]}</li>
          ))}
        </ul>

        {footer}

        {table && <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg">표로 보기</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="table">
              <thead><tr><th>월</th><th className="text-right">집행</th><th className="text-right">누적</th><th className="text-right">배정 누적</th><th>마감</th></tr></thead>
              <tbody>
                {points.map((q, i) => (
                  <tr key={q.yearMonth}>
                    <td className="tabular whitespace-nowrap">{ymKo(q.yearMonth)}</td>
                    <td className={`tabular text-right ${q.amount ? "" : "text-fg-subtle"}`}>{dash0(q.amount)}</td>
                    <td className="tabular text-right">{q.actual !== null ? won(q.actual) : <span className="text-fg-subtle">예상 {won(q.forecast ?? 0)}</span>}</td>
                    <td className="tabular text-right">{won(q.plan)}</td>
                    <td className="whitespace-nowrap text-xs text-fg-muted">{future(i) ? "-" : CLOSING_LABEL[statuses[i] ?? "DRAFT"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>}
      </div>
    </section>
  );
}
