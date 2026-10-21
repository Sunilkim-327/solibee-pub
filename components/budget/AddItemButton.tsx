"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useRun, type RunColors } from "../hooks/useRun";
import type { BudgetItem, CategoryRef, Template } from "./types";
import { MoneyInput, periodsOf } from "./ui";

const COLORS: RunColors = { ok: "text-emerald-700", error: "text-rose-600", size: "text-xs" };
type Draft = { categoryId: string; pick: string; name: string; price: number; periods: number };

/**
 * 항목 추가 — 위쪽 버튼(분류 선택) 또는 분류 카드 맨 아래 줄(그 분류로 고정, inline)
 * 공통 항목에서 가져오거나 새 항목을 만들고, 단가·기간은 자동 저장으로 반영
 */
export function AddItemButton({ projectId, categories, items, templates, months, onAdded, onCategory, fixedCategory }: {
  projectId: string; categories: CategoryRef[]; onCategory?: (c: CategoryRef) => void; items: BudgetItem[]; templates: Template[]; months: number;
  onAdded: (item: BudgetItem, price: number, periods: number) => void;
  /** 분류 카드 안의 추가 줄 — 이 분류로 고정 */
  fixedCategory?: CategoryRef;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Draft>({ categoryId: fixedCategory?.id ?? categories[0]?.id ?? "", pick: "", name: "", price: 0, periods: months });
  const { act, busy, view, setMsg } = useRun(COLORS);
  // 분류는 회사 공통 — 여기서 새로 만들면 분류·항목 관리에도 바로 생긴다
  const [cats, setCats] = useState(categories);
  const [newCat, setNewCat] = useState<string | null>(null);
  // 팝업은 Esc로 닫는다 (새 분류 입력 중이면 그 입력만 취소)
  useEffect(() => {
    if (!open || fixedCategory) return;
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape" || e.defaultPrevented) return; if (newCat !== null) setNewCat(null); else setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, fixedCategory, newCat]);

  async function createCategory() {
    if (busy || !newCat?.trim()) return;
    await act(async () => {
      const c = await api<CategoryRef>("/api/master/categories", { method: "POST", json: { name: newCat } });
      setCats((l) => [...l, { id: c.id, name: c.name }]);
      onCategory?.({ id: c.id, name: c.name });
      setV((x) => ({ ...x, categoryId: c.id, pick: "" }));
      setNewCat(null);
    }, undefined, { refresh: false });
  }

  const mine = items.filter((i) => i.categoryId === v.categoryId);
  const avail = templates.filter((t) => t.categoryId === v.categoryId && !mine.some((m) => m.name === t.name || (m.code && m.code === t.code)));
  const picked = avail.find((t) => t.id === v.pick);
  const name = picked ? picked.name : v.name.trim();

  async function submit() {
    if (busy || !name) return;
    const draft = v;
    const limit = picked?.perPersonLimit ?? null;
    await act(async () => {
      // 한도는 만들 때 함께 (따로 PATCH하면 중간에 실패할 때 한도 없는 항목이 남음)
      const created = await api<{ id: string; code: string | null; perPersonLimit: number | null; needsAttendees: boolean }>("/api/master/items", {
        method: "POST", json: { projectId, categoryId: draft.categoryId, name, ...(picked?.code ? { code: picked.code } : {}), ...(limit ? { perPersonLimit: limit } : {}) },
      });
      onAdded({
        id: created.id, name, code: created.code, categoryId: draft.categoryId, perPersonLimit: created.perPersonLimit ?? null,
        hardBudget: false, needsAttendees: created.needsAttendees, active: true,
      }, draft.price, draft.periods || months);
      setV((x) => ({ ...x, pick: "", name: "", price: 0, periods: months }));
      if (!fixedCategory) setOpen(false);
    }, undefined, { refresh: false });
  }

  const submitButton = (
    <button className="btn-primary px-3.5 py-1.5 text-sm" disabled={busy || !name} onClick={submit}>{busy ? "추가 중…" : "추가"}</button>
  );

  if (fixedCategory) {
    if (!open) {
      return (
        <button type="button" onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 border-t border-dashed border-line px-5 py-2.5 text-left text-sm text-fg-muted transition hover:bg-brand-50/40 hover:text-primary">
          <span className="text-base leading-none">+</span> {fixedCategory.name} 항목 추가
        </button>
      );
    }
    return (
      <div className="border-t border-line bg-brand-50/30 px-5 py-3">
        <div className="flex flex-wrap items-end gap-2">
          <ItemFields inline v={v} setV={setV} avail={avail} picked={!!picked} onEnter={() => void submit()} />
          {submitButton}
          <button className="btn-ghost px-2.5 py-1.5 text-sm" onClick={() => { setOpen(false); setMsg(null); }}>닫기</button>
        </div>
        {view && <p className="mt-2">{view}</p>}
      </div>
    );
  }

  return (
    <div className="relative ml-auto">
      <button className="btn-primary" onClick={() => setOpen(!open)} aria-expanded={open}>+ 항목 추가</button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-pop">
          <label className="block text-label font-bold text-fg-muted">분류
            {newCat === null ? (
              <select className="input mt-1" value={v.categoryId}
                onChange={(e) => (e.target.value === "__new" ? setNewCat("") : setV({ ...v, categoryId: e.target.value, pick: "" }))}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new">+ 새 분류 추가 (회사 공통)…</option>
              </select>
            ) : (
              <span className="mt-1 flex gap-1.5">
                <input className="input" placeholder="새 분류 이름 (예: 교육비)" value={newCat} maxLength={30} autoFocus aria-label="새 분류 이름"
                  onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createCategory(); }} />
                <button type="button" className="btn-secondary shrink-0 px-2.5 text-sm" disabled={busy || !newCat.trim()} onClick={createCategory}>만들기</button>
                <button type="button" className="btn-ghost shrink-0 px-2 text-sm" onClick={() => setNewCat(null)}>취소</button>
              </span>
            )}
          </label>
          <ItemFields v={v} setV={setV} avail={avail} picked={!!picked} />
          <p className="text-label text-fg-subtle">기간은 단가를 쓸 수 있는 횟수입니다 — {months}면 매월, 1이면 한 번, 3이면 기간 중 3번.</p>
          {view && <p>{view}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>닫기</button>
            {submitButton}
          </div>
          <p className="text-label text-fg-subtle">항목은 바로 추가되고, 단가·기간은 자동 저장됩니다.</p>
        </div>
      )}
    </div>
  );
}

