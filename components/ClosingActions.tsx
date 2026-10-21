"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTION_LABEL, REOPEN_REASON_MAX, SUBMIT_BLOCKED, SUBMIT_NOTE_MAX, SUBMIT_REASON_MAX, SUBMIT_REASON_MIN, type Blocker, type ClosingAction } from "@/lib/closing";
import type { CheckItem } from "@/lib/closing-checklist";
import { ApiError, api } from "@/lib/client";
import { ymKo } from "@/lib/format";
import { SELF_APPROVAL_HINT, selfApprovalText, type SelfApproval } from "@/lib/hq-summary";
import { APPROVAL_REF_MAX } from "@/lib/snapshot";
import { toast } from "./Nav";

type Props = { projectId: string; yearMonth: string; closingId?: string; actions: ClosingAction[]; valid: boolean;
  /** 처리 후 안내할 다음 처리할 달 */
  nextYm?: string | null;
  /** 승인 확인 패널 한 줄 요약 + 소명 없는 건수 (있으면 승인 사유 필수) + 자기 승인 경고(본인이 입력한 본사 지출 — 경고만, 차단 아님. otherHq: 다른 재무 승인 담당이 있음) */
  approveSummary?: { text: string; unexplained: number; selfApproval?: (SelfApproval & { otherHq: boolean }) | null } };

/** 처리 완료 안내 */
const DONE_TEXT: Record<ClosingAction, string> = {
  close: "마감했어요", submit: "상신했어요", reopen: "마감을 해제했어요", approve: "승인했어요", reject: "반려했어요", revoke: "승인을 취소했어요",
};

/** 상신본·승인본 저장 실패 안내 (처리 자체는 끝남) */
const SNAPSHOT_FAIL: Partial<Record<ClosingAction, string>> = {
  submit: "상신했지만 상신본 저장에 실패했어요. 다시 시도하거나 시스템 관리자에게 알려 주세요.",
  approve: "승인했지만 승인본 저장에 실패했어요. 다시 시도하거나 시스템 관리자에게 알려 주세요.",
};

/** 마감 버튼이 막힌 이유 (정산 검증 FALSE) */
const INVALID_REASON = "검증 불일치 — 마감 준비의 안내대로 결제방법·본사 구분을 고치세요.";

const STYLE: Record<ClosingAction, string> = {
  close: "btn-primary",
  submit: "btn-primary",
  reopen: "btn-secondary",
  approve: "btn-success",
  reject: "btn-danger",
  revoke: "btn-secondary text-status-rejected",
};

/** 입력 칸이 열리는 처리: 반려·승인 취소·마감 해제(사유 필수), 승인(결재 문서번호 선택·소명 없으면 사유 필수), 상신(메모 선택·미완료 항목 있으면 사유 필수) */
type Asking = "reject" | "revoke" | "reopen" | "approve" | "submit";
/** 사유 한 칸만 받는 처리의 문구 */
const REASON_UI: Record<"reject" | "revoke" | "reopen", { placeholder: string; label: string; button: string; cls: string }> = {
  reject: { placeholder: "반려 사유 (필수)", label: "반려 사유", button: "반려하기", cls: "btn-danger" },
  revoke: { placeholder: "승인 취소 사유 (필수)", label: "승인 취소 사유", button: "승인 취소하기", cls: "btn-danger" },
  reopen: { placeholder: "마감 해제 사유 (필수) — 기록에 남아요", label: "마감 해제 사유", button: "마감 해제하기", cls: "btn-secondary" },
};

/** 상신 전 확인 응답 (GET …/closings/[ym]/preflight) */
type Preflight = { blockers: Blocker[]; overridable: boolean; checks: CheckItem[]; summary: { ok: boolean; text: string } };

