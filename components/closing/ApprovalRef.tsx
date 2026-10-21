"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { APPROVAL_REF_MAX } from "@/lib/snapshot";
import { Icon } from "@/components/icons";
import { toast } from "@/components/Nav";

/** 승인된 달의 결재 문서번호 (BrityWorks) — 재무 승인만 고칠 수 있다 (PATCH /api/closings/[id]) */
export function ApprovalRef({ closingId, value, editable }: { closingId: string; value: string | null; editable: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/closings/${closingId}`, { method: "PATCH", json: { approvalRef: text.trim() } });
      setEditing(false);
      toast(text.trim() ? "결재 문서번호를 저장했어요." : "결재 문서번호를 지웠어요.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form className="flex flex-wrap items-center gap-1.5 text-sm" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <span className="text-xs text-fg-muted">결재 문서번호</span>
        <input className="input w-48 sm:text-sm" value={text} maxLength={APPROVAL_REF_MAX} autoFocus placeholder="BrityWorks 결재 문서번호"
          onChange={(e) => setText(e.target.value)} aria-label="결재 문서번호" />
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>저장</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(false); setText(value ?? ""); setError(""); }}>취소</button>
        {error && <span className="text-xs text-status-rejected" role="alert">{error}</span>}
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-xs text-fg-muted">결재 문서번호</span>
      {value ? <b className="tabular">{value}</b> : <span className="text-fg-subtle">아직 없음</span>}
      {editable && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)} aria-label="결재 문서번호 수정">
          <Icon name="pencil" />{value ? "수정" : "입력"}
        </button>
      )}
    </div>
  );
}
