"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem = {
  label: ReactNode;
  onSelect: () => void;
  /** 같은 group 값이 이어지면 그 위에 묶음 제목을 한 번 보여 준다 */
  group?: string;
  /** 현재 값 표시 (✓) — 필터 칩처럼 '고르기' 메뉴에서 */
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  key?: string;
};

/**
 * 앱 공통 드롭다운 메뉴 — 네이티브 <select>를 칩·버튼 위에 투명하게 겹치던 자리에 쓴다.
 * 누르는 버튼(trigger)은 children·triggerClassName으로 꾸미고, 목록은 디자인된 패널로 띄운다.
 * 바깥 누름·Esc·스크롤·크기 변경이면 닫히고, ↑↓로 항목을 옮겨 다닌다. 가로 스크롤 표나 고정 열 안에서도
 * 잘리지 않게 화면 기준(fixed)으로 body에 그린다(portal). 화면 아래가 모자라면 높이를 줄여 스크롤한다.
 */
export function Menu({ label, items, children, triggerClassName, align = "left", disabled, minWidth = 160, matchTrigger }: {
  /** 접근성 이름 (버튼의 aria-label) */
  label: string;
  items: MenuItem[];
  /** 버튼 안에 보일 내용 */
  children: ReactNode;
  triggerClassName?: string;
  align?: "left" | "right";
  disabled?: boolean;
  /** 패널 최소 너비(px) */
  minWidth?: number;
  /** 패널 너비를 버튼 너비에 맞춘다 (input처럼 보이는 버튼) */
  matchTrigger?: boolean;
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; maxHeight: number; width?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const open = !!pos;

  useEffect(() => {
    if (!open) return;
    const focusables = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not(:disabled)") ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPos(null); btn.current?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const list = focusables();
        if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
        list[next].focus({ preventScroll: true });
        list[next].scrollIntoView({ block: "nearest" });
      }
      if (e.key === "Tab") setPos(null);
    };
    const onDown = (e: MouseEvent) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    const close = () => setPos(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    // 열리면 현재 값(✓) 또는 첫 항목으로 포커스
    const list = focusables();
    (list.find((b) => b.getAttribute("aria-checked") === "true") ?? list[0])?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const maxHeight = Math.max(160, Math.min(below, Math.round(window.innerHeight * 0.6)));
    // 아래 공간이 너무 모자라면 버튼 위로
    const up = below < 160 && r.top > below;
    const top = up ? Math.max(8, r.top - 4 - Math.min(maxHeight, r.top - 12)) : r.bottom + 4;
    const base = { top, maxHeight: up ? Math.min(maxHeight, r.top - 12) : maxHeight, width: matchTrigger ? r.width : undefined };
    setPos(align === "right" ? { ...base, right: Math.max(8, window.innerWidth - r.right) } : { ...base, left: Math.max(8, Math.min(r.left, window.innerWidth - 8 - Math.max(minWidth, r.width))) });
  };

  const hasCheck = items.some((i) => i.selected !== undefined);
  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} type="button" className={triggerClassName} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={toggle}>
        {children}
      </button>
      {pos && createPortal(
        <ul ref={menu} role="menu" aria-label={label}
          style={{ top: pos.top, left: pos.left, right: pos.right, maxHeight: pos.maxHeight, minWidth, width: pos.width }}
          className="fixed z-[70] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-pop">
          {items.map((a, idx) => {
            const head = a.group && a.group !== lastGroup ? a.group : null;
            lastGroup = a.group;
            return (
              <li key={a.key ?? `${idx}`} role="none">
                {head && <div role="presentation" className={`px-3 pb-1 text-xs font-bold text-fg-subtle ${idx ? "mt-1 border-t border-line pt-2" : "pt-1"}`}>{head}</div>}
                <button type="button" role={hasCheck ? "menuitemradio" : "menuitem"} aria-checked={hasCheck ? !!a.selected : undefined} disabled={a.disabled}
                  className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm disabled:opacity-40 sm:min-h-9 ${a.danger ? "text-status-rejected" : "text-fg"} ${a.selected ? "font-semibold" : ""} hover:bg-surface-muted focus:bg-surface-muted focus:outline-none`}
                  onClick={() => { setPos(null); a.onSelect(); }}>
                  <span className="min-w-0 flex-1">{a.label}</span>
                  {hasCheck && <span aria-hidden className={`shrink-0 text-primary ${a.selected ? "" : "invisible"}`}>✓</span>}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </>
  );
}

/** 메뉴 버튼 끝의 작은 화살표 */
export function Caret({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`text-fg-subtle ${className}`}>▾</span>;
}
