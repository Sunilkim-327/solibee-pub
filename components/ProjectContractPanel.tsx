"use client";

import { useEffect, useState } from "react";
import { DateField } from "./DatePicker";
import { ApiError, api } from "@/lib/client";
import { dotDate, formatPeriod, won, ymKo } from "@/lib/format";
import { useRun } from "./hooks/useRun";
import type { ProjectPhase } from "@/lib/lifecycle";
import { Icon } from "./icons";
import { useConfirm } from "./ConfirmDialog";
import { OpenProjectButton } from "./OpenProjectButton";
import { toast } from "./Nav";
import type { CloseBlocker } from "@/lib/lifecycle";

type P = {
  id: string; name: string; startDate: string; endDate: string;
  phase: ProjectPhase; phaseLabel: string; seriesName: string | null; round: number | null; closed: boolean; archived: boolean; passEnabled?: boolean;
  budgetItems: { id: string; name: string }[];
};
type U = { id: string; name: string; position: string | null };
export type ChangeRow = {
  id: string; seq: number; title: string; signedAt: string; amountDelta: number; startDate: string; endDate: string;
  extendedFrom: string | null; note: string | null; carriedFromId: string | null;
  manager: { id: string; name: string } | null; itemIds: string[]; planned: number; spent: number;
};

/** 프로젝트 단계 배지 색 */
export const PHASE_BADGE: Record<ProjectPhase, string> = {
  UPCOMING: "bg-sky-100 text-sky-800",
  ACTIVE: "badge-ok",
  WRAPUP: "badge-warn",
  CLOSED: "badge-neutral",
  ARCHIVED: "badge-neutral",
};

