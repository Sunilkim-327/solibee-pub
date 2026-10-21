"use client";

import { useRef, useState } from "react";
import { displayNameProblem, isCodeHeader, isNoiseExtraLabel, newDisplayKey, type DisplayItem } from "@/lib/pass-statement";
import { RowMenu, type MenuAction } from "./RowMenu";

// ── 표시 열 목록 고치기 (순수 동작) — PM 설정의 비교 표와 업로드 양식 설정이 같이 쓴다 ──

const visibleOf = (items: DisplayItem[]) => items.filter((i) => !i.hidden);
const hiddenOf = (items: DisplayItem[]) => items.filter((i) => i.hidden);

/** 보이는 항목끼리 자리 바꾸기 (숨긴 항목은 뒤에 그대로) */
export function moveItem(items: DisplayItem[], key: string, dir: -1 | 1): DisplayItem[] {
  const list = [...visibleOf(items)];
  const i = list.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return items;
  [list[i], list[j]] = [list[j], list[i]];
  return [...list, ...hiddenOf(items)];
}
export const renameItem = (items: DisplayItem[], key: string, name: string) => items.map((x) => (x.key === key ? { ...x, name } : x));
/** 삭제 = 숨김 (기존 줄의 값은 데이터로 남고 화면·엑셀에서만 숨김) */
export const hideItem = (items: DisplayItem[], key: string) => items.map((x) => (x.key === key ? { ...x, hidden: true } : x));
export function addItem(items: DisplayItem[], name: string): DisplayItem[] {
  const n = name.trim();
  return [...visibleOf(items), { key: newDisplayKey(n, items), name: n }, ...hiddenOf(items)];
}

/** 보이는 항목 이름이 비었거나 겹치면 문제 문구 */
export function displayItemsProblem(items: DisplayItem[]): string | null {
  const visible = visibleOf(items).map((i) => i.name.trim());
  if (visible.some((n) => !n)) return "표시 열 이름을 입력하세요.";
  if (new Set(visible).size !== visible.length) return "표시 열 이름이 겹칩니다.";
  return null;
}

/** 항목 한 줄의 ⋯ 메뉴 동작 */
export function itemActions(items: DisplayItem[], key: string, on: { rename: () => void; change: (next: DisplayItem[]) => void; allowDelete: boolean }): MenuAction[] {
  const visible = visibleOf(items);
  const i = visible.findIndex((x) => x.key === key);
  return [
    { label: "이름 바꾸기", onSelect: on.rename },
    { label: "위로", onSelect: () => on.change(moveItem(items, key, -1)), disabled: i <= 0 },
    { label: "아래로", onSelect: () => on.change(moveItem(items, key, 1)), disabled: i < 0 || i >= visible.length - 1 },
    ...(on.allowDelete ? [{ label: "숨기기(삭제)", onSelect: () => on.change(hideItem(items, key)), danger: true }] : []),
  ];
}

/** 이름 바꾸기 입력 (Enter 저장·Esc 취소, 겹치면 거부하고 글자를 선택해 둠) */
export function RenameInput({ items, itemKey, onDone }: { items: DisplayItem[]; itemKey: string; onDone: (name: string | null) => void }) {
  const cur = items.find((i) => i.key === itemKey);
  const [value, setValue] = useState(cur?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    const p = displayNameProblem(value, items, itemKey);
    if (p) { setError(p); ref.current?.select(); return; }
    onDone(value.trim());
  };
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <input ref={ref} autoFocus className="input min-w-0 flex-1 py-1 sm:text-sm" value={value} maxLength={40} aria-label="표시 열 이름"
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") onDone(null); }} />
      <button type="button" className="btn-secondary btn-sm" onClick={commit}>확인</button>
      <button type="button" className="btn-ghost btn-sm" onClick={() => onDone(null)}>취소</button>
      {error && <span className="w-full text-xs text-status-rejected" role="alert">{error}</span>}
    </span>
  );
}

/** [+ 표시 열] — 누르면 한 줄 입력 */
export function AddItemRow({ items, onAdd }: { items: DisplayItem[]; onAdd: (next: DisplayItem[]) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    const p = displayNameProblem(value, items);
    // 거부: 글자는 남기고 전체 선택 — 이어서 입력하면 새 글자로 바뀐다
    if (p) { setError(p); ref.current?.select(); return; }
    onAdd(addItem(items, value));
    setValue("");
    setError(null);
    setOpen(false);
  };
  if (!open) return <button type="button" className="btn-ghost btn-sm text-primary" onClick={() => setOpen(true)}>+ 표시 열</button>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input ref={ref} autoFocus className="input w-44 py-1 sm:text-sm" value={value} maxLength={40} placeholder="예: 상품명" aria-label="추가할 표시 열 이름"
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setOpen(false); }} />
      <button type="button" className="btn-secondary btn-sm" disabled={!value.trim()} onClick={commit}>추가</button>
      <button type="button" className="btn-ghost btn-sm" onClick={() => { setOpen(false); setValue(""); setError(null); }}>취소</button>
      {error && <span className="w-full text-xs text-status-rejected" role="alert">{error}</span>}
    </span>
  );
}

/**
 * 표시 열 목록 (한 줄씩 '번호 · 이름', 끝에 ⋯ 메뉴) — 업로드 양식 설정 화면에서 쓴다.
 * 삭제는 숨김으로 남긴다. 키는 바꾸지 않는다.
 */
export function DisplayItemsEditor({ items, onChange, canEdit, allowDelete = true }: {
  items: DisplayItem[]; onChange: (items: DisplayItem[]) => void; canEdit: boolean;
  /** 숨기기(삭제) 메뉴 (양식 설정 화면에서는 추가·순서·이름만) */
  allowDelete?: boolean;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const visible = visibleOf(items);
  return (
    <div className="space-y-1">
      {visible.length === 0 ? (
        <p className="text-sm text-fg-muted">표시 열이 없습니다.</p>
      ) : (
        <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
          {visible.map((it, i) => (
            <li key={it.key} className="flex min-h-11 items-center gap-2 px-3 sm:min-h-9">
              <span className="tabular w-5 shrink-0 text-xs text-fg-subtle">{i + 1}</span>
              {renaming === it.key ? (
                <RenameInput items={items} itemKey={it.key} onDone={(name) => { if (name !== null) onChange(renameItem(items, it.key, name)); setRenaming(null); }} />
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
                  {isNoiseExtraLabel(it.name) ? (
                    <span className="shrink-0 text-xs text-fg-subtle" title="금액·수량·시간·날짜 열은 내역 줄에 따로 보이므로 표시 열로는 숨겨요 (엑셀에는 나옴). 수량이 2 이상이면 품목 뒤에 '× 2'로 붙어요">내역 줄에는 숨김</span>
                  ) : isCodeHeader(it.name) ? (
                    <span className="shrink-0 text-xs text-amber-700" title={allowDelete ? "코드 값만 있는 열이에요. 내역 줄에는 보이지 않으니 ⋯ › 숨기기(삭제)로 정리하세요" : "코드 값만 있는 열이에요. 내역 줄에는 보이지 않으니 표시 열 설정에서 숨기세요"}>코드 열</span>
                  ) : null}
                  {canEdit && <RowMenu label={`${it.name} 메뉴`} actions={itemActions(items, it.key, { rename: () => setRenaming(it.key), change: onChange, allowDelete })} />}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {canEdit && <AddItemRow items={items} onAdd={onChange} />}
    </div>
  );
}
