"use client";

import { Fragment } from "react";
import { won } from "@/lib/format";
import type { BudgetItem, MonthRef } from "./types";

/** 월 배정: 전체 배정 ÷ 개월수를 매달, 끝전은 마지막 달 (집행 추이 차트의 배정 누적과 같은 나눔) */
export function monthlyPlan(planned: number, n: number): number[] {
  if (n <= 0) return [];
  const each = Math.round(planned / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? planned - each * (n - 1) : each));
}

/**
 * 월별 배정 대비 집행 — 위 네 줄은 달마다 배정·집행·남음·누적 집행률, 아래는 항목별 월 집행(히트맵).
 * 묶인 항목은 대표 항목에 합산되어 따로 줄이 없다. 아직 오지 않은 달은 배정만 보인다.
 */
export function MonthlyView({ months, groups, alias, monthOf, plannedOf, planned, now }: {
  months: MonthRef[];
  groups: { id: string; name: string; items: BudgetItem[] }[];
  alias: Map<string, string>;
  monthOf: (id: string, ym: string) => number;
  plannedOf: (id: string) => number;
  /** 전체 배정 (화면의 예산 합계) */
  planned: number;
  /** 이번 달 "YYYY-MM" — 없으면 모든 달을 지난 달로 본다 */
  now: string | null;
}) {
  const rows = groups.flatMap((g) => g.items.filter((i) => !alias.has(i.id)).map((i) => ({ g: g.name, i, cells: months.map((m) => monthOf(i.id, m.ym)), planned: plannedOf(i.id) })))
    .filter((r) => r.planned > 0 || r.cells.some((v) => v > 0));
  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  const colTotal = months.map((_, k) => rows.reduce((a, r) => a + r.cells[k], 0));
  const plan = monthlyPlan(planned, months.length);
  const past = months.map((m) => !now || m.ym <= now);
  const spentTotal = colTotal.reduce((a, b) => a + b, 0);
  let cumSpent = 0;
  let cumPlan = 0;
  const cumRate = months.map((_, k) => {
    cumSpent += colTotal[k];
    cumPlan += plan[k];
    return past[k] && cumPlan > 0 ? Math.round((cumSpent / cumPlan) * 100) : null;
  });
  const head = "sticky left-0 z-10 bg-surface px-4 py-1.5 whitespace-nowrap text-left font-medium";
  const cell = "tabular px-2 py-1.5 text-right text-sm";
  const sumRow = (label: string, cells: React.ReactNode[], total: React.ReactNode, cls = "") => (
    <tr className={`border-t border-line/60 ${cls}`}>
      <th scope="row" className={head}>{label}</th>
      {cells.map((c, k) => <td key={k} className={cell}>{c}</td>)}
      <td className={`${cell} px-4 font-semibold`}>{total}</td>
    </tr>
  );
  const dot = <span className="text-fg-subtle">·</span>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="bg-surface-muted/50 text-xs text-fg-muted">
            <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">월</th>
            {months.map((m, k) => <th key={m.ym} className={`px-2 py-2 text-right font-medium ${now && m.ym === now ? "text-fg" : ""}`}>{m.label}</th>)}
            <th className="px-4 py-2 text-right font-medium">합계</th>
          </tr>
        </thead>
        <tbody>
          {planned > 0 && sumRow("배정", plan.map((v) => won(v)), won(planned), "text-fg-muted")}
          {sumRow("집행", colTotal.map((v) => (v ? won(v) : dot)), won(spentTotal), "font-semibold")}
          {planned > 0 && sumRow("남음",
            plan.map((v, k) => {
              if (!past[k]) return dot;
              const d = v - colTotal[k];
              return <span className={d < 0 ? "font-semibold text-status-rejected" : ""}>{d < 0 ? `-${won(-d)}` : won(d)}</span>;
            }),
            (() => { const d = planned - spentTotal; return <span className={d < 0 ? "text-status-rejected" : ""}>{d < 0 ? `-${won(-d)}` : won(d)}</span>; })(),
          )}
          {planned > 0 && sumRow("누적 집행률",
            cumRate.map((r) => (r === null ? dot : <span className={r > 100 ? "font-semibold text-status-rejected" : ""}>{r}%</span>)),
            `${Math.round((spentTotal / planned) * 100)}%`,
            "text-fg-muted",
          )}
          <tr><td colSpan={months.length + 2} className="sticky left-0 bg-surface-muted/50 px-4 py-1.5 text-sm font-bold text-fg-muted">항목별 월 집행</td></tr>
          {rows.map((r, idx) => (
            <Fragment key={r.i.id}>
              {(idx === 0 || rows[idx - 1].g !== r.g) && (
                <tr><td colSpan={months.length + 2} className="sticky left-0 bg-surface px-4 pt-3 pb-1 text-sm font-bold">{r.g}</td></tr>
              )}
              <tr className="border-t border-line/60">
                <td className="sticky left-0 z-10 bg-surface px-4 py-1.5 whitespace-nowrap">{r.i.name}</td>
                {r.cells.map((v, k) => (
                  <td key={k} className="tabular px-1 py-1 text-right text-sm">
                    <span className="block rounded-md px-1.5 py-1" style={v ? { backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(8 + (v / max) * 40)}%, transparent)` } : undefined}>
                      {v ? won(v) : dot}
                    </span>
                  </td>
                ))}
                <td className="tabular px-4 py-1.5 text-right text-sm font-semibold">
                  {won(r.cells.reduce((a, b) => a + b, 0))}
                  {r.planned > 0 && <span className="block font-normal text-fg-subtle">/ {won(r.planned)}</span>}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
