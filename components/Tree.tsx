"use client";

// 공통 트리 UI — 조직도·프로젝트 체계도·프로젝트 선택 등에서 같은 모양으로 사용
// 회전 화살표, 은은한 세로 가이드선, 선택 강조선, 노드 아이콘, 숫자 배지, 검색 강조, 키보드 탐색(↑↓←→ Enter)
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";

export type TreeIcon = "company" | "org" | "group" | "project" | "subproject" | "person";

export type TreeNode = {
  id: string;
  parentId: string | null;
  label: string;
  icon?: TreeIcon;
  /** 오른쪽 숫자 배지 */
  count?: number | null;
  /** 이름 옆 작은 꼬리표 (예: 묶음, 미사용) */
  tag?: string | null;
  /** 흐리게 (묶음·미사용 조직 등) */
  muted?: boolean;
  /** 취소선 (사용중지) */
  strike?: boolean;
  /** 선택 불가 (구분용 노드) */
  disabled?: boolean;
};

const ICON_PATH: Record<TreeIcon, string> = {
  company: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1",
  org: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  group: "M4 6h16M4 12h16M4 18h10",
  project: "M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z",
  subproject: "M9 5h11v6H9zM4 4v12h5",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
};
const ICON_TONE: Record<TreeIcon, string> = {
  company: "text-primary",
  org: "text-fg-3",
  group: "text-fg-subtle",
  project: "text-brand-500",
  subproject: "text-brand-300",
  person: "text-fg-subtle",
};

