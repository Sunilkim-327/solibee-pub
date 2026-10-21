"use client";

import { Fragment } from "react";
import { won, ymKo } from "@/lib/format";
import type { MonthItemRow } from "@/lib/settlement";

/**
 * 선택한 달의 항목별 월 배정 대비 집행 — 항목별 보기가 전체 기간이라면 여기는 한 달.
 * 매월 항목: 월 배정(배정 ÷ 개월수) · 집행 · 남음 (항목별 보기의 '이번 달 가용'과 같은 계산).
 * 비정기 항목(기간이 개월수보다 짧은 것): 월 배정이 없어 집행만 — 누적 잔액은 항목별 보기에서.
 * 달은 ?ym= 으로 바꾼다 — 화면 머리글의 월 이동(MonthNav, 월별 보기일 때만 보임)에서, 현황·마감 화면과 같은 자리.
 */
export function MonthItems({ ym, now, rows, totals }: {
  ym: string;
  /** 이번 달 "YYYY-MM" — 아직 오지 않은 달은 집행 대신 '·' */
  now: string | null;
  rows: MonthItemRow[];
  totals: { budget: number; spent: number; left: number; irregularSpent: number };
}) {
  const future = !!now && ym > now;
  const dot = <span className="text-fg-subtle">·</span>;
  const money = (v: number | null, opt: { bold?: boolean; sign?: boolean } = {}) => {
    if (v === null) return dot;
    const neg = v < 0;
    return <span className={`${opt.bold ? "font-semibold" : ""} ${neg && opt.sign ? "font-semibold text-status-rejected" : ""}`}>{neg ? `-${won(-v)}` : won(v)}</span>;
  };
  const num = "tabular px-2 py-2 text-right whitespace-nowrap sm:px-3";
  // 분류 순서대로 묶는다 (항목별 보기와 같은 순서)
  const groups: { name: string; rows: MonthItemRow[] }[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.name === r.categoryName) g.rows.push(r); else groups.push({ name: r.categoryName, rows: [r] });
  }
  return (
    <section className="card overflow-hidden" aria-label={`${ymKo(ym)} 항목별 월 배정 대비 집행`}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="section-title">{ymKo(ym)} 항목별</h2>
        <span className="text-label text-fg-muted">월 배정 = 배정 ÷ 개월수 (매월 항목만)</span>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-fg-muted">예산 항목이 없어요.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-muted/50 text-xs text-fg-muted">
                <th className="px-4 py-2 text-left font-medium sm:px-5">항목</th>
                <th className={`${num} font-medium`}>월 배정</th>
                <th className={`${num} font-medium`}>집행</th>
                <th className={`${num} font-medium`}>남음</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-brand-50 font-bold">
                <td className="px-4 py-2 sm:px-5">전체<span className="ml-2 text-xs font-normal text-fg-muted">매월 항목{totals.irregularSpent > 0 && <> · 비정기 {won(totals.irregularSpent)} 별도</>}</span></td>
                <td className={num}>{won(totals.budget)}</td>
                <td className={num}>{future ? dot : won(totals.spent)}</td>
                <td className={num}>{future ? money(totals.budget) : money(totals.left, { sign: true })}</td>
              </tr>
              {groups.map((g) => {
                const reg = g.rows.filter((r) => r.budget !== null);
                const gBudget = reg.reduce((a, r) => a + (r.budget ?? 0), 0);
                const gSpent = g.rows.reduce((a, r) => a + r.spent, 0);
                const gLeft = gBudget - reg.reduce((a, r) => a + r.spent, 0);
                return (
                  <Fragment key={g.name}>
                    <tr className="border-t border-line bg-surface-muted/40 text-sm font-bold">
                      <td className="px-4 py-1.5 sm:px-5">{g.name}</td>
                      <td className={num}>{gBudget ? won(gBudget) : dot}</td>
                      <td className={num}>{future || !gSpent ? dot : won(gSpent)}</td>
                      <td className={num}>{!gBudget ? dot : future ? won(gBudget) : money(gLeft, { sign: true })}</td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.itemId} className="border-t border-line/60">
                        {/* 예산이 없는 항목은 옅게, 비정기(기간이 개월수보다 짧은 예산)는 표시 */}
                        <td className={`px-4 py-2 sm:px-5 ${r.planned <= 0 ? "text-fg-subtle" : ""}`}>
                          {r.itemName}
                          {r.budget === null && r.planned > 0 && <span className="badge badge-neutral ml-1.5 align-middle font-medium" title="기간(회)이 개월수보다 짧은 항목 — 월 배정 없이 누적 잔액만 봅니다">비정기</span>}
                        </td>
                        <td className={`${num} ${r.budget === null ? "text-fg-subtle" : ""}`}>{money(r.budget)}</td>
                        <td className={num}>{future || !r.spent ? dot : won(r.spent)}</td>
                        <td className={num}>{r.left === null ? dot : future ? money(r.budget) : money(r.left, { sign: true })}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
