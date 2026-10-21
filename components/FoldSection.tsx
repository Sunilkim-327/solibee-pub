"use client";
// 접을 수 있는 카드 — 머리(제목·요약)는 늘 보이고, 내용은 접기/펼치기. 펼침 상태는 이 브라우저에 기억한다
// (편의 기능: 저장소를 못 쓰면 기본 상태로 보일 뿐)
import { useEffect, useId, useState } from "react";
import { Icon } from "./icons";

export function FoldSection({ storageKey, head, children, defaultOpen = false, className = "", label }: {
  storageKey: string;
  /** 늘 보이는 머리 (제목·건수·금액) */
  head: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** 접근성 이름 */
  label: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "1" || v === "0") setOpen(v === "1");
    } catch { /* 기본 상태 */ }
  }, [storageKey]);
  function toggle() {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* 기억하지 못할 뿐 */ }
  }
  return (
    <section className={`card overflow-hidden ${className}`} aria-label={label}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id}
        className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-surface-muted/60 sm:px-5">
        <div className="min-w-0 flex-1">{head}</div>
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium text-fg-muted">
          {open ? "접기" : "펼치기"}
          <Icon name="chevronDown" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      <div id={id} hidden={!open}>{children}</div>
    </section>
  );
}
