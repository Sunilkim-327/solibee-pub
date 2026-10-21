"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { useRun } from "./hooks/useRun";
import { Icon } from "./icons";
import { DatePicker } from "./DatePicker";
import { SaveBar } from "./SaveBar";
import { useConfirm } from "./ConfirmDialog";
import { TempPasswordDialog, type TempPassword } from "./TempPasswordDialog";
import { dayLabel } from "@/lib/format";

export type MemberCandidate = {
  id: string;
  name: string;
  position: string | null;
  /** 소속 조직 id (이름은 deptNames에서 — 같은 조직 이름을 사람마다 반복해 보내지 않게) */
  deptId: string | null;
  /** PM 소속 조직·프로젝트 주관 조직(하위 포함) 사람 — 검색 전에 추천 (아니면 생략) */
  near?: true;
};
/** leftAt: 철수일 (YYYY-MM-DD) — 있으면 이전 팀원 */
type Member = { userId: string; isPayer: boolean; isPm: boolean; leftAt: string | null };

/**
 * PM 설정 — 프로젝트 팀원 관리 (PM).
 * 팀원 추가·삭제·이전 팀원 처리와 정산표 결제자 여부만 바꾼다. PM 지정은 재무 승인이 기준 정보에서 한다.
 * 이전 팀원: 다른 팀으로 옮긴 사람 — 지난 지출·출입증 내역의 결제자로 남고 접근·입력은 막힌다 (lib/membership.ts).
 * 삭제: 잘못 추가한 사람 — 이 프로젝트에 내역이 있으면 서버가 막는다.
 * candidates는 직급 → 성명 순으로 정렬되어 들어온다.
 */