/** 상태·연차 — 종료 처리·보관·다음 연차 만들기 */
export function LifecycleSection({ project }: { project: P }) {
  const act = useRun();
  const [next, setNext] = useState<null | { name: string; startDate: string; endDate: string; copyBudget: boolean; changes: { id: string; label: string; endDate: string; carryOver: boolean }[]; carry: string[] }>(null);
  const call = (action: string, ok: string) => act.run(() => api(`/api/projects/${project.id}/lifecycle`, { method: "POST", json: { action } }), ok);
  // 종료 처리 가능 여부 미리보기 (기간 종료 후 정리 단계에서만)
  const [blockers, setBlockers] = useState<CloseBlocker[] | null>(null);
  const canCheck = !project.closed && project.phase === "WRAPUP";
  useEffect(() => {
    if (!canCheck) { setBlockers(null); return; }
    let alive = true;
    api<{ items: CloseBlocker[] }>(`/api/projects/${project.id}/lifecycle`)
      .then((r) => alive && setBlockers(r.items))
      .catch(() => alive && setBlockers(null));
    return () => { alive = false; };
  }, [project.id, canCheck]);
  const closable = canCheck && blockers !== null && blockers.length === 0;
  const hint = canCheck
    ? `지출이 있는 모든 월이 승인되${project.passEnabled ? "고 출입증이 모두 확정되" : ""}면 종료할 수 있습니다. 자료는 종료 후에도 남습니다.`
    : !project.closed && (project.phase === "ACTIVE" || project.phase === "UPCOMING")
      ? `기간 종료(${dotDate(project.endDate)}) 후 종료할 수 있습니다.`
      : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line px-4 py-3">
          <div className="text-xs font-medium text-fg-muted">상태</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`badge px-2 text-xs ${PHASE_BADGE[project.phase]}`}>{project.phaseLabel}</span>
            <span className="tabular text-xs text-fg-muted">{formatPeriod(project.startDate, project.endDate)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-line px-4 py-3">
          <div className="text-xs font-medium text-fg-muted">연차</div>
          <div className="mt-1.5 text-sm">
            {project.seriesName ? <><b>{project.seriesName}</b> <span className="text-fg-muted">{project.round ?? 1}차</span></> : <span className="text-fg-muted">단일 연차</span>}
          </div>
        </div>
      </div>

      {canCheck && blockers && blockers.length > 0 && (
        <div className="alert alert-warn text-xs">
          <b>아직 종료할 수 없습니다</b>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {blockers.map((b) => (
              <li key={b.label}>
                {b.label}{b.months.length > 0 && ": "}
                {b.page && b.months.map((m, i) => (
                  <span key={m}>{i > 0 && ", "}
                    <OpenProjectButton projectId={project.id} name={project.name} href={`${b.page}?ym=${m}`} label={ymKo(m)}
                      className="min-h-9 font-semibold underline underline-offset-2" />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canCheck && (
          <button className="btn-secondary" disabled={act.busy || !closable}
            title={blockers === null ? "종료 가능 여부 확인 중" : blockers.length ? blockers.map((b) => b.label).join("\n") : undefined}
            onClick={() => call("close", "종료 처리했습니다. 이제 조회 전용입니다.")}>종료 처리</button>
        )}
        {project.closed && <button className="btn-secondary" disabled={act.busy} onClick={() => call("reopen", "종료를 취소했습니다.")}>종료 취소</button>}
        {project.closed && project.phase !== "ARCHIVED" && <button className="btn-secondary" disabled={act.busy} onClick={() => call("archive", "보관했습니다. 프로젝트 선택 목록에서 숨겨집니다.")}>보관</button>}
        {project.phase === "ARCHIVED" && <button className="btn-secondary" disabled={act.busy} onClick={() => call("unarchive", "보관을 해제했습니다.")}>보관 해제</button>}
        {!next && (
          <button className="btn-primary" disabled={act.busy}
            onClick={() => act.run(async () => {
              const d = await api<{ name: string; startDate: string; endDate: string; changes: { id: string; label: string; endDate: string; carryOver: boolean }[] }>(`/api/projects/${project.id}/next-round`);
              setNext({ ...d, copyBudget: true, carry: d.changes.filter((c) => c.carryOver).map((c) => c.id) });
            }, undefined, { refresh: false })}>다음 연차 만들기</button>
        )}
        {act.view}
      </div>
      {hint && <p className="text-sm text-fg-muted">{hint}</p>}

      {next && (
        <div className="rounded-xl border border-line">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-bold">다음 연차 만들기</p>
            <p className="mt-0.5 text-xs text-fg-muted">항목·한도, 팀원 지출 항목, 팀원·PM, 출입증 설정을 복사합니다.</p>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="label">프로젝트명</span><input className="input" value={next.name} onChange={(e) => setNext({ ...next, name: e.target.value })} /></label>
              <div><span className="label">시작일</span><DateField value={next.startDate} onChange={(d) => setNext({ ...next, startDate: d })} /></div>
              <div><span className="label">종료일</span><DateField value={next.endDate} onChange={(d) => setNext({ ...next, endDate: d })} /></div>
              <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm sm:col-span-2">
                <input type="checkbox" className="size-4" checked={next.copyBudget} onChange={(e) => setNext({ ...next, copyBudget: e.target.checked })} /> 예산도 복사 (단가·기간)
              </label>
            </div>
            {next.changes.length > 0 && (
              <div>
                <p className="label">이어받을 변경계약 과업</p>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {next.changes.map((c) => (
                    <li key={c.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-muted/50">
                        <input type="checkbox" className="size-4" checked={next.carry.includes(c.id)}
                          onChange={(e) => setNext({ ...next, carry: e.target.checked ? [...next.carry, c.id] : next.carry.filter((x) => x !== c.id) })} />
                        <span className="min-w-0 flex-1">{c.label}</span>
                        <span className="tabular shrink-0 text-xs text-fg-subtle">~ {dotDate(c.endDate)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            <button className="btn-ghost" onClick={() => setNext(null)}>취소</button>
            <button className="btn-primary" disabled={act.busy}
              onClick={async () => {
                const r = await act.run(() => api<{ id: string }>(`/api/projects/${project.id}/next-round`, {
                  method: "POST", json: { name: next.name, startDate: next.startDate, endDate: next.endDate, copyBudget: next.copyBudget, carryChangeIds: next.carry },
                }));
                if (r) {
                  // 만든 연차로 바로 갈 수 있게 (그 프로젝트로 바꿔 운영비 화면)
                  toast(`${next.name}을(를) 만들었습니다.`, { label: "새 연차 열기 ›", href: "/budget", projectId: r.id });
                  setNext(null);
                }
              }}>만들기</button>
          </div>
        </div>
      )}
    </div>
  );
}

const emptyChange = { title: "", signedAt: "", amountDelta: "", startDate: "", endDate: "", managerId: "", note: "" };

/** 변경계약 — 본계약의 변경으로 들어온 과업 (본계약과 함께 정산·상신) */
export function ChangesSection({ project, users }: { project: P; users: U[] }) {
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [form, setForm] = useState<typeof emptyChange | null>(null);
  const [needsExtend, setNeedsExtend] = useState(false);
  const act = useRun();
  const { confirm, dialog } = useConfirm();
  const load = () => api<ChangeRow[]>(`/api/projects/${project.id}/changes`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const writable = !project.closed;

  async function submit(extendProject: boolean) {
    if (!form || act.busy) return;
    setNeedsExtend(false);
    await act.run(async () => {
      try {
        await api(`/api/projects/${project.id}/changes`, { method: "POST", json: { ...form, managerId: form.managerId || null, extendProject } });
      } catch (e) {
        if (e instanceof ApiError && e.data.needsExtension) setNeedsExtend(true);
        throw e;
      }
      setForm(null);
      await load();
    }, "변경계약을 등록했습니다.");
  }

  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-muted">본계약과 함께 정산·상신 {rows && rows.length > 0 && <b className="text-fg">{rows.length}건</b>}</span>
        {writable && !form && (
          <button className="btn-secondary btn-sm ml-auto" onClick={() => setForm({ ...emptyChange, startDate: project.startDate, endDate: project.endDate })}>+ 변경계약 등록</button>
        )}
      </div>

      {rows === null ? <p className="py-4 text-sm text-fg-subtle">불러오는 중…</p> : rows.length === 0 && !form ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
          <p className="text-sm text-fg-muted">등록된 변경계약이 없습니다.</p>
          <p className="mt-1 text-sm text-fg-subtle">별도 계약 과업은 서브 프로젝트로 만드세요.</p>
        </div>
      ) : rows.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {rows.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="badge badge-primary">변경 {c.seq}차</span>
                    <span className="font-semibold">{c.title}</span>
                    {c.extendedFrom && <span className="badge bg-sky-100 text-sky-800" title={`본계약 기간 연장 (${dotDate(c.extendedFrom)}까지 → ${dotDate(project.endDate)})`}>기간 연장</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                    <span className="tabular">{formatPeriod(c.startDate, c.endDate)}</span>
                    <span className="tabular">계약 {dotDate(c.signedAt)}</span>
                    <span>담당 PM <b className="font-medium text-fg">{c.manager?.name ?? "미지정"}</b></span>
                    <span>지출 항목 {c.itemIds.length}개</span>
                  </div>
                </div>
                {writable && (
                  <button type="button" aria-label={`${c.title} 삭제`} title="삭제" disabled={act.busy}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    onClick={async () => {
                      if (!(await confirm({ message: `변경계약 '${c.title}'을(를) 삭제할까요?`, confirmLabel: "삭제", danger: true }))) return;
                      if (await act.run(() => api(`/api/changes/${c.id}`, { method: "DELETE" }), "삭제했습니다.")) load();
                    }}>
                    <Icon name="trash" />
                  </button>
                )}
              </div>
              <dl className="tabular mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-xs">
                <div><dt className="text-fg-muted">계약 증감</dt><dd className="mt-0.5 text-sm font-semibold">{c.amountDelta >= 0 ? "+" : ""}{won(c.amountDelta)}</dd></div>
                <div><dt className="text-fg-muted">배정</dt><dd className="mt-0.5 text-sm font-semibold">{won(c.planned)}</dd></div>
                <div><dt className="text-fg-muted">집행</dt><dd className="mt-0.5 text-sm font-semibold">{won(c.spent)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="rounded-xl border border-line">
          <div className="border-b border-line px-4 py-3 text-sm font-bold">변경계약 등록</div>
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="sm:col-span-2"><span className="label">과업명 *</span><input className="input" placeholder="예) 모바일 기능 고도화" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <div><span className="label">변경계약일 *</span><DateField value={form.signedAt} onChange={(d) => setForm({ ...form, signedAt: d })} /></div>
            <div><span className="label">과업 시작일 *</span><DateField value={form.startDate} onChange={(d) => setForm({ ...form, startDate: d })} /></div>
            <div><span className="label">과업 종료일 *</span><DateField value={form.endDate} onChange={(d) => setForm({ ...form, endDate: d })} /></div>
            <label><span className="label">계약금액 증감 (원)</span><input className="input tabular" inputMode="numeric" placeholder="예) 30000000" value={form.amountDelta} onChange={(e) => setForm({ ...form, amountDelta: e.target.value.replace(/[^\d-]/g, "") })} /></label>
            <label><span className="label">과업 담당 PM</span>
              <select className="input" value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                <option value="">미지정</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name} {u.position ?? ""}</option>)}
              </select></label>
            <label className="sm:col-span-2"><span className="label">비고</span><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            {needsExtend && (
              <div className="alert alert-warn sm:col-span-2 lg:col-span-3">
                과업이 본계약 종료일({dotDate(project.endDate)})을 넘습니다. 본계약 기간도 연장하는 변경계약이면 [본계약 기간 연장으로 등록]을 누르세요.
                아니면 과업 종료일을 {dotDate(project.endDate)}로 맞추고, 남은 과업은 <b>다음 연차 만들기</b>에서 이어받으세요.
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            <button className="btn-ghost" onClick={() => { setForm(null); setNeedsExtend(false); }}>취소</button>
            {needsExtend && <button className="btn-secondary" disabled={act.busy} onClick={() => submit(true)}>본계약 기간 연장으로 등록</button>}
            <button className="btn-primary" disabled={act.busy} onClick={() => submit(false)}>{act.busy ? "등록 중…" : "등록"}</button>
          </div>
        </div>
      )}
      {act.view && <div>{act.view}</div>}
      <p className="text-sm text-fg-subtle">과업 담당 PM의 지출 항목은 이 프로젝트 PM이 PM 설정에서 정합니다.</p>
    </div>
  );
}
