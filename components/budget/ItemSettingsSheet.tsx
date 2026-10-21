"use client";

import { Sheet } from "@/components/Sheet";
import { Caret, Menu } from "@/components/Menu";
import type { BudgetItem, CategoryRef, PricePatch, Settings } from "./types";
import { MoneyInput, periodsOf } from "./ui";
import { won } from "@/lib/format";

/**
 * 항목 설정 시트 — 행 끝 "⋯ → 항목 설정"에서 연다 (모바일은 바텀시트, PC는 가운데 작은 대화상자).
 * 항목명·분류·1인당 한도·묶음·참석자 필수·잔액 초과 막기·사용. 바꾸는 즉시 자동 저장 흐름(onSetting)으로 들어간다.
 * 기본값과 다른 설정만 행의 칩으로 보이므로, 여기서 끄면 칩도 사라진다.
 */
export function ItemSettingsSheet(x: {
  item: BudgetItem; settings: Settings; categories: CategoryRef[];
  bundle: string[]; candidates: BudgetItem[]; nameOf: (id: string) => string;
  /** 예산 행이 하나(상세내역·변경계약 없음)면 단가·기간을 여기서도 — 항목 추가 직후 자동으로 열려 바로 넣게 */
  price: {
    unitPrice: number; periods: number; months: number; onPrice: (p: PricePatch) => void;
    /** 그 행의 상세내역 (행이 없으면 null — 단가를 넣으면 생긴다) */
    detail: { value: string; onChange: (v: string) => void } | null;
  } | null;
  /** 보조 줄로 나뉜 예산 행 수 (price가 null일 때) */
  lineCount: number;
  onSetting: (s: Partial<Settings>) => void; onAddBundle: (id: string) => void; onRemoveBundle: (id: string) => void;
  onClose: () => void;
}) {
  const s = x.settings;
  const id = x.item.id;
  return (
    <Sheet title="항목 설정" onClose={x.onClose}
      footer={<div className="flex justify-end"><button type="button" className="btn-primary" onClick={x.onClose}>완료</button></div>}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-center">
          <span className="text-fg-muted" title="배정 = 단가 × 기간(회). 기간은 단가를 쓸 수 있는 횟수">배정</span>
          {x.price ? (
            <div className="tabular flex flex-wrap items-center gap-2">
              <MoneyInput value={x.price.unitPrice} onChange={(n) => x.price!.onPrice({ unitPrice: n })} label={`${s.name} 단가`} className="w-32" />
              <span className="text-fg-muted">×</span>
              <input className="input tabular w-16 text-right" inputMode="numeric" aria-label={`${s.name} 기간(회)`} placeholder={String(x.price.months)}
                value={x.price.periods} onChange={(e) => x.price!.onPrice({ periods: periodsOf(e.target.value) })} />
              <span className="text-fg-muted">회 =</span>
              <b>{won(x.price.unitPrice * x.price.periods)}</b>
            </div>
          ) : <span className="text-fg-muted">예산 행 {x.lineCount}개 — 항목 아래 보조 줄에서 고칩니다.</span>}
          {x.price && (
            <>
              <label htmlFor={`${id}-detail`} className="text-fg-muted">상세내역</label>
              <input id={`${id}-detail`} className="input" placeholder={x.price.detail ? "선택 — 예: 사무용품 일괄 구매" : "단가를 먼저 넣으세요"} disabled={!x.price.detail}
                value={x.price.detail?.value ?? ""} maxLength={60} onChange={(e) => x.price?.detail?.onChange(e.target.value)} />
            </>
          )}
          <label htmlFor={`${id}-name`} className="text-fg-muted">항목명</label>
          <input id={`${id}-name`} className="input" value={s.name} maxLength={40} onChange={(e) => x.onSetting({ name: e.target.value })} />
          <label htmlFor={`${id}-cat`} className="text-fg-muted">분류</label>
          <select id={`${id}-cat`} className="input" value={s.categoryId} onChange={(e) => x.onSetting({ categoryId: e.target.value })}>
            {x.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="text-fg-muted" title="금액 ÷ 대상인원이 이 금액을 넘으면 소명이 필요합니다">1인당 한도</span>
          <div className="flex items-center gap-2">
            <MoneyInput value={s.perPersonLimit ?? 0} onChange={(n) => x.onSetting({ perPersonLimit: n || null })} label="1인당 한도" className="w-36" />
            <span className="text-xs text-fg-subtle">비우면 한도 없음</span>
          </div>
          <span className="text-fg-muted" title="같은 분류의 다른 항목을 이 예산에 넣으면 지출이 합산됩니다">묶음</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {x.bundle.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                {x.nameOf(b)}
                <button type="button" className="text-brand-700/60 hover:text-rose-600" onClick={() => x.onRemoveBundle(b)} aria-label={`${x.nameOf(b)} 빼기`}>✕</button>
              </span>
            ))}
            {x.candidates.length > 0 ? (
              <Menu label="묶을 항목" triggerClassName="btn-secondary btn-sm gap-1"
                items={x.candidates.map((c) => ({ key: c.id, label: c.name, onSelect: () => x.onAddBundle(c.id) }))}>
                + 항목 묶기 <Caret />
              </Menu>
            ) : x.bundle.length === 0 && <span className="text-xs text-fg-subtle">같은 분류에 묶을 항목 없음</span>}
          </div>
        </div>
        <div className="space-y-2 border-t border-line pt-3">
          <label className="flex min-h-10 items-center gap-2.5 sm:min-h-8">
            <input type="checkbox" className="size-4" checked={s.needsAttendees} onChange={(e) => x.onSetting({ needsAttendees: e.target.checked })} />
            <span>참석자 필수 <span className="text-xs text-fg-subtle">— 지출 입력 때 참석자·인원 필수 (1인당 한도 점검용)</span></span>
          </label>
          <label className="flex min-h-10 items-center gap-2.5 sm:min-h-8">
            <input type="checkbox" className="size-4" checked={s.hardBudget} onChange={(e) => x.onSetting({ hardBudget: e.target.checked })} />
            <span>잔액 초과 막기 <span className="text-xs text-fg-subtle">— 끄면 소명 후 입력 허용</span></span>
          </label>
          <label className="flex min-h-10 items-center gap-2.5 sm:min-h-8">
            <input type="checkbox" className="size-4" checked={s.active} onChange={(e) => x.onSetting({ active: e.target.checked })} />
            <span>사용 <span className="text-xs text-fg-subtle">— 끄면 입력 화면에서만 빠지고 기록·예산은 남음</span></span>
          </label>
        </div>
      </div>
    </Sheet>
  );
}
