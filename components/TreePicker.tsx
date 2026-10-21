"use client";
// 트리에서 하나 고르기 — 버튼을 누르면 검색 + 단계별 목록이 열린다 (PC 팝오버 / 모바일 하단 시트).
// - 검색하면 일치하는 항목을 경로와 함께 평평한 목록으로 (깊은 조직도 한 번에)
// - 검색하지 않으면 한 단계씩: 이름을 누르면 선택, 오른쪽 [하위 n ›]을 누르면 그 안으로 (잘못 눌러 닫히지 않게 두 동작을 나눔)
// - 키보드: ↑↓ 이동 · Enter 선택 · → 하위로 · ← 상위로 (검색 칸에서 바로)
// 팝오버는 body에 그려 카드·시트의 스크롤 영역에 잘리지 않게 한다
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NodeIcon, type TreeIcon, type TreeNode } from "./Tree";
import { Sheet } from "./Sheet";
import { Icon } from "./icons";

const MAX_RESULTS = 60;

function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-amber-100 px-0.5 text-inherit">{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
}

export function TreePicker({ nodes, value, onPick, label, title, placeholder = "검색", hint, icon, side, disabled, className = "" }: {
  nodes: TreeNode[]; value: string | null; onPick: (id: string) => void;
  /** 버튼에 보이는 글자 */
  label: string;
  /** 접근성 이름·모바일 시트 제목 */
  title: string;
  placeholder?: string;
  hint?: string;
  icon?: TreeIcon;
  /** 버튼 오른쪽 작은 글자 (예: 15개) */
  side?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 부모 → 자식, id → 노드 (부모가 목록에 없으면 최상위)
  const { byId, kids } = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const kids = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      const p = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      kids.set(p, [...(kids.get(p) ?? []), n]);
    }
    return { byId, kids };
  }, [nodes]);
  const parentOf = (id: string) => { const p = byId.get(id)?.parentId; return p && byId.has(p) ? p : null; };
  const pathOf = (id: string | null) => {
    const out: TreeNode[] = [];
    let cur = id;
    while (cur) { const n = byId.get(cur); if (!n) break; out.unshift(n); cur = parentOf(cur); }
    return out;
  };

  const query = q.trim().toLowerCase();
  const rows: TreeNode[] = useMemo(() => {
    if (!query) return kids.get(level) ?? [];
    return nodes.filter((n) => n.label.toLowerCase().includes(query)).slice(0, MAX_RESULTS);
  }, [query, level, kids, nodes]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  function show() {
    // 고른 항목이 있는 단계에서 연다
    const lv = value && byId.has(value) ? parentOf(value) : null;
    setLevel(lv);
    setQ("");
    const list = kids.get(lv) ?? [];
    setActive(Math.max(0, list.findIndex((n) => n.id === value)));
    setOpen(true);
  }

  // 팝오버 위치: 버튼 아래(공간이 모자라면 위), 화면 밖으로 나가지 않게
  useLayoutEffect(() => {
    if (!open || mobile) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const width = Math.min(400, window.innerWidth - 32);
      // 버튼 왼쪽에 맞추되, 오른쪽이 넘치면 버튼 오른쪽에 맞춘다
      const left = Math.max(16, b.left + width > window.innerWidth - 16 ? b.right - width : b.left);
      const below = window.innerHeight - b.bottom;
      setPos(below >= 380 || below >= b.top ? { left, top: b.bottom + 8, width } : { left, bottom: window.innerHeight - b.top + 8, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, mobile]);

  useEffect(() => {
    if (!open || mobile) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, mobile]);

  // 움직인 줄이 보이게
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, rows, open, pos]);

  function pick(n: TreeNode) {
    if (n.disabled) return;
    setOpen(false);
    setQ("");
    if (!mobile) btnRef.current?.focus();
    onPick(n.id);
  }
  function enter(id: string | null, focusId?: string) {
    setQ("");
    setLevel(id);
    const list = kids.get(id) ?? [];
    setActive(Math.max(0, focusId ? list.findIndex((n) => n.id === focusId) : 0));
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = rows[active];
    if (e.key === "ArrowDown") setActive((i) => Math.min(rows.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Enter" && n) pick(n);
    else if (e.key === "ArrowRight" && !query && n && kids.get(n.id)?.length) enter(n.id);
    else if (e.key === "ArrowLeft" && !query && level) enter(parentOf(level), level);
    else if (e.key === "Escape" && !mobile) { setOpen(false); btnRef.current?.focus(); }
    else return;
    e.preventDefault();
  }

  const crumbs = pathOf(level);
  const panel = (
    <>
      <div className="relative">
        <Icon name="find" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <input autoFocus={!mobile} className="input pl-9" placeholder={placeholder} aria-label={placeholder} value={q} onKeyDown={onKey}
          role="combobox" aria-expanded aria-controls="tree-picker-list" aria-activedescendant={rows[active] ? `tp-${rows[active].id}` : undefined}
          onChange={(e) => { setQ(e.target.value); setActive(0); }} />
      </div>

      {/* 지금 단계 (검색 중에는 '검색 결과') */}
      <div className="flex min-h-10 items-center gap-0.5 overflow-x-auto px-1 text-sm sm:min-h-9">
        {query ? <span className="text-xs font-medium text-fg-muted">검색 결과 {rows.length}{rows.length === MAX_RESULTS ? "+" : ""}개</span> : (
          <>
            {level && (
              <button type="button" className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg sm:size-7"
                aria-label="상위로" onClick={() => enter(parentOf(level), level)}>
                <Icon name="prev" className="size-4" />
              </button>
            )}
            <button type="button" className={`shrink-0 rounded-md px-1.5 py-1 hover:bg-surface-muted ${level ? "text-fg-muted" : "font-semibold"}`} onClick={() => enter(null, crumbs[0]?.id)}>처음</button>
            {crumbs.map((c, i) => (
              <span key={c.id} className="flex shrink-0 items-center">
                <span className="text-fg-subtle" aria-hidden>›</span>
                <button type="button" className={`rounded-md px-1.5 py-1 hover:bg-surface-muted ${i === crumbs.length - 1 ? "font-semibold" : "text-fg-muted"}`}
                  onClick={() => enter(c.id, crumbs[i + 1]?.id)}>{c.label}</button>
              </span>
            ))}
          </>
        )}
      </div>

      <ul ref={listRef} id="tree-picker-list" role="listbox" aria-label={title} className="max-h-[55dvh] overflow-y-auto border-t border-line pt-1 sm:max-h-80">
        {rows.length === 0 && <li className="px-2 py-6 text-center text-sm text-fg-subtle">{query ? "검색 결과가 없습니다." : "항목이 없습니다."}</li>}
        {rows.map((n, i) => {
          const sub = kids.get(n.id)?.length ?? 0;
          const selected = n.id === value;
          const path = query ? pathOf(parentOf(n.id)).map((p) => p.label).join(" › ") : "";
          return (
            <li key={n.id} id={`tp-${n.id}`} role="option" aria-selected={selected} data-row={i}
              className={`flex items-stretch gap-1 rounded-lg ${i === active ? "bg-surface-muted" : ""} ${selected ? "bg-brand-50" : ""}`}
              onMouseEnter={() => setActive(i)}>
              <button type="button" tabIndex={-1} disabled={n.disabled} onClick={() => pick(n)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:cursor-default sm:min-h-9">
                {n.icon && <NodeIcon icon={n.icon} className={n.muted ? "opacity-50" : ""} />}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${selected ? "font-semibold text-primary" : n.muted || n.disabled ? "text-fg-muted" : "text-fg"} ${n.strike ? "line-through" : ""}`}>
                    <Highlight text={n.label} query={query} />
                    {n.tag && <span className="ml-1.5 rounded-md border border-line px-1.5 text-xs font-medium text-fg-muted">{n.tag}</span>}
                  </span>
                  {path && <span className="block truncate text-xs text-fg-muted">{path}</span>}
                </span>
                {n.count != null && <span className="tabular shrink-0 text-xs text-fg-muted">{n.count}</span>}
                {selected && <Icon name="check" className="size-4 shrink-0 text-primary" />}
              </button>
              {sub > 0 && (
                <button type="button" tabIndex={-1} onClick={() => enter(n.id)} aria-label={`${n.label} 하위 ${sub}개 보기`}
                  className="flex shrink-0 items-center gap-0.5 rounded-lg px-2.5 text-xs font-medium text-fg-muted hover:bg-surface hover:text-primary">
                  하위 {sub}<Icon name="chevron" className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {(hint || !mobile) && (
        <p className="hidden border-t border-line px-2 pt-2 text-xs text-fg-muted sm:block">
          {hint ? `${hint} · ` : ""}이름을 눌러 선택 · 하위 ›로 들어가기
        </p>
      )}
    </>
  );

  return (
    <>
      <button ref={btnRef} type="button" disabled={disabled} onClick={() => (open ? setOpen(false) : show())} aria-haspopup="listbox" aria-expanded={open} aria-label={`${title}: ${label}`}
        className={`flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition sm:min-h-9 disabled:cursor-not-allowed disabled:opacity-60 ${
          open ? "border-primary bg-brand-50" : "border-line bg-surface hover:border-line-strong"} ${className}`}>
        {icon && <NodeIcon icon={icon} />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {side && <span className="tabular shrink-0 text-xs text-fg-muted">{side}</span>}
        <Icon name="chevronDown" className={`size-3.5 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !mobile && pos && createPortal(
        <div ref={popRef} role="dialog" aria-label={title} style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
          className="z-[70] rounded-2xl border border-line bg-surface p-2 shadow-pop">{panel}</div>,
        document.body,
      )}
      {open && mobile && <Sheet title={title} onClose={() => setOpen(false)}>{panel}</Sheet>}
    </>
  );
}