export function ProjectMembersSettings({ projectId, candidates, deptNames, initial, today }: { projectId: string; candidates: MemberCandidate[]; deptNames: Record<string, string>; initial: Member[]; today: string }) {
  const deptOf = (c: MemberCandidate) => (c.deptId ? deptNames[c.deptId] ?? null : null);
  const [members, setMembers] = useState(initial);
  const [q, setQ] = useState("");
  const { act, busy, view } = useRun({ ok: "font-medium text-emerald-700", error: "font-medium text-rose-700" });
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const isMember = (id: string) => members.some((m) => m.userId === id);
  const dirty = JSON.stringify([...members].sort((a, b) => a.userId.localeCompare(b.userId))) !==
    JSON.stringify([...initial].sort((a, b) => a.userId.localeCompare(b.userId)));

  // 팀원은 직급 → 성명 순 (candidates 순서를 따른다, PM도 같은 기준)
  const order = useMemo(() => new Map(candidates.map((c, i) => [c.id, i])), [candidates]);
  const sorted = [...members].sort((a, b) => (order.get(a.userId) ?? 1e9) - (order.get(b.userId) ?? 1e9));
  const current = sorted.filter((m) => !m.leftAt);
  const former = sorted.filter((m) => m.leftAt);
  const [showFormer, setShowFormer] = useState(true);
  // 임시 비밀번호 발급 — 확인 후 서버가 발급, 한 번만 보이는 팝업으로 전달 (관리자 발급과 같은 효과)
  const { confirm, alert, dialog } = useConfirm();
  const [temp, setTemp] = useState<TempPassword[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);
  const resetPassword = async (m: Member) => {
    const name = byId.get(m.userId)?.name ?? "이 팀원";
    if (!(await confirm({ message: `${name}님의 임시 비밀번호를 발급할까요? 기존 비밀번호는 무효가 되고, 24시간 안에 새 비밀번호로 바꿔야 해요.`, confirmLabel: "발급" }))) return;
    setResetting(m.userId);
    try {
      setTemp([await api<TempPassword>(`/api/projects/${projectId}/members/${m.userId}/reset-password`, { method: "POST" })]);
    } catch (e) {
      // 실패(발급 횟수 제한 15분 10회 등)도 팝업으로 — 결과 문구는 화면 맨 아래 저장 줄에 있어 버튼 옆에서는 보이지 않는다
      await alert({ message: `${name}님의 임시 비밀번호를 발급하지 못했어요.\n${(e as Error).message}` });
    } finally {
      setResetting(null);
    }
  };

  const term = q.trim().toLowerCase();
  const pool = candidates.filter((c) => !isMember(c.id));
  const suggestions = term
    ? pool.filter((c) => `${c.name} ${deptOf(c) ?? ""} ${c.position ?? ""}`.toLowerCase().includes(term)).slice(0, 30)
    : pool.filter((c) => c.near).slice(0, 30);

  const add = (id: string, leftAt: string | null = null) => setMembers((ms) => [...ms, { userId: id, isPayer: !leftAt, isPm: false, leftAt }]);
  const remove = (id: string) => setMembers((ms) => ms.filter((m) => m.userId !== id));
  const setLeft = (id: string, leftAt: string | null) => setMembers((ms) => ms.map((m) => (m.userId === id ? { ...m, leftAt } : m)));
  const togglePayer = (id: string) => setMembers((ms) => ms.map((m) => (m.userId === id ? { ...m, isPayer: !m.isPayer } : m)));

  const save = async () => {
    const ok = await act(
      () => api(`/api/projects/${projectId}/members`, { method: "PUT", json: { members } }),
      "저장되었습니다. 추가된 팀원은 바로 입력할 수 있어요.",
    );
    // 저장했으면 검색어를 지워 추천 목록으로 돌아간다
    if (ok) setQ("");
  };

  const Person = ({ c, sub }: { c: MemberCandidate | undefined; sub?: React.ReactNode }) => (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{c?.name.slice(0, 1) ?? "?"}</span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">
          {c?.name ?? "(비활성 사용자)"} {c?.position && <span className="font-normal text-fg-muted">{c.position}</span>}
        </div>
        <div className="truncate text-xs text-fg-muted">{(c && deptOf(c)) ?? "부서 없음"}{sub}</div>
      </div>
    </div>
  );

  return (
    <div className="card overflow-clip">
      {dialog}
      <TempPasswordDialog items={temp} onClose={() => setTemp([])} />
      <div className="card-head flex-col items-start gap-1">
        <h2 className="section-title">프로젝트 팀원 <span className="font-medium text-fg-muted">{current.length}명</span></h2>
        <p className="text-sm text-fg-muted">팀원으로 추가된 사람만 이 프로젝트에 지출을 입력할 수 있어요. PM 지정은 재무 승인 담당이 해요.</p>
      </div>

      {/* 현재 팀원 */}
      <ul className="divide-y divide-line">
        {current.length === 0 && <li className="px-5 py-8 text-center text-sm text-fg-muted">아직 팀원이 없어요. 아래에서 찾아 추가하세요.</li>}
        {current.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
            {/* 좁은 화면: 이름이 잘리지 않도록 버튼 묶음은 다음 줄(오른쪽)로 내려간다 */}
            <div className="flex min-w-48 flex-1"><Person c={byId.get(m.userId)} /></div>
            {m.isPm ? (
              <span title="PM 지정·해제는 재무 승인 담당이 합니다" className="badge badge-primary px-2 text-xs">PM</span>
            ) : (
              <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <label className="flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 text-xs text-fg-muted" title="정산표·상신 엑셀의 결제자 목록에 표시">
                  <input type="checkbox" className="size-4" checked={m.isPayer} onChange={() => togglePayer(m.userId)} /> 결제자
                </label>
                {/* 저장 전(아직 추가만 한 사람)에게는 발급할 수 없다 — 서버가 팀원으로 알지 못함 */}
                {initial.some((x) => x.userId === m.userId) && (
                  <button type="button" title="비밀번호를 잊은 팀원에게 발급해 직접 전달해요. 기존 비밀번호는 무효가 돼요." disabled={busy || resetting === m.userId}
                    onClick={() => void resetPassword(m)} className="btn-secondary btn-sm shrink-0">임시 비밀번호 발급</button>
                )}
                <button type="button" title="다른 팀으로 옮긴 사람. 지난 내역은 남고 입력은 막혀요." onClick={() => setLeft(m.userId, today)}
                  className="btn-secondary btn-sm shrink-0">이전 팀원으로</button>
                <button type="button" aria-label="팀원에서 삭제" title="잘못 추가한 사람만. 내역이 있으면 삭제할 수 없어요." onClick={() => remove(m.userId)}
                  className="btn-secondary btn-sm shrink-0 text-status-rejected hover:bg-rose-50 hover:text-status-rejected">삭제</button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* 이전 팀원 (다른 팀으로 옮긴 사람) */}
      {former.length > 0 && (
        <div className="border-t border-line">
          <button type="button" className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-fg-muted" aria-expanded={showFormer} onClick={() => setShowFormer((v) => !v)}>
            <span aria-hidden>{showFormer ? "▾" : "▸"}</span> 이전 팀원 {former.length}명
            <span className="font-normal text-fg-subtle">· 철수일까지의 지출·출입증 내역에 결제자로 남아요</span>
          </button>
          {showFormer && (
            <ul className="divide-y divide-line bg-surface-muted/40">
              {former.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
                  <div className="flex min-w-48 flex-1"><Person c={byId.get(m.userId)} /></div>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                    철수일
                    <DatePicker value={m.leftAt ?? ""} max={today} today={today} label={`${byId.get(m.userId)?.name ?? ""} 철수일`}
                      onChange={(d) => d && setLeft(m.userId, d)}
                      className="btn-secondary btn-sm tabular inline-flex items-center gap-1.5">
                      <Icon name="calendar" className="size-4" />{m.leftAt ? dayLabel(m.leftAt) : "날짜 선택"}
                    </DatePicker>
                  </span>
                  <button type="button" title="현재 팀원으로 되돌림" onClick={() => setLeft(m.userId, null)} className="btn-secondary btn-sm shrink-0">복귀</button>
                  <button type="button" aria-label="팀원에서 삭제" onClick={() => remove(m.userId)}
                    className="btn-secondary btn-sm shrink-0 text-status-rejected hover:bg-rose-50 hover:text-status-rejected">삭제</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 추가 */}
      <div className="border-t border-line bg-surface-muted/50 px-5 py-4">
        <div className="relative">
          <Icon name="find" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input className="input pl-9" aria-label="추가할 팀원 찾기" placeholder="이름·부서·직급으로 추가할 팀원 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="mt-2 text-xs font-semibold text-fg-muted">{term ? `검색 결과 ${suggestions.length}명` : "우리 조직 · 프로젝트 주관 조직"}</p>
        {suggestions.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg-muted">{term ? "검색 결과가 없어요." : "추천할 사람이 없어요. 이름으로 검색해 보세요."}</p>
        ) : (
          <ul className="mt-1 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface">
            {suggestions.map((c) => (
              // 좁은 화면: 이름이 잘리지 않도록 버튼 두 개는 다음 줄(오른쪽)로 내려간다
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <div className="flex min-w-48 flex-1"><Person c={c} /></div>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => add(c.id)}
                    className="btn-sm inline-flex shrink-0 items-center rounded-lg border border-primary font-semibold text-primary hover:bg-brand-50">+ 추가</button>
                  <button type="button" title="이미 옮긴 사람을 철수일과 함께 추가해요. 지난 내역의 결제자로 남아요." onClick={() => add(c.id, today)}
                    className="btn-ghost btn-sm shrink-0 text-xs">+ 이전 팀원으로</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setMembers(initial)} label="팀원 저장" status={view}
        note="[팀원 저장]을 눌러야 반영돼요." />
    </div>
  );
}