/** 항목 추가 입력칸 (항목 고르기 · 항목명 · 단가 · 기간) — 분류 카드 줄(inline)과 위쪽 팝업이 함께 쓴다 */
function ItemFields({ inline = false, v, setV, avail, picked, onEnter }: {
  inline?: boolean; v: Draft; setV: (d: Draft) => void; avail: Template[]; picked: boolean;
  /** 항목명에서 Enter */
  onEnter?: () => void;
}) {
  const pickSelect = (
    <select className={inline ? "input mt-1 py-1.5 sm:text-sm" : "input mt-1"} value={v.pick} onChange={(e) => setV({ ...v, pick: e.target.value })}>
      <option value="">새 항목 직접 입력</option>
      {avail.length > 0 && <optgroup label="공통 항목에서 가져오기">{avail.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
    </select>
  );
  const onName = (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, name: e.target.value });
  const onKey = onEnter ? (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") onEnter(); } : undefined;
  const price = <MoneyInput value={v.price} onChange={(n) => setV({ ...v, price: n })} label="단가" className={inline ? "mt-1 block w-32 text-sm" : "mt-1 w-full"} />;
  const periods = (
    <input className={inline ? "input tabular mt-1 block w-20 py-1.5 text-right sm:text-sm" : "input tabular mt-1 w-full text-right"} inputMode="numeric"
      value={v.periods || ""} aria-label="기간(회)" onChange={(e) => setV({ ...v, periods: periodsOf(e.target.value) })} />
  );

  if (inline) {
    return (
      <>
        <label className="block min-w-44 flex-1 text-label font-bold text-fg-muted">항목{pickSelect}</label>
        {!picked && (
          <label className="block min-w-44 flex-1 text-label font-bold text-fg-muted">항목명
            <input className="input mt-1 py-1.5 sm:text-sm" value={v.name} autoFocus onChange={onName} onKeyDown={onKey} />
          </label>
        )}
        <label className="block text-label font-bold text-fg-muted">단가{price}</label>
        <label className="block text-label font-bold text-fg-muted">기간(회){periods}</label>
      </>
    );
  }
  return (
    <>
      <label className="block text-label font-bold text-fg-muted">항목{pickSelect}</label>
      {!picked && <input className="input" placeholder="항목명" value={v.name} aria-label="항목명" autoFocus onChange={onName} onKeyDown={onKey} />}
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
        <label className="block text-label font-bold text-fg-muted">단가 (선택){price}</label>
        <label className="block text-label font-bold text-fg-muted">기간(회){periods}</label>
      </div>
    </>
  );
}
