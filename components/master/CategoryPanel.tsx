"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { won } from "@/lib/format";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";
import { byCode } from "@/lib/item-code";
import { Empty } from "../common";
import { OpenProjectButton } from "../OpenProjectButton";
import { Switch } from "../Switch";
import { useRun } from "../hooks/useRun";
import { Icon, IconButton } from "../icons";
import { digits, templatesOf } from "./model";
import type { Category, Item, Project } from "./types";
import { useConfirm } from "../ConfirmDialog";

/** 공통 항목 표의 열 (넓은 화면) */
const ITEM_COLS = "md:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_6.5rem_3.5rem_5.5rem]";

/** 고른 분류의 공통 항목 — 분류명 수정·순서, 항목 수정·삭제·기본/사용 스위치, 적용 프로젝트 */
export function CategoryPanel({ category, allCategories, projects, index, count }: {
  category: Category; allCategories: Category[]; projects: Project[]; index: number; count: number;
}) {
  const pass = category.id === PASS_CATEGORY_ID;
  const items = templatesOf(category).sort(byCode);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  const [editId, setEditId] = useState<string | null>(null);
  // 적용 프로젝트 목록을 펼친 항목
  const [usedOpen, setUsedOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", limit: "", categoryId: category.id, needsAttendees: true });
  const save = useRun();
  const move = useRun();
  const { confirm, dialog } = useConfirm();
  const limitLabel = pass ? "1일 한도" : "1인당 한도";
  const projectItems = allCategories.flatMap((c) => c.items).filter((i) => i.projectId);
  // 이 공통 항목을 실제로 가져다 쓴 프로젝트 (같은 코드로 가져온 항목만 — 이름이 같다고 세지 않음)
  const usedBy = (t: Item) => {
    if (!t.code) return [];
    const ids = new Set(projectItems.filter((p) => p.code === t.code).map((p) => p.projectId));
    return projects.filter((p) => ids.has(p.id));
  };

  const startEdit = (i: Item) => { setEditId(i.id); setDraft({ name: i.name, limit: i.perPersonLimit ? String(i.perPersonLimit) : "", categoryId: category.id, needsAttendees: i.needsAttendees }); };
  const patchItem = (id: string, json: Record<string, unknown>) => save.act(() => api(`/api/master/items/${id}`, { method: "PATCH", json }), "저장됨");
  const moveCat = (dir: "up" | "down") => move.act(() => api(`/api/master/categories/${category.id}`, { method: "PATCH", json: { move: dir } }), "");

  /** 적용 프로젝트 수 — 누르면 목록 */
  const usageButton = (i: Item) => {
    const n = usedBy(i).length;
    if (!n) return <span className="tabular text-sm text-fg-subtle">0개</span>;
    const on = usedOpen === i.id;
    return (
      <button type="button" onClick={() => setUsedOpen(on ? null : i.id)} aria-expanded={on} aria-label={`${i.name} 적용 프로젝트 ${n}개`}
        className={`tabular inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-sm transition ${on ? "bg-brand-50 font-semibold text-primary" : "text-fg hover:bg-surface-muted"}`}>
        {n}개
        <Icon name="down" sw={2} className={`size-3 transition-transform ${on ? "rotate-180" : ""}`} />
      </button>
    );
  };

  return (
    <section className="card min-w-0 overflow-hidden">
      {dialog}
      {/* 머리: 분류명 (수정) · 순서 */}
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        {renaming ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <input className="input min-w-0 flex-1 font-bold sm:w-56 sm:flex-none" value={name} maxLength={30} autoFocus aria-label="분류명" onChange={(e) => setName(e.target.value)} />
            <button className="btn-ghost" onClick={() => { setRenaming(false); setName(category.name); }}>취소</button>
            <button className="btn-primary" disabled={save.busy || !name.trim()}
              onClick={async () => (await save.act(() => api(`/api/master/categories/${category.id}`, { method: "PATCH", json: { name } }), "저장됨")) && setRenaming(false)}>저장</button>
          </div>
        ) : (
          <>
            <h3 className="section-title min-w-0 truncate">{pass ? "🪪 " : ""}{category.name}</h3>
            <IconButton name="pencil" label="분류 이름 바꾸기" onClick={() => setRenaming(true)} />
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-sm text-fg-muted">공통 항목 <b className="tabular text-fg">{items.length}</b>개</span>
          <IconButton name="up" label={`${category.name} 위로`} disabled={index === 0 || move.busy} onClick={() => moveCat("up")} />
          <IconButton name="down" label={`${category.name} 아래로`} disabled={index === count - 1 || move.busy} onClick={() => moveCat("down")} />
        </div>
      </header>
      {pass && (
        <p className="border-b border-line bg-sky-50 px-4 py-2.5 text-sm text-sky-900 sm:px-5">
          회사가 부담하는 출입증 항목입니다(기본은 본인 부담). 지출 입력·예산에는 나오지 않습니다.
        </p>
      )}
      {(save.view || move.view) && <div className="border-b border-line px-4 py-2 sm:px-5">{save.view}{move.view}</div>}

      {/* 항목 목록 */}
      {items.length === 0 ? (
        <Empty>아직 공통 항목이 없습니다.</Empty>
      ) : (
        <>
          <div className={`hidden gap-3 bg-surface-muted/60 px-5 py-2 text-xs font-medium text-fg-muted md:grid ${ITEM_COLS}`}>
            <span>항목명</span>
            <span className="text-right">{limitLabel}</span>
            <span className="text-right">적용 프로젝트</span>
            <span className="text-center" title="새 프로젝트를 '공통 기본 항목'으로 만들 때 처음부터 체크됩니다">새 프로젝트 기본</span>
            <span className="text-center">사용</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id}>
                {editId === i.id ? (
                  <div className="space-y-3 bg-brand-50/40 px-4 py-4 sm:px-5">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem]">
                      <label><span className="label">항목명</span>
                        <input className="input" value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                      <label><span className="label">분류</span>
                        <select className="input" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                          {allCategories.map((c) => <option key={c.id} value={c.id}>{c.id === category.id ? c.name : `→ ${c.name}로 옮기기`}</option>)}
                        </select></label>
                      <label><span className="label">{limitLabel}</span>
                        <input className="input tabular text-right" inputMode="numeric" placeholder="없음"
                          value={draft.limit ? won(Number(draft.limit)) : ""} onChange={(e) => setDraft({ ...draft, limit: digits(e.target.value) })} /></label>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <label className="mr-auto flex min-h-10 items-center gap-2 text-sm" title="끄면 참석자·인원 없이 입력할 수 있습니다">
                        <Switch checked={draft.needsAttendees} label="참석자 필수" onChange={() => setDraft({ ...draft, needsAttendees: !draft.needsAttendees })} /> 참석자 필수
                      </label>
                      <button className="btn-ghost" onClick={() => setEditId(null)}>취소</button>
                      <button className="btn-primary" disabled={save.busy || !draft.name.trim()}
                        onClick={async () => (await patchItem(i.id, { name: draft.name, perPersonLimit: Number(draft.limit) || null, needsAttendees: draft.needsAttendees, ...(draft.categoryId !== category.id ? { categoryId: draft.categoryId } : {}) })) && setEditId(null)}>저장</button>
                    </div>
                  </div>
                ) : (
                  <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5 ${ITEM_COLS} ${i.active ? "" : "text-fg-subtle"}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{i.name}</span>
                        {i.needsAttendees && <span className="badge badge-neutral" title="지출 입력 시 참석자·인원 필수">참석자 필수</span>}
                        {!i.active && <span className="badge badge-neutral">사용 안 함</span>}
                      </div>
                      <div className="tabular mt-0.5 text-xs text-fg-muted md:hidden">{limitLabel} {i.perPersonLimit ? `${won(i.perPersonLimit)}원` : "없음"}</div>
                    </div>
                    <div className="tabular hidden text-right text-sm md:block">{i.perPersonLimit ? `${won(i.perPersonLimit)}원` : <span className="text-fg-subtle">—</span>}</div>
                    <div className="hidden justify-end md:flex">{usageButton(i)}</div>
                    <div className="hidden justify-center md:flex">
                      <Switch checked={i.isDefault} label={`${i.name} 새 프로젝트 기본`} disabled={save.busy || !i.active} onChange={() => patchItem(i.id, { isDefault: !i.isDefault })} />
                    </div>
                    <div className="hidden justify-center md:flex">
                      <Switch checked={i.active} label={`${i.name} 사용`} disabled={save.busy} onChange={() => patchItem(i.id, { active: !i.active })} />
                    </div>
                    <div className="flex justify-end max-md:col-start-2 max-md:row-start-1">
                      <IconButton name="pencil" label={`${i.name} 수정`} onClick={() => startEdit(i)} />
                      <IconButton name="trash" sw={1.7} label={`${i.name} 삭제`} danger disabled={save.busy}
                        onClick={async () => { if (await confirm({ message: `공통 항목 '${i.name}'을(를) 삭제할까요? 이미 만든 프로젝트의 항목은 그대로 남습니다.`, confirmLabel: "삭제", danger: true })) save.act(() => api(`/api/master/items/${i.id}`, { method: "DELETE" }), `'${i.name}' 삭제됨`); }} />
                    </div>
                    {/* 좁은 화면: 적용 프로젝트 · 스위치 */}
                    <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-muted md:hidden">
                      <span className="flex items-center gap-1">적용 프로젝트 {usageButton(i)}</span>
                      <span className="flex items-center gap-2">
                        <Switch checked={i.isDefault} label={`${i.name} 새 프로젝트 기본`} disabled={save.busy || !i.active} onChange={() => patchItem(i.id, { isDefault: !i.isDefault })} />
                        새 프로젝트 기본
                      </span>
                      <span className="flex items-center gap-2">
                        <Switch checked={i.active} label={`${i.name} 사용`} disabled={save.busy} onChange={() => patchItem(i.id, { active: !i.active })} />
                        사용
                      </span>
                    </div>
                  </div>
                )}
                {usedOpen === i.id && (
                  <div className="border-t border-line bg-brand-50/30 px-4 py-3 sm:px-5">
                    <div className="mb-2 text-xs font-medium text-fg-muted">적용 프로젝트</div>
                    <div className="flex flex-wrap gap-1.5">
                      {usedBy(i).map((p) => (
                        <OpenProjectButton key={p.id} projectId={p.id} href="/budget" label={`${p.name}${p.closed ? " (종료)" : ""} →`}
                          className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-3 text-xs font-medium hover:border-primary hover:text-primary" />
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 항목 추가 */}
      <AddTemplateItem categoryId={category.id} limitLabel={limitLabel} />
    </section>
  );
}

function AddTemplateItem({ categoryId, limitLabel }: { categoryId: string; limitLabel: string }) {
  const [v, setV] = useState({ name: "", limit: "" });
  const add = useRun();
  // 한도는 만들 때 함께 (따로 PATCH하면 중간에 실패할 때 한도 없는 항목이 남음)
  const submit = () => api("/api/master/items", {
    method: "POST", json: { categoryId, name: v.name, projectId: null, ...(Number(v.limit) ? { perPersonLimit: Number(v.limit) } : {}) },
  });
  return (
    <div className="border-t border-line bg-surface-muted/40 px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className="input sm:flex-1" placeholder="새 항목명" value={v.name} aria-label="새 항목명" onChange={(e) => setV({ ...v, name: e.target.value })} />
        <input className="input tabular text-right sm:w-40" inputMode="numeric" placeholder={`${limitLabel} (선택)`} aria-label={limitLabel}
          value={v.limit ? won(Number(v.limit)) : ""} onChange={(e) => setV({ ...v, limit: digits(e.target.value) })} />
        <button className="btn-primary" disabled={add.busy || !v.name.trim()}
          onClick={async () => (await add.act(submit, "추가됨")) && setV({ name: "", limit: "" })}>
          <Icon name="plus" /> 항목 추가
        </button>
      </div>
      {add.view && <div className="mt-1.5 text-xs">{add.view}</div>}
    </div>
  );
}
