"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Empty } from "../common";
import { useRun } from "../hooks/useRun";
import { CategoryPanel } from "./CategoryPanel";
import { Icon } from "../icons";
import { templatesOf } from "./model";
import type { Category, Project } from "./types";

// 항목 코드는 화면에 보이지 않는다 (자동 부여, 공통 항목에서 가져오면 같은 코드를 이어 써서 프로젝트 간 집계에 쓴다)

/**
 * 분류·항목 관리 (재무 승인) — 왼쪽(모바일은 위쪽 칩) 분류 목록, 오른쪽 고른 분류의 공통 항목.
 * 공통 항목 = 새 프로젝트를 만들 때 복사되는 기본 항목. 평소에는 읽기 화면이고, [수정]을 누른 줄만 입력칸이 된다.
 */
export function CatalogTab({ categories, projects }: { categories: Category[]; projects: Project[] }) {
  const [selId, setSelId] = useState(categories[0]?.id ?? "");
  const [addingMobile, setAddingMobile] = useState(false);
  const selIdx = Math.max(0, categories.findIndex((c) => c.id === selId));
  const sel = categories[selIdx];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-5">
      {/* 모바일: 가로 스크롤 칩 */}
      <div className="md:hidden">
        <div className="-mx-4 overflow-x-auto px-4 pb-1">
          <div className="flex w-max gap-2" role="tablist" aria-label="분류">
            {categories.map((c) => {
              const on = c.id === sel?.id;
              return (
                <button key={c.id} type="button" role="tab" aria-selected={on} onClick={() => setSelId(c.id)}
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition ${on ? "border-primary bg-primary font-bold text-on-primary" : "border-line-strong bg-surface text-fg-muted"}`}>
                  {c.name}
                  <span className={`tabular text-xs ${on ? "opacity-80" : "text-fg-subtle"}`}>{templatesOf(c).length}</span>
                </button>
              );
            })}
            <button type="button" onClick={() => setAddingMobile(!addingMobile)} aria-expanded={addingMobile}
              className="inline-flex min-h-10 items-center gap-1 rounded-full border border-dashed border-line-strong px-3.5 text-sm text-fg-muted">
              <Icon name="plus" className="size-3.5" /> 분류
            </button>
          </div>
        </div>
        {addingMobile && <div className="card mt-2 p-3"><AddCategory onAdded={() => setAddingMobile(false)} /></div>}
      </div>

      {/* 넓은 화면: 분류 목록 */}
      <aside className="card hidden overflow-hidden md:block">
        <div className="flex items-baseline justify-between border-b border-line px-4 py-3.5">
          <h3 className="section-title">분류</h3>
          <span className="text-xs text-fg-muted">{categories.length}개</span>
        </div>
        <ul className="p-1.5">
          {categories.map((c) => {
            const on = c.id === sel?.id;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setSelId(c.id)} aria-current={on}
                  className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition ${on ? "bg-brand-50 font-semibold text-primary" : "text-fg hover:bg-surface-muted"}`}>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className={`tabular rounded-full px-2 py-0.5 text-xs ${on ? "bg-surface text-primary" : "bg-surface-muted text-fg-muted"}`}>{templatesOf(c).length}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line p-3"><AddCategory /></div>
      </aside>

      {/* 고른 분류의 공통 항목 */}
      {sel ? (
        <CategoryPanel key={sel.id} category={sel} allCategories={categories} projects={projects} index={selIdx} count={categories.length} />
      ) : (
        <div className="card"><Empty>분류가 없습니다.</Empty></div>
      )}
    </div>
  );
}

function AddCategory({ onAdded }: { onAdded?: () => void }) {
  const [name, setName] = useState("");
  const add = useRun();
  return (
    <div>
      <div className="flex gap-2">
        <input className="input" placeholder="새 분류 이름" value={name} maxLength={30} aria-label="새 분류 이름" onChange={(e) => setName(e.target.value)} />
        <button className="btn-secondary shrink-0" disabled={add.busy || !name.trim()}
          onClick={async () => {
            if (await add.act(() => api("/api/master/categories", { method: "POST", json: { name } }), "추가됨")) { setName(""); onAdded?.(); }
          }}>추가</button>
      </div>
      {add.view && <div className="mt-1.5 text-xs">{add.view}</div>}
    </div>
  );
}
