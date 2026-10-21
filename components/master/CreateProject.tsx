"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { byCode } from "@/lib/item-code";
import { DateField } from "../DatePicker";
import { DeptSelect, type Dept } from "../AdminDirectory";
import type { useRun } from "../hooks/useRun";
import { Icon, IconButton } from "../icons";
import { PersonPicker } from "./PersonPicker";
import { toast } from "../Nav";
import type { Category, Project, User } from "./types";

/** 새 프로젝트 만들기 — 기본 정보 · PM·상위 · 항목 구성, 아래 고정 바에서 만들기 */
export function CreateProject({ projects, users, depts, categories, run, onClose, initialDeptId = "" }: {
  projects: Project[]; users: User[]; depts: Dept[]; categories: Category[]; run: ReturnType<typeof useRun>; onClose: (done?: boolean) => void;
  /** 처음 고를 소속 조직 (체계도에서 고른 조직) */
  initialDeptId?: string;
}) {
  const empty = { name: "", code: "", departmentId: initialDeptId, startDate: "", endDate: "", pmId: "", parentId: "", itemSource: "template" };
  const [form, setForm] = useState(empty);
  // 공통 항목에서 넣을 항목 — '새 프로젝트 기본'이 처음부터 체크
  const templateCats = categories.map((c) => ({ ...c, items: c.items.filter((i) => i.projectId === null && i.active).sort(byCode) })).filter((c) => c.items.length);
  const defaults = () => new Set(templateCats.flatMap((c) => c.items.filter((i) => i.isDefault).map((i) => i.id)));
  const [picked, setPicked] = useState(defaults);
  const toggleOne = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (ids: string[], on: boolean) => setPicked((s) => { const n = new Set(s); for (const id of ids) if (on) n.add(id); else n.delete(id); return n; });
  const [srcQ, setSrcQ] = useState("");
  const copyFrom = projects.find((p) => p.id === form.itemSource) ?? null;
  const copying = !!copyFrom;
  const srcList = projects.filter((p) => !srcQ.trim() || `${p.name} ${p.code ?? ""}`.toLowerCase().includes(srcQ.trim().toLowerCase()));
  const months = form.startDate && form.endDate && form.endDate >= form.startDate
    ? (Number(form.endDate.slice(0, 4)) - Number(form.startDate.slice(0, 4))) * 12 + Number(form.endDate.slice(5, 7)) - Number(form.startDate.slice(5, 7)) + 1
    : null;
  const ready = !!form.name.trim() && !!form.startDate && !!form.endDate;
  const sourceLabel = copying ? `${copyFrom.name} 항목 복사` : form.itemSource === "template" ? `공통 항목 ${picked.size}개` : "빈 상태";

  return (
    <section className="card">
      <header className="card-head">
        <h3 className="section-title">새 프로젝트</h3>
        <IconButton name="close" label="닫기" onClick={() => onClose()} />
      </header>
      <div className="divide-y divide-line">
        <FormStep n={1} title="기본 정보">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="label">프로젝트명 *</span>
              <input className="input" placeholder="예) 차세대 플랫폼 운영" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <div><span className="label">시작일 *</span>
              <DateField value={form.startDate} onChange={(d) => setForm({ ...form, startDate: d })} /></div>
            <div><span className="label">종료일 *{months ? <span className="ml-1.5 font-medium text-primary">{months}개월</span> : null}</span>
              <DateField value={form.endDate} min={form.startDate || undefined} onChange={(d) => setForm({ ...form, endDate: d })} /></div>
            <label><span className="label">소속 조직 *</span>
              <DeptSelect depts={depts} value={form.departmentId} onChange={(departmentId) => setForm({ ...form, departmentId })} empty="선택" className="input" epsOnly /></label>
            <label><span className="label">프로젝트 코드</span>
              <input className="input" placeholder="선택" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          </div>
        </FormStep>

        <FormStep n={2} title="PM · 상위 프로젝트">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><span className="label">PM</span>
              <PersonPicker users={users} value={form.pmId} onChange={(pmId) => setForm({ ...form, pmId })} placeholder="이름 검색 (나중에 지정 가능)" /></div>
            <label><span className="label">상위 프로젝트</span>
              <select className="input" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                <option value="">없음 (최상위 프로젝트)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{"  ".repeat(p.depth)}{p.name}</option>)}
              </select></label>
          </div>
          {form.parentId && (
            <p className="alert alert-info mt-3">
              별도 계약 과업만 서브 프로젝트로 만드세요. 본계약의 변경계약은 상위 프로젝트의 <b>변경계약</b>에서 등록합니다.
            </p>
          )}
        </FormStep>

        <FormStep n={3} title="항목 구성">
          <div className="seg w-full sm:w-auto" aria-label="항목 구성">
            {([
              ["template", "공통 기본 항목"],
              ["copy", "다른 프로젝트 복사"],
              ["none", "빈 상태"],
            ] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={k === "copy" ? copying : form.itemSource === k} className="flex-1 sm:flex-none"
                onClick={() => setForm({ ...form, itemSource: k === "copy" ? (copying ? form.itemSource : projects[0]?.id ?? "template") : k })}
                disabled={k === "copy" && projects.length === 0}>
                {label}
              </button>
            ))}
          </div>

          {copying && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle"><Icon name="search" /></span>
                <input className="input pl-9" placeholder="프로젝트명·코드 검색" value={srcQ} aria-label="복사할 프로젝트 검색" onChange={(e) => setSrcQ(e.target.value)} />
              </div>
              <select className="input" value={form.itemSource} onChange={(e) => setForm({ ...form, itemSource: e.target.value })} aria-label="항목을 복사할 프로젝트">
                {/* 검색에 안 걸려도 현재 선택은 유지 */}
                {!srcList.some((p) => p.id === form.itemSource) && copyFrom && <option value={copyFrom.id}>{copyFrom.name}</option>}
                {srcList.map((p) => (
                  <option key={p.id} value={p.id}>{"  ".repeat(p.depth)}{p.name}{p.code ? ` (${p.code})` : ""}{p.phase !== "ACTIVE" ? ` · ${p.phaseLabel}` : ""}</option>
                ))}
              </select>
            </div>
          )}

          {form.itemSource === "template" && (
            <div className="mt-3 rounded-xl border border-line">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
                <span className="text-sm font-semibold">넣을 항목 <span className="tabular font-normal text-fg-muted">{picked.size}개</span></span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className="btn-ghost btn-sm" title="기준 정보 › 분류·항목의 '새 프로젝트 기본'" onClick={() => setPicked(defaults())}>기본값</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setPicked(new Set(templateCats.flatMap((c) => c.items.map((i) => i.id))))}>모두</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setPicked(new Set())}>해제</button>
                </span>
              </div>
              {!templateCats.length ? (
                <p className="px-4 py-6 text-center text-sm text-fg-muted">공통 항목이 없습니다. 빈 상태로 만들어집니다.</p>
              ) : (
                <div className="divide-y divide-line">
                  {templateCats.map((c) => {
                    const ids = c.items.map((i) => i.id);
                    const on = ids.filter((id) => picked.has(id)).length;
                    return (
                      <div key={c.id} className="px-4 py-3 sm:flex sm:gap-4">
                        <div className="mb-2 flex items-center gap-2 sm:mb-0 sm:w-32 sm:shrink-0 sm:flex-col sm:items-start sm:gap-0.5 sm:pt-1.5">
                          <span className="text-xs font-bold text-fg">{c.name}</span>
                          <button type="button" className="tabular text-xs text-fg-subtle hover:text-primary" onClick={() => toggleGroup(ids, on < ids.length)}>
                            {on}/{ids.length} · {on < ids.length ? "모두 선택" : "모두 해제"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {c.items.map((i) => {
                            const sel = picked.has(i.id);
                            return (
                              <button key={i.id} type="button" aria-pressed={sel} onClick={() => toggleOne(i.id)}
                                className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm transition ${sel ? "border-primary bg-brand-50 font-medium text-primary" : "border-line-strong text-fg-muted hover:border-primary/60"}`}>
                                {sel && <Icon name="check" className="size-3.5" />}
                                {i.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </FormStep>
      </div>

      {/* 고정 하단 바 — 모바일은 하단 탭 위 */}
      <footer data-bottom-bar className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-xl border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-5 lg:bottom-0">
        <div className="min-w-0 flex-1 text-xs text-fg-muted">
          {run.view ?? <span className="truncate">{months ? `${months}개월 · ` : ""}{sourceLabel}</span>}
        </div>
        <button className="btn-ghost" onClick={() => onClose()}>취소</button>
        <button className="btn-primary px-5" disabled={run.busy || !ready}
          onClick={async () => {
            const name = form.name.trim();
            let createdId = "";
            const ok = await run.act(async () => {
              const p = await api<{ id: string }>("/api/projects", {
                method: "POST", json: {
                  ...form, code: form.code || null, departmentId: form.departmentId || null, pmId: form.pmId || null, parentId: form.parentId || null,
                  ...(form.itemSource === "template" ? { templateItemIds: [...picked] } : {}),
                },
              });
              createdId = p.id;
            });
            // 양식이 닫히므로 안내는 화면 아래 알림으로 — 다음 단계(예산 등록)로 바로 갈 수 있게 그 프로젝트의 운영비 화면 링크
            if (ok) {
              toast(`'${name}' 프로젝트를 만들었습니다.`, createdId ? { label: "예산 등록 ›", href: "/budget", projectId: createdId } : undefined);
              setForm(empty); setPicked(defaults()); onClose(true);
            }
          }}>{run.busy ? "만드는 중…" : "프로젝트 만들기"}</button>
      </footer>
    </section>
  );
}

function FormStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-5 sm:px-5 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-6">
      <div className="mb-3 flex items-center gap-2 lg:mb-0 lg:items-start lg:pt-0.5">
        <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-primary">{n}</span>
        <h4 className="text-sm font-bold">{title}</h4>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
