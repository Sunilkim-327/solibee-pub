"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { formatPeriod } from "@/lib/format";
import { SETUP_ISSUE_LABEL } from "@/lib/user-admin";
import { DateField } from "../DatePicker";
import { DeptSelect, type Dept } from "../AdminDirectory";
import { OpenProjectButton } from "../OpenProjectButton";
import { NodeIcon } from "../Tree";
import { ChangesSection, LifecycleSection, PHASE_BADGE } from "../ProjectContractPanel";
import { useRun } from "../hooks/useRun";
import { PmEditor } from "./PmEditor";
import { SEVERE, issuesOf } from "./model";
import type { Project, User } from "./types";
import { Icon } from "../icons";

export type CardSection = "info" | "pm" | "life" | "changes";
const CARD_SECTIONS: [CardSection, string][] = [["info", "정보"], ["pm", "PM"], ["life", "상태·연차"], ["changes", "변경계약"]];

/** 프로젝트 카드 — 요약 · 시작 준비 배지, 펼치면 정보 / PM / 상태·연차 / 변경계약 */
export function ProjectCard({ project, projects, users, depts, canBudget, initialOpen }: { project: Project; projects: Project[]; users: User[]; depts: Dept[]; canBudget: boolean;
  /** 주소(?project=&tab=)로 바로 연 카드 — 그 영역을 펼치고 화면에 보이게 */
  initialOpen?: CardSection }) {
  const [open, setOpen] = useState<CardSection | null>(initialOpen ?? null);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialOpen) box.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [initialOpen]);
  const init = { name: project.name, code: project.code ?? "", departmentId: project.departmentId ?? "", startDate: project.startDate, endDate: project.endDate, parentId: project.parentId ?? "",
    settleWithParent: project.settleWithParent, excelPrefix: project.excelPrefix ?? "" };
  const [v, setV] = useState(init);
  const save = useRun();
  const pms = users.filter((u) => project.members.some((m) => m.userId === u.id && m.isPm)).map((u) => u.name);
  const parent = projects.find((p) => p.id === project.parentId);
  const childCount = projects.filter((p) => p.parentId === project.id).length;
  const settleKids = projects.filter((p) => p.parentId === project.id && p.settleWithParent);
  const pickedParent = projects.find((p) => p.id === v.parentId);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const issues = issuesOf(project);
  const members = users.filter((u) => project.members.some((m) => m.userId === u.id));
  const toggle = () => setOpen(open ? null : "info");

  return (
    <section ref={box} className={`card min-w-0 flex-1 scroll-mt-20 transition-shadow ${open ? "shadow-sm ring-1 ring-primary/20" : ""}`}>
      <div className="flex items-start gap-2 px-4 pt-3.5 pb-3 sm:px-5">
        <button type="button" className="min-w-0 flex-1 py-0.5 text-left" onClick={toggle} aria-expanded={!!open}>
          <div className="flex flex-wrap items-center gap-1.5">
            <NodeIcon icon={project.depth > 0 ? "subproject" : "project"} />
            <span className="font-bold">{project.name}</span>
            <span className={`badge ${PHASE_BADGE[project.phase]}`}>{project.phaseLabel}</span>
            {project.round && <span className="badge badge-info">{project.round}차</span>}
            {childCount > 0 && <span className="badge badge-primary">하위 {childCount}개</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="tabular">{formatPeriod(project.startDate, project.endDate)}</span>
            <span>{project.departmentName ?? <span className="text-amber-700">조직 미지정</span>}</span>
            <span>PM {pms.length ? <b className="font-semibold text-fg">{pms.join(", ")}</b> : <b className="font-semibold text-amber-800">미지정</b>}</span>
            <span>팀원 {project.members.length}명</span>
            {project.code && <span>{project.code}</span>}
            {parent && <span>상위 {parent.name}{project.settleWithParent && <> · <b className="font-semibold text-fg">함께 상신</b></>}</span>}
            {project.excelPrefix && <span>엑셀 구분 {project.excelPrefix}</span>}
            {settleKids.length > 0 && <span>함께 상신 {settleKids.map((k) => k.excelPrefix || k.name).join(", ")}</span>}
          </div>
        </button>
        {canBudget && <OpenProjectButton projectId={project.id} name={project.name} href="/budget" label="프로젝트 운영비 →" className="btn-ghost btn-sm hidden sm:inline-flex" />}
        <button type="button" onClick={toggle} aria-expanded={!!open} aria-label={open ? "접기" : "관리 펼치기"}
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg transition sm:size-9 ${open ? "bg-brand-50 text-primary" : "text-fg-subtle hover:bg-surface-muted hover:text-fg"}`}>
          <Icon name="down" sw={1.8} className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {(issues.length > 0 || canBudget) && (
        <div className={`flex flex-wrap items-center gap-1.5 px-4 pb-3.5 sm:px-5 ${issues.length ? "" : "sm:hidden"}`}>
          {issues.length > 0 && <span className="mr-0.5 text-xs font-medium text-fg-subtle">시작 준비</span>}
          {issues.map((k) => {
            const cls = `badge min-h-7 px-2 text-label transition badge-warn hover:bg-amber-200 ${SEVERE.includes(k) ? "font-bold" : ""}`;
            if (k === "NO_BUDGET" && canBudget) return <OpenProjectButton key={k} projectId={project.id} href="/budget" label={`${SETUP_ISSUE_LABEL[k]} →`} className={cls} />;
            if (k === "NO_PM") return <button key={k} type="button" className={cls} title="PM 지정 열기" onClick={() => setOpen("pm")}>{SETUP_ISSUE_LABEL[k]} →</button>;
            return <span key={k} className={cls}>{SETUP_ISSUE_LABEL[k]}</span>;
          })}
          {canBudget && <OpenProjectButton projectId={project.id} href="/budget" label="프로젝트 운영비 →" className="btn-secondary btn-sm ml-auto sm:hidden" />}
        </div>
      )}

      {open && (
        <div className="border-t border-line">
          <div className="px-4 pt-3 sm:px-5">
            <div className="seg w-full sm:w-auto" role="tablist" aria-label={`${project.name} 관리`}>
              {CARD_SECTIONS.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={open === k} onClick={() => setOpen(k)} className="flex-1 sm:flex-none">{label}</button>
              ))}
            </div>
          </div>
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            {open === "info" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="sm:col-span-2 lg:col-span-1"><span className="label">프로젝트명</span><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
                  <label><span className="label">프로젝트 코드</span><input className="input" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></label>
                  <label><span className="label">소속 조직</span><DeptSelect depts={depts} value={v.departmentId} onChange={(departmentId) => setV({ ...v, departmentId })} empty="선택" className="input" epsOnly /></label>
                  <div><span className="label">시작일</span><DateField value={v.startDate} onChange={(d) => setV({ ...v, startDate: d })} /></div>
                  <div><span className="label">종료일</span><DateField value={v.endDate} onChange={(d) => setV({ ...v, endDate: d })} /></div>
                  <label><span className="label">상위 프로젝트</span>
                    <select className="input" value={v.parentId} onChange={(e) => setV({ ...v, parentId: e.target.value })}>
                      <option value="">없음 (최상위)</option>
                      {projects.filter((p) => p.id !== project.id).map((p) => <option key={p.id} value={p.id}>{"  ".repeat(p.depth)}{p.name}</option>)}
                    </select></label>
                  <label><span className="label">엑셀 구분명</span>
                    <input className="input" value={v.excelPrefix} maxLength={20} placeholder={v.parentId ? "예: 대응" : "예: 운영 (없으면 항목 이름 그대로)"}
                      onChange={(e) => setV({ ...v, excelPrefix: e.target.value })} /></label>
                </div>
                {v.parentId && (
                  <div className="rounded-xl border border-line bg-surface-muted px-3 py-3">
                    <label className="flex items-start gap-2.5">
                      <input type="checkbox" className="mt-1 size-4" checked={v.settleWithParent} onChange={(e) => setV({ ...v, settleWithParent: e.target.checked })} />
                      <span className="min-w-0 text-sm">
                        <b>{pickedParent?.name ?? "상위 프로젝트"}과(와) 함께 상신</b>
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          팀원은 이 프로젝트에서 입력하고, 마감·상신은 {pickedParent?.name ?? "상위 프로젝트"} PM이 합니다.
                          상신 엑셀에는 항목 이름 앞에 엑셀 구분명이 붙습니다(예: 대응_야근식대). 같은 항목은 &lsquo;메인 항목 가져오기&rsquo;로 맞추세요.
                        </span>
                      </span>
                    </label>
                    {v.settleWithParent && !v.excelPrefix.trim() && <p className="mt-2 text-xs font-medium text-amber-800">함께 상신하려면 엑셀 구분명을 입력하세요.</p>}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primary" disabled={save.busy || !dirty}
                    onClick={() => save.act(() => api(`/api/projects/${project.id}`, {
                      method: "PATCH", json: { ...v, code: v.code || null, departmentId: v.departmentId || null, parentId: v.parentId || null, settleWithParent: !!v.parentId && v.settleWithParent, excelPrefix: v.excelPrefix.trim() || null },
                    }), "저장됨")}>정보 저장</button>
                  {dirty && <button className="btn-ghost" onClick={() => setV(init)}>변경 취소</button>}
                  {save.view}
                </div>
              </div>
            )}
            {open === "pm" && <PmEditor project={project} users={users} />}
            {open === "life" && <LifecycleSection project={project} />}
            {open === "changes" && <ChangesSection project={project} users={members} />}
          </div>
        </div>
      )}
    </section>
  );
}