export function NodeIcon({ icon, className = "" }: { icon: TreeIcon; className?: string }) {
  return (
    <Icon d={ICON_PATH[icon]} box={24} sw={1.8} className={`size-4 shrink-0 ${ICON_TONE[icon]} ${className}`} />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <Icon name="chevron" join className={`size-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
  );
}

/** 검색어 강조 */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-100 px-0.5 text-inherit">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

type Props = {
  nodes: TreeNode[];
  selectedId?: string | null;
  onSelect?: (node: TreeNode) => void;
  /** 처음 펼칠 깊이 (기본 2단계) */
  defaultDepth?: number;
  /** 검색어 — 일치 노드와 그 상위만 표시하고 모두 펼침 */
  query?: string;
  /** 전체 펼치기/접기 버튼 */
  toolbar?: boolean;
  className?: string;
  empty?: string;
};

export function TreeView({ nodes, selectedId, onSelect, defaultDepth = 2, query = "", toolbar = true, className = "", empty = "항목이 없습니다." }: Props) {
  const byParent = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const m = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
      m.set(key, [...(m.get(key) ?? []), n]);
    }
    return m;
  }, [nodes]);
  const depthOf = useMemo(() => {
    const d = new Map<string, number>();
    const walk = (pid: string | null, depth: number) => (byParent.get(pid) ?? []).forEach((n) => { d.set(n.id, depth); walk(n.id, depth + 1); });
    walk(null, 0);
    return d;
  }, [byParent]);

  const [open, setOpen] = useState<Set<string>>(() => new Set(nodes.filter((n) => (depthOf.get(n.id) ?? 0) < defaultDepth).map((n) => n.id)));
  // 선택된 노드의 상위는 항상 펼침
  useEffect(() => {
    if (!selectedId) return;
    const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
    setOpen((s) => {
      const next = new Set(s);
      let cur = parentOf.get(selectedId) ?? null;
      while (cur) { next.add(cur); cur = parentOf.get(cur) ?? null; }
      return next.size === s.size ? s : next;
    });
  }, [selectedId, nodes]);

  // 검색: 일치 노드 + 상위 경로
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return null;
    const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
    const keep = new Set<string>();
    for (const n of nodes) {
      if (!n.label.toLowerCase().includes(q)) continue;
      let cur: string | null = n.id;
      while (cur && !keep.has(cur)) { keep.add(cur); cur = parentOf.get(cur) ?? null; }
    }
    return keep;
  }, [q, nodes]);

  const isOpen = (id: string) => (visible ? true : open.has(id));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // 키보드 탐색용 평면 목록
  const flat: TreeNode[] = [];
  const collect = (pid: string | null) => (byParent.get(pid) ?? []).forEach((n) => {
    if (visible && !visible.has(n.id)) return;
    flat.push(n);
    if (isOpen(n.id)) collect(n.id);
  });
  collect(null);
  const [focus, setFocus] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  function onKey(e: React.KeyboardEvent) {
    const cur = focus ?? selectedId ?? flat[0]?.id;
    const i = flat.findIndex((n) => n.id === cur);
    const node = flat[i];
    if (!node) return;
    const kids = byParent.get(node.id) ?? [];
    if (e.key === "ArrowDown") setFocus(flat[Math.min(flat.length - 1, i + 1)]?.id ?? cur);
    else if (e.key === "ArrowUp") setFocus(flat[Math.max(0, i - 1)]?.id ?? cur);
    else if (e.key === "ArrowRight" && kids.length && !isOpen(node.id)) toggle(node.id);
    else if (e.key === "ArrowLeft" && isOpen(node.id) && kids.length) toggle(node.id);
    else if (e.key === "ArrowLeft" && node.parentId) setFocus(node.parentId);
    else if (e.key === "Enter" && !node.disabled) onSelect?.(node);
    else return;
    e.preventDefault();
  }
  useEffect(() => {
    if (!focus) return;
    listRef.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const Branch = ({ pid, depth }: { pid: string | null; depth: number }) => {
    const list = (byParent.get(pid) ?? []).filter((n) => !visible || visible.has(n.id));
    if (!list.length) return null;
    return (
      <ul role={depth ? "group" : "tree"} className={depth ? "relative ml-[11px] border-l border-line/80 pl-2" : ""}>
        {list.map((n) => {
          const kids = (byParent.get(n.id) ?? []).length > 0;
          const opened = isOpen(n.id);
          const selected = n.id === selectedId;
          const focused = n.id === focus;
          return (
            <li key={n.id} role="treeitem" aria-expanded={kids ? opened : undefined} aria-selected={selected}>
              <div data-node={n.id}
                className={`group relative flex h-10 items-center sm:h-8 gap-1 rounded-lg pr-1.5 transition-colors ${
                  selected ? "bg-brand-50 text-primary" : "hover:bg-surface-muted"
                } ${focused && !selected ? "ring-1 ring-brand-300" : ""}`}>
                {selected && <span className="absolute -left-[3px] top-2 bottom-2 w-[3px] rounded-full bg-primary sm:top-1.5 sm:bottom-1.5" aria-hidden />}
                <button type="button" tabIndex={-1} aria-label={opened ? "접기" : "펼치기"}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md sm:size-6 text-fg-subtle hover:bg-surface hover:text-fg ${kids ? "" : "invisible"}`}
                  onClick={() => toggle(n.id)}>
                  <Chevron open={opened} />
                </button>
                <button type="button" tabIndex={-1} disabled={n.disabled}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-sm disabled:cursor-default sm:text-label"
                  onClick={() => { setFocus(n.id); if (!n.disabled) onSelect?.(n); else if (kids) toggle(n.id); }}>
                  {n.icon && <NodeIcon icon={n.icon} className={n.muted ? "opacity-50" : ""} />}
                  <span className={`truncate ${selected ? "font-semibold" : n.muted ? "text-fg-muted" : "text-fg"} ${n.strike ? "line-through opacity-60" : ""}`}>
                    <Highlight text={n.label} query={q} />
                  </span>
                  {n.tag && <span className="shrink-0 rounded-md border border-line px-1.5 text-xs font-medium leading-4 text-fg-muted">{n.tag}</span>}
                </button>
                {n.count != null && (
                  <span className={`tabular shrink-0 rounded-full px-1.5 text-xs font-semibold leading-5 ${
                    selected ? "bg-primary text-on-primary" : n.count ? "bg-surface-muted text-fg-muted" : "text-fg-subtle/70"
                  }`}>{n.count}</span>
                )}
              </div>
              {kids && opened && <Branch pid={n.id} depth={depth + 1} />}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className={className}>
      {toolbar && nodes.length > 0 && (
        <div className="mb-1 flex justify-end gap-1 text-label">
          <button type="button" className="rounded-md px-2 py-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg sm:px-1.5 sm:py-0.5"
            onClick={() => setOpen(new Set(nodes.map((n) => n.id)))}>모두 펼치기</button>
          <button type="button" className="rounded-md px-2 py-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg sm:px-1.5 sm:py-0.5"
            onClick={() => setOpen(new Set())}>모두 접기</button>
        </div>
      )}
      <div ref={listRef} tabIndex={0} onKeyDown={onKey} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-100">
        {nodes.length === 0 ? <p className="px-2 py-6 text-center text-sm text-fg-subtle">{empty}</p>
          : visible && visible.size === 0 ? <p className="px-2 py-6 text-center text-sm text-fg-subtle">검색 결과가 없습니다.</p>
          : <Branch pid={null} depth={0} />}
      </div>
    </div>
  );
}

/** 표·카드 목록용 들여쓰기 가이드 (세로선 + 꺾임) */
export function TreeGuide({ depth, last }: { depth: number; last?: boolean }) {
  if (!depth) return null;
  return (
    <span className="flex shrink-0 self-stretch" aria-hidden>
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="relative w-5">
          {i < depth - 1 ? (
            <span className="absolute inset-y-0 left-2 border-l border-line" />
          ) : (
            <>
              <span className={`absolute left-2 top-0 border-l border-line ${last ? "h-1/2" : "h-full"}`} />
              <span className="absolute left-2 top-1/2 w-2.5 border-t border-line" />
            </>
          )}
        </span>
      ))}
    </span>
  );
}
