"use client";

import { useMemo, useState } from "react";
import { won, ymKo } from "@/lib/format";
import { compactWon, niceMax } from "../charts/scale";
import { itemBurn, itemFacts, type ItemBurnPoint } from "./model";

export type ItemTrendInput = {
  months: string[];
  /** 달 → 이 항목(묶음 포함)의 집행 */
  monthOf: (ym: string) => number;
  /** 월 → 마감 상태 (마감분 진하게) */
  closings: Record<string, string | undefined>;
  /** 경과 개월 수 (이번 달 포함) */
  elapsed: number;
  now: string | null;
};

/**
 * 항목 펼침 패널 — 입력값 반복이 아니라 그 항목의 인사이트.
 * 작은 사실 4개 · 월별 집행 막대(마감분 진하게·작성중 연하게, 월 배정 기준선, 이번 달 띠) · 누적 추이(실적 · 계획 · 종료 시 예상).
 * 색은 브랜드 네이비 1색 + 중립(docs/DESIGN.md). 값은 표로도 볼 수 있다(표로 보기).
 */
export function ItemInsight({ name, planned, trend, lines }: {
  name: string; planned: number; trend: ItemTrendInput;
  /** 예산 행 (금액·효력 시작 달) — 계획 누적의 계단 */
  lines: { amount: number; from: string | null }[];
}) {
  const points = useMemo(
    () => itemBurn({ months: trend.months, monthly: trend.months.map(trend.monthOf), lines, elapsed: trend.elapsed, closings: trend.closings }),
    [trend, lines],
  );
  const facts = useMemo(() => itemFacts(points, planned, trend.elapsed), [points, planned, trend.elapsed]);
  const n = points.length;
  const nowIdx = points.findIndex((p) => p.ym === trend.now);
  const lastActual = points.reduce((a, p, i) => (p.actual !== null ? i : a), -1);
  const [sel, setSel] = useState<number | null>(null);
  const active = sel ?? (nowIdx >= 0 ? nowIdx : lastActual);
  const cur = active >= 0 ? points[active] : null;
  if (n === 0) return null;

  const monthPlan = Math.round(planned / n);
  const barMax = niceMax(Math.max(monthPlan, ...points.map((p) => p.amount)));
  const cumMax = niceMax(Math.max(planned, ...points.map((p) => Math.max(p.actual ?? 0, p.forecast ?? 0, p.plan))));
  const empty = planned === 0 && points.every((p) => p.amount === 0);
  const monthNo = (ym: string) => Number(ym.slice(5));
  const sparse = n > 8;

  return (
    <div className="border-t border-line bg-surface-muted/30 px-5 py-3" aria-label={`${name} 추이`}>
      {empty ? <p className="text-sm text-fg-subtle">아직 배정도 집행도 없는 항목입니다.</p> : (
        <>
          {/* 작은 사실 */}
          <dl className="tabular grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-4">
            <Fact label="월 평균 집행" value={facts.avg ? won(facts.avg) : "—"} />
            <Fact label="가장 많이 쓴 달" value={facts.peak ? `${monthNo(facts.peak.ym)}월 ${won(facts.peak.amount)}` : "—"} />
            <Fact label={facts.remainMonths > 0 ? `남은 ${facts.remainMonths}개월 월 가용` : "남은 달"} value={facts.monthlyAvailable !== null ? won(facts.monthlyAvailable) : "없음"} bad={facts.monthlyAvailable !== null && facts.monthlyAvailable < 0} />
            <Fact label="종료 시 예상 잔액" value={won(facts.forecastLeft)} bad={facts.forecastLeft < 0} hint={`예상 총액 ${won(facts.forecast)} — 최근 3개월 평균으로 남은 달을 채운 값`} />
          </dl>

          {/* 고른 달 읽기 (툴팁 대신 고정 자리 — 모바일에서 손가락에 가리지 않게) */}
          {cur && (
            <p className="tabular mt-3 flex min-h-6 flex-wrap items-baseline gap-x-3 text-xs text-fg-muted" aria-live="polite">
              <b className="text-fg">{ymKo(cur.ym)}</b>
              <span>집행 <b className="text-fg">{won(cur.amount)}</b></span>
              {cur.actual !== null
                ? <span>누적 <b className="text-fg">{won(cur.actual)}</b> / 계획 {won(cur.plan)}</span>
                : <span>예상 누적 <b className="text-fg">{won(cur.forecast ?? 0)}</b> / 계획 {won(cur.plan)}</span>}
              {active <= lastActual && <span>· {cur.confirmed ? "마감분" : "작성중"}</span>}
            </p>
          )}

          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
            {/* 월별 집행 막대 */}
            <figure>
              <figcaption className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <b className="text-fg">월별 집행</b>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" aria-hidden />마감분</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand-300" aria-hidden />작성중·미리 입력</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-fg-subtle" aria-hidden />월 배정 {compactWon(monthPlan)}</span>
              </figcaption>
              <Plot max={barMax} n={n} nowIdx={nowIdx} active={active} points={points} setSel={setSel} sparse={sparse}>
                <div className="absolute inset-0 flex">
                  {points.map((p, i) => (
                    <div key={p.ym} className="flex h-full flex-1 items-end justify-center">
                      <div className={`w-3/5 max-w-6 rounded-t ${p.confirmed ? "bg-primary" : "bg-brand-300"}`}
                        style={{ height: `${(p.amount / barMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
                {monthPlan > 0 && <div className="absolute right-0 left-0 border-t-2 border-dashed border-fg-subtle" style={{ top: `${100 - (monthPlan / barMax) * 100}%` }} aria-hidden />}
              </Plot>
            </figure>

            {/* 누적 추이 */}
            <figure>
              <figcaption className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <b className="text-fg">누적 추이</b>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" aria-hidden />집행 누적</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-fg-subtle" aria-hidden />계획 누적</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-primary" aria-hidden />종료 시 예상 {compactWon(facts.forecast)}</span>
              </figcaption>
              <Plot max={cumMax} n={n} nowIdx={nowIdx} active={active} points={points} setSel={setSel} sparse={sparse}>
                <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden>
                  <polyline points={path(points.map((p) => p.plan), cumMax)} fill="none" stroke="var(--c-fg-subtle)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                  <polyline points={path(points.map((p) => p.forecast), cumMax)} fill="none" stroke="var(--c-primary)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <polyline points={path(points.map((p) => p.actual), cumMax)} fill="none" stroke="var(--c-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {/* 끝점: 실적 끝(진하게) · 종료 시 예상(연하게) — 2px 바탕색 테 */}
                {lastActual >= 0 && <Dot i={lastActual} n={n} v={points[lastActual].actual!} max={cumMax} cls="bg-primary" />}
                {lastActual >= 0 && lastActual < n - 1 && points[n - 1].forecast !== null && <Dot i={n - 1} n={n} v={points[n - 1].forecast!} max={cumMax} cls="bg-brand-300" />}
              </Plot>
            </figure>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg">표로 보기</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="table">
                  <thead><tr><th>월</th><th className="text-right">집행</th><th className="text-right">누적</th><th className="text-right">계획 누적</th></tr></thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.ym}>
                        <td className="tabular whitespace-nowrap">{ymKo(p.ym)}</td>
                        <td className="tabular text-right">{won(p.amount)}</td>
                        <td className="tabular text-right">{p.actual !== null ? won(p.actual) : <span className="text-fg-subtle">예상 {won(p.forecast ?? 0)}</span>}</td>
                        <td className="tabular text-right">{won(p.plan)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <a href="/dashboard" className="text-xs font-medium text-primary hover:underline">이 항목 지출 내역 ›</a>
          </div>
        </>
      )}
    </div>
  );
}

function Fact({ label, value, bad, hint }: { label: string; value: string; bad?: boolean; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={`font-semibold ${bad ? "text-status-rejected" : ""}`}>{value}</dd>
    </div>
  );
}

const path = (vals: (number | null)[], max: number) =>
  vals.map((v, i) => (v === null ? null : `${i + 0.5},${100 - (v / max) * 100}`)).filter(Boolean).join(" ");

/** 끝점 — 8px 점 + 2px 바탕색 테 (선 위에서도 읽히게) */
function Dot({ i, n, v, max, cls }: { i: number; n: number; v: number; max: number; cls: string }) {
  return (
    <span className={`pointer-events-none absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-surface ${cls}`}
      style={{ left: `${((i + 0.5) / n) * 100}%`, bottom: `${(v / max) * 100}%` }} aria-hidden />
  );
}

/**
 * 그림 틀 — 왼쪽 눈금(0 · 1/2 · 최대, 1px 실선), 이번 달 띠, 달마다 누르는 영역(호버·포커스·탭), 아래 월 라벨(이번 달 굵게).
 * 높이는 축 라벨까지 포함해 잡는다 (안쪽 스크롤 없음).
 */
function Plot({ max, n, nowIdx, active, points, setSel, sparse, children }: {
  max: number; n: number; nowIdx: number; active: number; points: ItemBurnPoint[]; setSel: (i: number | null) => void; sparse: boolean; children: React.ReactNode;
}) {
  const ticks = [0, max / 2, max];
  return (
    <div onMouseLeave={() => setSel(null)}>
      <div className="relative h-28 pl-10 sm:h-32">
        {ticks.map((t) => (
          <div key={t} className="absolute right-0 left-10 border-t border-line" style={{ top: `${100 - (t / max) * 100}%` }}>
            <span className="tabular absolute -left-10 w-9 -translate-y-1/2 whitespace-nowrap pr-1 text-right text-xs text-fg-subtle">{compactWon(t)}</span>
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-10">
          {/* 이번 달 띠 */}
          {nowIdx >= 0 && <div className="absolute inset-y-0 bg-fg/[0.04]" style={{ left: `${(nowIdx / n) * 100}%`, width: `${100 / n}%` }} aria-hidden />}
          {children}
          {active >= 0 && <div className="pointer-events-none absolute inset-y-0 w-px bg-fg/25" style={{ left: `${((active + 0.5) / n) * 100}%` }} aria-hidden />}
          <div className="absolute inset-0 flex">
            {points.map((p, i) => (
              <button key={p.ym} type="button" className="h-full flex-1 focus-visible:bg-primary/5 focus-visible:outline-none"
                aria-label={`${ymKo(p.ym)} 집행 ${won(p.amount)}원`} aria-pressed={i === active}
                onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1 flex pl-10 text-xs text-fg-muted">
        {points.map((p, i) => (
          <span key={p.ym} className={`tabular flex-1 whitespace-nowrap text-center ${i === nowIdx ? "font-semibold text-fg" : ""} ${sparse && i % 2 === 1 && i !== nowIdx ? "max-sm:invisible" : ""}`}>
            {Number(p.ym.slice(5))}
          </span>
        ))}
      </div>
    </div>
  );
}
