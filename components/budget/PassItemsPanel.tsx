"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { won } from "@/lib/format";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";
import { useRun, type RunColors } from "../hooks/useRun";
import type { BudgetItem, MonthRef, PassCompany, Template } from "./types";
import { MoneyInput } from "./ui";

const COLORS: RunColors = { ok: "text-emerald-700", error: "text-rose-600", size: "text-xs" };

/** 출입증 회사 부담 항목 — 연결 예산 항목이 있으면 월 확정분이 그 예산 항목의 집행에 합쳐진다 (예산은 하나, 쓰는 방법은 둘) */
export function PassItemsPanel({ projectId, items, templates, enabled, edit, company, budgetItems, months }: {
  projectId: string; items: BudgetItem[]; templates: Template[]; enabled: boolean; edit: boolean;
  company: Record<string, PassCompany>;
  /** 연결할 수 있는 예산 항목 */
  budgetItems: BudgetItem[];
  months: MonthRef[];
}) {
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState(0);
  const { act, busy, view } = useRun(COLORS);
  // 공통 항목 중 이 프로젝트에 아직 없는 것
  const avail = templates.filter((t) => !items.some((i) => i.name === t.name || (i.code && i.code === t.code)));
  const picked = avail.find((t) => t.id === pick);
  const newName = picked ? picked.name : name.trim();
  if (!enabled && !items.length) return null;
  const patch = (id: string, json: Record<string, unknown>) => act(() => api(`/api/master/items/${id}`, { method: "PATCH", json }));
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="section-title">출입증 회사 부담 항목</h2>
        <p className="w-full text-sm text-fg-muted">회사 부담 출입증 사용분은 월 확정 후 연결한 예산 항목의 집행에 합쳐집니다. 연결하지 않으면 예산에 들어가지 않습니다.</p>
      </header>
      <ul className="divide-y divide-line">
        {items.length === 0 && <li className="px-5 py-4 text-sm text-fg-muted">아직 없습니다. 모든 출입증 사용분이 본인 부담(급여 공제)으로 처리됩니다.</li>}
        {items.map((i) => {
          const c = company[i.id];
          const linked = budgetItems.find((b) => b.id === i.linkedItemId);
          const used = months.filter((m) => c?.months[m.ym]);
          return (
            <li key={i.id} className={`space-y-1.5 px-5 py-3 text-sm ${i.active ? "" : "opacity-60"}`}>
              {/* 좁은 화면: 항목명은 한 줄을 다 쓰고(옆 요소에 밀려 한 글자씩 세로로 깨지지 않게) 한도·누계·연결은 아래로 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-full truncate font-medium sm:w-auto sm:min-w-0 sm:flex-1" title={i.name}>{i.name}</span>
                <span className="tabular text-fg-muted">1일 한도 {i.perPersonLimit ? `${won(i.perPersonLimit)}원` : "없음"}</span>
                <span className="text-fg-muted">회사 부담 누계 <b className="tabular text-fg">{won(c?.confirmed ?? 0)}원</b>
                  {c?.pending ? <span className="text-fg-subtle"> · 확정 전 {won(c.pending)}원</span> : null}</span>
                {edit ? (
                  <label className="flex items-center gap-1.5 text-xs text-fg-muted">연결 예산 항목
                    <select className="input w-40 py-1 sm:text-xs" value={i.linkedItemId ?? ""} disabled={busy} aria-label={`${i.name} 연결 예산 항목`}
                      onChange={(e) => patch(i.id, { linkedItemId: e.target.value || null })}>
                      <option value="">연결 안 함</option>
                      {budgetItems.filter((b) => b.active || b.id === i.linkedItemId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                ) : <span className="text-xs text-fg-muted">연결 예산 항목 <b className="text-fg">{linked?.name ?? "없음"}</b></span>}
                {edit && (
                  <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <input type="checkbox" checked={i.active} disabled={busy} onChange={(e) => patch(i.id, { active: e.target.checked })} /> 사용
                  </label>
                )}
              </div>
              {used.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs text-fg-muted">
                  {used.map((m) => <span key={m.ym} className="tabular rounded bg-surface-muted px-1.5 py-0.5">{m.label} {won(c!.months[m.ym])}</span>)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {edit && (
        // 좁은 화면: 고르기·항목명은 한 줄씩 꽉 차게, 한도·추가는 한 줄
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-line bg-surface-muted/40 px-5 py-3 sm:flex sm:flex-wrap">
          <select className="input col-span-2 py-1.5 sm:w-56 sm:text-sm" value={pick} aria-label="공통 항목에서 고르기"
            onChange={(e) => { setPick(e.target.value); const t = avail.find((x) => x.id === e.target.value); setLimit(t?.perPersonLimit ?? 0); }}>
            <option value="">새 항목 직접 입력</option>
            {avail.length > 0 && <optgroup label="공통 항목에서 가져오기">{avail.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
          </select>
          {!picked && <input className="input col-span-2 py-1.5 sm:w-48" aria-label="항목명" placeholder="항목명 (예: 야근식대)" value={name} onChange={(e) => setName(e.target.value)} />}
          <MoneyInput value={limit} onChange={setLimit} label="1일 한도" className="sm:w-32" />
          <button className="btn-secondary px-3 py-1.5 text-sm" disabled={busy || !newName}
            onClick={() => act(async () => {
              // 한도는 만들 때 함께 (따로 PATCH하면 중간에 실패할 때 한도 없는 항목이 남음)
              await api("/api/master/items", {
                method: "POST", json: { projectId, categoryId: PASS_CATEGORY_ID, name: newName, ...(picked?.code ? { code: picked.code } : {}), ...(limit ? { perPersonLimit: limit } : {}) },
              });
              setName(""); setLimit(0); setPick("");
            })}>추가</button>
          {view && <div className="col-span-2">{view}</div>}
        </div>
      )}
    </section>
  );
}
