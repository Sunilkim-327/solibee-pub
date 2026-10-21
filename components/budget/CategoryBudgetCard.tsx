"use client";

import { useId } from "react";
import { won } from "@/lib/format";
import type { BudgetItem, Line, PricePatch } from "./types";
import type { CategoryGaugeData } from "./model";
import { CategoryHead, MoneyInput, TrashIcon, periodsOf } from "./ui";

/**
 * 분류 전체를 예산 하나로: 머리줄에 잔액·배정·집행·집행률 게이지(일반 분류 카드와 같은 부품, 접혀 있어도 보임),
 * 본문 맨 위 한 줄은 단가 × 기간 입력만, 아래는 항목별 사용(지출)만 짧게. 새 항목은 자동으로 이 예산에 포함.
 * 접으면(folded) 머리(이름·배지·게이지·'항목별 예산으로')만 남는다.
 */
export function CategoryBudgetCard({ name, edit, months, line, gauge, items, spentOfItem, onPrice, onBreak, onDelete, addButton, folded, onToggleFold }: {
  name: string; edit: boolean; months: number; line: Line | undefined; gauge: CategoryGaugeData;
  items: BudgetItem[]; spentOfItem: (id: string) => number;
  onPrice: (p: PricePatch) => void; onBreak: () => void; onDelete: (i: BudgetItem) => void;
  addButton: React.ReactNode;
  folded: boolean; onToggleFold: () => void;
}) {
  const bodyId = useId();
  return (
    <section className="card overflow-hidden">
      <CategoryHead name={name} folded={folded} controls={bodyId} onToggle={onToggleFold} count={items.length} badge="분류 전체 한 예산" gauge={gauge}
        action={edit ? <button type="button" className="btn-secondary btn-sm" onClick={onBreak}>항목별 예산으로</button> : null} />
      <div id={bodyId} hidden={folded} className="border-t border-line">
      {/* 예산 한 줄 — 단가 × 기간만 (배정·집행·잔액은 머리줄 게이지가 보여 준다) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-surface-muted/40 px-5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">단가</span>
          {edit ? <MoneyInput value={line?.unitPrice ?? 0} onChange={(n) => onPrice({ unitPrice: n })} label={`${name} 단가`} className="w-36" />
            : <b className="tabular">{won(line?.unitPrice ?? 0)}</b>}
          <span className="text-fg-muted">×</span>
          {edit ? (
            <input className="input tabular w-16 py-1.5 text-right" inputMode="numeric" aria-label={`${name} 기간(회)`} value={line?.periods ?? months}
              onChange={(e) => onPrice({ periods: periodsOf(e.target.value) })} />
          ) : <b className="tabular">{line?.periods ?? months}</b>}
          <span className="text-fg-muted">회</span>
        </div>
        <span className="text-xs text-fg-muted">분류의 모든 항목이 이 예산을 함께 씁니다</span>
      </div>
      {/* 항목별 사용 */}
      <div className="px-5 pt-3 pb-1 text-xs font-medium text-fg-muted">항목별 집행</div>
      <ul className="grid gap-x-6 px-5 pb-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.id} className={`flex items-center gap-2 border-b border-line/60 py-2 text-sm ${i.active ? "" : "opacity-60"}`}>
            <span className="min-w-0 flex-1 truncate">{i.name}</span>
            <span className="tabular text-fg-muted">{won(spentOfItem(i.id))}</span>
            {edit && (
              <button type="button" onClick={() => onDelete(i)} aria-label={`${i.name} 삭제`} title="삭제"
                className="flex size-9 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-rose-50 hover:text-rose-600">
                <TrashIcon />
              </button>
            )}
          </li>
        ))}
      </ul>
      {addButton}
      </div>
    </section>
  );
}