export function ClosingActions({ projectId, yearMonth, closingId, actions, valid, nextYm, approveSummary }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<null | Asking>(null);
  const [note, setNote] = useState("");
  const [approvalRef, setApprovalRef] = useState("");
  const [error, setError] = useState("");
  /** 상신 전 확인 결과 (미완료 항목) + 사유 */
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [reason, setReason] = useState("");
  /** 승인: 서버가 소명 없음으로 막은 경우(409 APPROVE_BLOCKED) — 화면 요약과 어긋나도 사유 칸을 연다 */
  const [approveNeedsNote, setApproveNeedsNote] = useState(false);

  const needNoteForApprove = (approveSummary?.unexplained ?? 0) > 0 || approveNeedsNote;
  const blockers = preflight?.blockers ?? [];
  const reasonOk = reason.trim().length >= SUBMIT_REASON_MIN && reason.trim().length <= SUBMIT_REASON_MAX;

  function reset() {
    setAsking(null);
    setNote("");
    setApprovalRef("");
    setReason("");
    setPreflight(null);
    setApproveNeedsNote(false);
  }

  /** 상신 버튼: 먼저 서버에 미완료 항목을 묻고 확인 패널을 연다 */
  async function openSubmit() {
    setBusy(true);
    setError("");
    try {
      const p = await api<Preflight>(`/api/projects/${projectId}/closings/${yearMonth}/preflight`);
      setPreflight(p);
      setAsking("submit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: ClosingAction) {
    setBusy(true);
    setError("");
    try {
      let res: { snapshot?: { id: string; version: number } | false } = {};
      if (action === "approve" || action === "reject" || action === "revoke") {
        res = await api(`/api/closings/${closingId}/review`, { method: "POST", json: { decision: action, note, ...(action === "approve" && approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}) } });
      } else if (action === "submit") {
        res = await api(`/api/projects/${projectId}/closings/${yearMonth}/submit`, {
          method: "POST",
          json: { ...(note.trim() ? { note: note.trim() } : {}), ...(blockers.length && reason.trim() ? { overrideReason: reason.trim() } : {}) },
        });
      } else if (action === "reopen") {
        res = await api(`/api/projects/${projectId}/closings/${yearMonth}/reopen`, { method: "POST", json: { reason: note.trim() } });
      } else {
        res = await api(`/api/projects/${projectId}/closings/${yearMonth}/${action}`, { method: "POST" });
      }
      reset();
      // 상신·승인은 됐지만 스냅샷 저장에 실패한 경우 — 처리는 그대로, 사용자에게 알린다
      if (res.snapshot === false && SNAPSHOT_FAIL[action]) toast(`${ymKo(yearMonth)} ${SNAPSHOT_FAIL[action]}`, undefined, { duration: 12000 });
      else toast(`${ymKo(yearMonth)} ${DONE_TEXT[action]}.`, nextYm && action !== "reopen" ? { label: `다음 처리할 달: ${ymKo(nextYm)} ›`, href: `/closing?ym=${nextYm}` } : undefined);
      router.refresh();
    } catch (e) {
      // 서버 가드에 걸리면 같은 패널에서 사유를 받는다 (확인 패널을 연 뒤 상황이 바뀐 경우)
      if (e instanceof ApiError && e.status === 409 && e.data.code === SUBMIT_BLOCKED) {
        const list = (e.data.blockers as Blocker[] | undefined) ?? [];
        setPreflight((p) => ({ blockers: list, overridable: e.data.overridable !== false, checks: p?.checks ?? [], summary: p?.summary ?? { ok: false, text: "" } }));
        setAsking("submit");
        setError(e.data.overridable === false ? e.message : "");
      } else if (e instanceof ApiError && e.status === 409 && e.data.code === "APPROVE_BLOCKED") {
        setApproveNeedsNote(true);
        setAsking("approve");
        setError(e.message);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (actions.length === 0) return null;

  return (
    // 사유 입력 중에는 줄 전체 폭을 쓴다 (옆 안내 글과 나란히 놓여 입력칸이 좁아지지 않게)
    <div className={`flex w-full flex-col items-stretch gap-1.5 ${asking ? "basis-full" : "sm:w-auto sm:items-end"}`}>
      {asking === "submit" ? (
        <div className="flex w-full flex-col gap-2" role="group" aria-label="상신 확인">
          {blockers.length > 0 ? (
            <div className="alert alert-warn block">
              <b>상신 전 확인할 항목 {blockers.length}건</b>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                {blockers.map((b, i) => <li key={`${b.code}-${i}`}>{b.message}</li>)}
              </ul>
              {preflight?.overridable !== false
                ? <div className="mt-1.5 text-xs">그래도 상신하려면 사유를 적으세요. 사유는 재무 승인 화면에 남습니다.</div>
                : <div className="mt-1.5 text-xs font-semibold">검증 불일치는 사유로 넘길 수 없습니다 — 마감 해제 후 고치고 다시 마감하세요.</div>}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{preflight?.summary.ok ? "확인할 항목이 없습니다." : "확인할 항목은 없지만 마감 준비 목록을 한 번 더 보세요."} 재무 승인 담당에게 상신합니다.</p>
          )}
          {blockers.length > 0 && preflight?.overridable !== false && (
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              그래도 상신하는 사유 (필수)
              <textarea className="input sm:text-sm" rows={2} value={reason} maxLength={SUBMIT_REASON_MAX} autoFocus
                placeholder="예: 업체 출입증 내역이 다음 주에 도착해 10월 내역에 합산 예정" onChange={(e) => setReason(e.target.value)} aria-label="그래도 상신하는 사유" />
              <span className="tabular text-right">{reason.trim().length}/{SUBMIT_REASON_MAX}{reason.trim().length > 0 && reason.trim().length < SUBMIT_REASON_MIN ? ` · ${SUBMIT_REASON_MIN}자 이상` : ""}</span>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            상신 메모 (선택) <span className="font-normal">반려 후 다시 상신하면 무엇을 고쳤는지 적어 주세요.</span>
            <textarea className="input sm:text-sm" rows={2} value={note} maxLength={SUBMIT_NOTE_MAX} autoFocus={blockers.length === 0}
              onChange={(e) => setNote(e.target.value)} aria-label="상신 메모 (선택)" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={reset}>취소</button>
            <button type="button" className="btn-primary" disabled={busy || (blockers.length > 0 && (preflight?.overridable === false || !reasonOk))} onClick={() => run("submit")}>
              {blockers.length > 0 ? "사유 적고 상신" : "상신하기"}
            </button>
          </div>
        </div>
      ) : asking === "approve" ? (
        <div className="flex w-full flex-col gap-2" role="group" aria-label="승인 확인">
          {approveSummary && <p className="tabular text-sm"><span className="text-xs text-fg-muted">승인 내용 · </span>{approveSummary.text}</p>}
          {approveSummary?.selfApproval && (
            <p className="text-xs" role="status">
              <span className="badge badge-warn mr-1 align-middle">자기 승인</span>
              <span className="tabular">{selfApprovalText(approveSummary.selfApproval)}</span>
              {approveSummary.selfApproval.otherHq && <span className="text-fg-muted"> · {SELF_APPROVAL_HINT}</span>}
            </p>
          )}
          {needNoteForApprove && (
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              <span><span className="badge badge-bad mr-1 align-middle">소명 없음 {approveSummary?.unexplained || ""}건</span>그래도 승인하는 사유 (필수) — 승인 기록에 남습니다.</span>
              <textarea className="input sm:text-sm" rows={2} value={note} autoFocus onChange={(e) => setNote(e.target.value)} aria-label="그래도 승인하는 사유" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            결재 문서번호 (선택) <span className="font-normal">BrityWorks 결재 문서번호. 승인 후에도 적거나 고칠 수 있어요.</span>
            <input className="input sm:text-sm" value={approvalRef} maxLength={APPROVAL_REF_MAX} placeholder="예: 2026-1005-0123" autoFocus={!needNoteForApprove}
              onChange={(e) => setApprovalRef(e.target.value)} aria-label="결재 문서번호 (선택)" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={reset}>취소</button>
            <button type="button" className="btn-success" disabled={busy || (needNoteForApprove && !note.trim())} onClick={() => run("approve")}>승인하기</button>
          </div>
        </div>
      ) : asking ? (
        <div className="flex w-full flex-col gap-2">
          <textarea className="input sm:text-sm" rows={2} placeholder={REASON_UI[asking].placeholder} value={note} maxLength={REOPEN_REASON_MAX}
            onChange={(e) => setNote(e.target.value)} autoFocus aria-label={REASON_UI[asking].label} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={reset}>취소</button>
            <button type="button" className={REASON_UI[asking].cls} disabled={busy || !note.trim()} onClick={() => run(asking)}>{REASON_UI[asking].button}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-1.5">
          {actions.map((a) => (
            <button key={a} type="button" className={STYLE[a]}
              disabled={busy || (a === "close" && !valid)}
              title={a === "close" && !valid ? INVALID_REASON : undefined}
              onClick={() => (a === "submit" ? openSubmit() : a === "reject" || a === "revoke" || a === "reopen" || a === "approve" ? setAsking(a) : run(a))}>
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      )}
      {actions.includes("close") && !valid && !asking && (
        <p className="text-right text-xs font-medium text-status-rejected sm:max-w-64">
          마감 불가 · {INVALID_REASON}
        </p>
      )}
      {error && <p className="text-xs text-status-rejected" role="alert">{error}</p>}
    </div>
  );
}
