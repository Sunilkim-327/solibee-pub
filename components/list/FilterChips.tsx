"use client";

// 필터 칩 줄 — 두 상태: 값 없음 "결제자 +" (누르면 고르기) / 값 있음 "박지민 ✕" (✕로 해제, 글자를 누르면 다시 고르기).
// 고르기는 공통 Menu(디자인된 목록)로 — 현재 값에 ✓.
import { chip } from "@/components/ui";
import { Menu } from "@/components/Menu";

export type SelectChip = { key: string; label: string; value: string; options: readonly (readonly [string, string])[] };
export type ToggleChip = { key: string; label: React.ReactNode; on: boolean; ariaLabel?: string };

export function FilterChips({ selects = [], toggles = [], onSelect, onToggle, onClearAll, className = "" }: {
  selects?: SelectChip[];
  toggles?: ToggleChip[];
  onSelect?: (key: string, value: string) => void;
  onToggle?: (key: string) => void;
  /** 적용된 칩이 둘 이상일 때 "모두 해제" */
  onClearAll?: () => void;
  className?: string;
}) {
  // 고를 필터가 없으면 자리도 차지하지 않는다 (예: 팀원 본인 내역에 분류·결제방법이 한 가지뿐)
  if (!selects.length && !toggles.length) return null;
  const active = selects.filter((s) => s.value).length + toggles.filter((t) => t.on).length;
  return (
    <div className={`-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 ${className}`}>
      {toggles.map((t) => (
        <button key={t.key} type="button" aria-pressed={t.on} aria-label={t.ariaLabel} onClick={() => onToggle?.(t.key)} className={`${chip(t.on)} shrink-0 gap-1 whitespace-nowrap`}>
          {t.label}
          {t.on && <span aria-hidden className="ml-0.5">✕</span>}
        </button>
      ))}
      {selects.map((s) => {
        const on = !!s.value;
        const picked = s.options.find(([v]) => v === s.value)?.[1];
        return (
          <span key={s.key} className={`${chip(on)} shrink-0 gap-0 whitespace-nowrap px-0 sm:px-0`}>
            <Menu label={s.label} triggerClassName={`inline-flex min-h-full items-center gap-1 rounded-full py-1.5 pl-3.5 sm:py-0.5 sm:pl-3 ${on ? "pr-1" : "pr-3.5 sm:pr-3"}`}
              items={[
                { key: "", label: `전체 ${s.label}`, selected: !on, onSelect: () => onSelect?.(s.key, "") },
                ...s.options.map(([v, l]) => ({ key: v, label: l, selected: v === s.value, onSelect: () => onSelect?.(s.key, v) })),
              ]}>
              {on ? picked ?? s.label : s.label}
              {!on && <span aria-hidden className="text-fg-subtle">+</span>}
            </Menu>
            {on && (
              <button type="button" className="mr-1.5 flex size-6 items-center justify-center rounded-full hover:bg-white/15"
                aria-label={`${s.label} 필터 해제`} onClick={() => onSelect?.(s.key, "")}>✕</button>
            )}
          </span>
        );
      })}
      {active >= 2 && onClearAll && (
        <button type="button" className="shrink-0 px-2 text-sm font-medium whitespace-nowrap text-fg-muted underline-offset-2 hover:text-fg hover:underline" onClick={onClearAll}>
          모두 해제
        </button>
      )}
    </div>
  );
}
