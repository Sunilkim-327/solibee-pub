"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icons";
import type { User } from "./types";

/**
 * PM 후보 검색 선택 (전사 인원이 많을 때를 위해 검색형) — users는 직급 → 성명 순
 * 키보드: ↑↓ 후보 이동 · Enter 선택 · Esc 닫기 (combobox + listbox)
 */
export function PersonPicker({ users, value, onChange, placeholder }: { users: User[]; value: string; onChange: (id: string) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const pickedRef = useRef<HTMLButtonElement>(null);
  /** 키보드로 닫았을 때 선택 표시 버튼으로 포커스를 돌려줌 */
  const refocus = useRef(false);
  const picked = users.find((u) => u.id === value);
  const list = users
    .filter((u) => u.active && u.role !== "HQ" && u.role !== "ADMIN")
    .filter((u) => !q.trim() || `${u.name} ${u.loginId ?? ""} ${u.position ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  const cur = Math.min(active, list.length - 1);
  const optionId = (i: number) => `${listId}-o${i}`;

  useEffect(() => {
    if (!open && refocus.current) { refocus.current = false; pickedRef.current?.focus(); }
  }, [open]);

  const choose = (u: User) => { onChange(u.id); setQ(""); refocus.current = true; setOpen(false); };
  const close = () => { refocus.current = true; setOpen(false); };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      if (!list.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((cur + d + list.length) % list.length);
    } else if (e.key === "Enter") {
      if (open && list[cur]) { e.preventDefault(); choose(list[cur]); }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); close(); }
    }
  }

  return (
    <div className="relative"
      // 포커스가 이 상자 밖으로 나가면 닫음 (후보 클릭은 포커스를 옮기지 않음)
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      {picked && !open ? (
        <div className="relative">
          <button type="button" ref={pickedRef} className="input flex items-center pr-11 text-left" aria-haspopup="listbox" onClick={() => setOpen(true)}>
            <span className="min-w-0 truncate">
              <b className="font-semibold">{picked.name}</b>
              <span className="ml-1.5 text-fg-subtle">{picked.position ?? ""}{picked.position ? " · " : ""}{picked.role === "MANAGER" ? "PM" : "팀원 → PM 권한 부여"}</span>
            </span>
          </button>
          <button type="button" aria-label="선택 해제" onClick={() => onChange("")}
            className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg">
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle"><Icon name="search" /></span>
          <input className="input pl-9" placeholder={placeholder ?? "이름·아이디 검색"} value={q} autoFocus={open}
            role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label={placeholder ?? "이름·아이디 검색"}
            aria-activedescendant={open && list[cur] ? optionId(cur) : undefined}
            onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
            onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }} />
        </div>
      )}
      {open && (
        <ul id={listId} role="listbox" aria-label="후보" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
          onMouseDown={(e) => e.preventDefault()}>
          {list.length === 0 && <li role="option" aria-selected={false} aria-disabled className="px-3 py-2.5 text-sm text-fg-subtle">검색 결과 없음</li>}
          {list.map((u, i) => (
            <li key={u.id} id={optionId(i)} role="option" aria-selected={i === cur}
              className={`flex min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${i === cur ? "bg-surface-muted" : "hover:bg-surface-muted"}`}
              onMouseEnter={() => setActive(i)} onClick={() => choose(u)}>
              <span className="min-w-0 truncate"><span className="font-medium">{u.name}</span> <span className="text-fg-subtle">{u.position ?? ""}</span></span>
              <span className={`badge ${u.role === "MANAGER" ? "badge-primary" : "badge-neutral"}`}>{u.role === "MANAGER" ? "PM" : "팀원"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
