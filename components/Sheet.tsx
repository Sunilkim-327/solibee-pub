"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 하단 시트(모바일) / 가운데 대화상자(데스크톱). 배경 클릭·Esc·✕로 닫는다.
 * 열릴 때 대화상자로 포커스, Tab은 시트 안에서 순환, 닫히면 이전 포커스로 복귀.
 */
export function Sheet({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 시트 아래에 고정되는 동작 영역 (예: [완료] 버튼) — 내용이 길어 스크롤돼도 항상 보인다 */
  footer?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 초기 포커스 + 닫힐 때 복귀
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = panel.current;
    // 자식이 autoFocus로 이미 포커스를 가져갔으면 그대로 둔다.
    // 아니면 대화상자 자체에 포커스 (모바일에서 키보드가 바로 뜨지 않도록 입력칸은 피함)
    if (el && !el.contains(document.activeElement)) el.focus();
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);

  // Esc 닫기 + 포커스 가두기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (!e.defaultPrevented) closeRef.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 겹 순서: 고정 입력 막대 40 < 하단 메뉴 50 < 시트 55 < 알림(toast) 60 < 확인 창 65
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div ref={panel} tabIndex={-1} className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-sheet outline-none sm:rounded-2xl"
        role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-base font-bold">{title}</h3>
          <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto px-5 ${footer ? "pb-4" : "pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5"}`}>{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-line px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
