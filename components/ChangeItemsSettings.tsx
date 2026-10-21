"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useRun } from "./hooks/useRun";
import { SaveBar } from "./SaveBar";
import { chip } from "./ui";

type Item = { id: string; name: string; categoryName: string };
type Change = { id: string; seq: number; title: string; period: string; managerName: string | null; itemIds: string[] };

/**
 * PM 설정 — 변경계약 과업 담당 PM의 입력 항목 (팀원 입력 항목과 별도).
 * 담당 PM이 이 항목으로 입력하면 그 과업 지출로 자동 구분되고, 메인 PM은 함께 본다.
 */
export function ChangeItemsSettings({ changes, items, memberItemIds }: { changes: Change[]; items: Item[]; memberItemIds: string[] }) {
  return (
    <div className="card overflow-clip">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-base font-bold">변경계약 과업 지출 항목</h2>
        <p className="mt-1 text-sm text-fg-muted">
          과업 담당 PM이 입력할 항목을 고르세요. 이 항목으로 입력한 지출은 그 과업으로 구분됩니다.
        </p>
      </div>
      <div className="divide-y divide-line border-t border-line">
        {changes.map((c) => <ChangeItems key={c.id} change={c} items={items} memberItemIds={memberItemIds} />)}
      </div>
    </div>
  );
}

function ChangeItems({ change, items, memberItemIds }: { change: Change; items: Item[]; memberItemIds: string[] }) {
  const [sel, setSel] = useState(() => new Set(change.itemIds));
  const { act, busy, view } = useRun({ ok: "text-emerald-700", error: "text-rose-700" });
  const dirty = sel.size !== change.itemIds.length || change.itemIds.some((i) => !sel.has(i));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section>
      <div className="px-5 pt-4 pb-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="badge badge-primary">변경 {change.seq}차</span>
        <span className="font-bold">{change.title}</span>
        <span className="text-xs text-fg-muted">{change.period} · 담당 PM <b className="text-fg">{change.managerName ?? "미지정"}</b></span>
      </div>
      {!change.managerName && <p className="mt-1 text-xs text-amber-700">담당 PM이 지정되지 않았습니다. 재무 승인 담당에게 지정을 요청하세요.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((it) => {
          const on = sel.has(it.id);
          return (
            <button key={it.id} type="button" onClick={() => toggle(it.id)}
              aria-pressed={on} className={chip(on)}>
              {it.name}
              {memberItemIds.includes(it.id) && <span className={`ml-1 text-xs ${on ? "text-on-primary/80" : "text-fg-muted"}`}>팀원 공통</span>}
            </button>
          );
        })}
      </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} status={view} onReset={() => setSel(new Set(change.itemIds))}
        onSave={() => act(() => api(`/api/changes/${change.id}/items`, { method: "PUT", json: { itemIds: [...sel] } }), "저장했습니다.")}
        note={`${sel.size}개 항목`} />
    </section>
  );
}
