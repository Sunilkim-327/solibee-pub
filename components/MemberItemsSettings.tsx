"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useRun } from "./hooks/useRun";
import { SaveBar } from "./SaveBar";

export type MemberItemOption = { id: string; name: string; categoryName: string; planned: number; /** 예) 출장_KTX 묶음 예산 */ note?: string };
type Item = MemberItemOption;
type Unbudgeted = { id: string; name: string; categoryName: string };

/** 팀원 입력 항목 — 분류별로 묶어 고른다 (재무 승인이 등록한 예산에 있는 항목만, 예산 없는 항목은 흐리게 안내) */
export function MemberItemsSettings({ projectId, items, initial, unbudgeted = [], categoryOrder = [] }: {
  projectId: string; items: Item[]; initial: string[];
  /** 예산(단가)이 없어 고를 수 없는 항목 — 안내용 */
  unbudgeted?: Unbudgeted[];
  /** 분류 표시 순서 (분류명) */
  categoryOrder?: string[];
}) {
  const [selected, setSelected] = useState(() => new Set(initial));
  const { act, busy, view } = useRun({ ok: "text-emerald-700", error: "text-rose-600" });
  const dirty = selected.size !== initial.length || initial.some((id) => !selected.has(id));
  // 예산 없는 항목(고를 수 없음)은 접어 두고 필요할 때만 펼친다
  const [showOff, setShowOff] = useState(false);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** 분류 전체 선택/해제 */
  const toggleGroup = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) if (on) next.add(id); else next.delete(id);
      return next;
    });

  // 분류별 묶음 (분류 순서 → 처음 나온 순서)
  const names = [...new Set([...categoryOrder, ...items.map((i) => i.categoryName), ...unbudgeted.map((i) => i.categoryName)])];
  const groups = names
    .map((name) => ({ name, items: items.filter((i) => i.categoryName === name), off: showOff ? unbudgeted.filter((i) => i.categoryName === name) : [] }))
    .filter((g) => g.items.length || g.off.length);

  const save = () => act(
    () => api(`/api/projects/${projectId}/member-items`, { method: "PUT", json: { itemIds: [...selected] } }),
    "저장되었습니다. 팀원 입력 화면에 바로 반영됩니다.",
  );

  if (items.length === 0) {
    return (
      <div className="card overflow-clip">
      <div className="card-head flex-col items-start gap-1">
        <h2 className="section-title">팀원 지출 항목</h2>
        <p className="text-sm text-fg-muted">팀원이 지출을 입력할 때 고를 수 있는 항목을 정해요. 선택하지 않은 항목은 PM만 입력할 수 있어요.</p>
      </div>
      <p className="px-5 py-8 text-center text-sm text-fg-muted">
        예산에 등록된 항목이 없어요. 재무 승인 담당이 예산을 등록하면 고를 수 있어요.
      </p>
      </div>
    );
  }

  return (
    <div className="card overflow-clip">
      <div className="card-head flex-col items-start gap-1">
        <h2 className="section-title">팀원 지출 항목</h2>
        <p className="text-sm text-fg-muted">팀원이 지출을 입력할 때 고를 수 있는 항목을 정해요. 선택하지 않은 항목은 PM만 입력할 수 있어요.</p>
      </div>
      {groups.map((g) => {
        const ids = g.items.map((i) => i.id);
        const on = ids.filter((id) => selected.has(id)).length;
        const all = ids.length > 0 && on === ids.length;
        return (
          <section key={g.name} className="border-b border-line last:border-b-0">
            <header className="flex min-h-10 items-center gap-2 bg-surface-muted/60 px-4 py-1.5">
              <h3 className="text-sm font-bold">{g.name}</h3>
              <span className="text-xs text-fg-muted">{on}/{ids.length} 선택</span>
              {ids.length > 0 && (
                <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => toggleGroup(ids, !all)}>
                  {all ? "전체 해제" : "전체 선택"}
                </button>
              )}
            </header>
            <ul className="divide-y divide-line">
              {/* 묶음 예산 항목은 묶음 이름을 머리줄에 한 번만 (항목마다 배지를 달지 않는다) */}
              {[...new Set(g.items.map((i) => i.note ?? ""))].map((note) => [note, g.items.filter((i) => (i.note ?? "") === note)] as const).map(([note, list]) => (
                <li key={note || "_"}>
                  {note && <p className="bg-surface-muted/40 px-4 pt-2 pb-1 text-xs font-medium text-brand-700">{note}</p>}
                  <ul className="divide-y divide-line">
                    {list.map((it) => (
                      <li key={it.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-muted/50">
                          <input type="checkbox" className="size-4" checked={selected.has(it.id)} onChange={() => toggle(it.id)} />
                          <span className="flex-1 text-base font-medium sm:text-sm">{it.name}</span>
                          {selected.has(it.id) && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">팀원 입력 가능</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {/* 예산(단가)이 없는 항목: 고를 수 없음 — 왜 안 되는지 보이도록 */}
              {g.off.map((it) => (
                <li key={it.id} className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-fg-muted">
                  <input type="checkbox" className="size-4" disabled aria-label={`${it.name} (예산 없음)`} />
                  <span className="flex-1 font-medium">{it.name}</span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">예산 없음</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {unbudgeted.length > 0 && (
        <div className="border-t border-line px-4 py-2">
          <button type="button" className="btn-ghost btn-sm -ml-2" aria-expanded={showOff} onClick={() => setShowOff((v) => !v)}>
            <span aria-hidden>{showOff ? "▾" : "▸"}</span> 예산 없는 항목 {unbudgeted.length}개 {showOff ? "접기" : "보기"}
          </button>
          {showOff && (
            <p className="pb-1 text-xs text-amber-900">
              재무 승인 담당이 프로젝트 운영비에서 단가·기간을 정하면 고를 수 있어요.
            </p>
          )}
        </div>
      )}
      <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setSelected(new Set(initial))}
        status={view} note={`팀원 입력 가능 항목 ${selected.size}개`} />
    </div>
  );
}
