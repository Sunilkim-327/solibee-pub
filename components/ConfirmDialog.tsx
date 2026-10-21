"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 브라우저 기본 confirm/prompt 대신 쓰는 앱 안 확인 대화상자.
// 사용: const { confirm, askReason, dialog } = useConfirm(); … return <>{…}{dialog}</>;
// 훅마다 자기 대화상자를 렌더하므로 레이아웃에 Provider를 둘 필요가 없다.

export type ConfirmOptions = {
  /** 대화상자 제목 (기본 "확인") */
  title?: string;
  /** 본문 — 줄바꿈(\n) 그대로 표시 */
  message: string;
  /** 확인 버튼 문구 (기본 "확인") */
  confirmLabel?: string;
  /** 파괴적 동작이면 확인 버튼을 빨간색으로 */
  danger?: boolean;
};

export type ReasonOptions = {
  title?: string;
  message: string;
  placeholder?: string;
  /** 빈 값이면 확인 버튼을 막는다 */
  required?: boolean;
  confirmLabel?: string;
};

type Kind = "confirm" | "reason" | "alert";
type Pending = {
  kind: Kind;
  opts: ConfirmOptions & { placeholder?: string; required?: boolean };
  /** 확인(ok)·취소로 끝냄 — text는 사유 입력값 */
  settle: (ok: boolean, text: string) => void;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);

  const finish = useCallback((ok: boolean, text = "") => {
    const p = current.current;
    if (!p) return;
    current.current = null;
    setPending(null);
    p.settle(ok, text);
  }, []);

  const open = useCallback((p: Pending) => {
    // 이미 열린 요청이 있으면 취소로 끝낸다 (Promise가 영영 안 끝나는 일 방지)
    current.current?.settle(false, "");
    current.current = p;
    setPending(p);
  }, []);

  /** window.confirm 대신 — 확인이면 true */
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => open({ kind: "confirm", opts, settle: (ok) => resolve(ok) })),
    [open],
  );
  /** window.prompt 대신 — 입력값, 취소면 null */
  const askReason = useCallback(
    (opts: ReasonOptions) => new Promise<string | null>((resolve) => open({ kind: "reason", opts, settle: (ok, text) => resolve(ok ? text : null) })),
    [open],
  );
  /** window.alert 대신 — 닫히면 끝남 */
  const alert = useCallback(
    (opts: Omit<ConfirmOptions, "danger">) => new Promise<void>((resolve) => open({ kind: "alert", opts, settle: () => resolve() })),
    [open],
  );

  // 언마운트 시 열린 요청은 취소로
  useEffect(() => () => { current.current?.settle(false, ""); current.current = null; }, []);

  const dialog = pending ? <ConfirmDialog key={pending.opts.message} pending={pending} onFinish={finish} /> : null;
  return { confirm, askReason, alert, dialog };
}

function ConfirmDialog({ pending, onFinish }: { pending: Pending; onFinish: (ok: boolean, text?: string) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [text, setText] = useState("");
  const { opts } = pending;
  const isReason = pending.kind === "reason";
  const blocked = isReason && !!opts.required && !text.trim();
  const danger = pending.kind === "confirm" && !!opts.danger;
  const title = opts.title ?? (pending.kind === "alert" ? "알림" : "확인");

  const state = useRef({ text, blocked, onFinish });
  state.current = { text, blocked, onFinish };

  // 닫히면 이전 포커스로 복귀
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);

  // Esc 취소 · Enter 확인 · Tab 가두기 — 캡처 단계에서 처리해 아래에 열린 Sheet가 같은 키에 반응하지 않게 한다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = panel.current;
      if (!el) return;
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        state.current.onFinish(false);
        return;
      }
      if (e.key === "Enter" && !e.isComposing) {
        // 버튼에 포커스가 있으면 그 버튼의 기본 동작(클릭)에 맡긴다
        if (document.activeElement instanceof HTMLButtonElement && el.contains(document.activeElement)) return;
        e.preventDefault(); e.stopPropagation();
        if (!state.current.blocked) state.current.onFinish(true, state.current.text);
        return;
      }
      if (e.key !== "Tab") return;
      e.stopPropagation();
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!el.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 sm:items-center" 
      // 포털이어도 React 이벤트는 부모로 전파되므로 여기서 끊는다
      onClick={(e) => { e.stopPropagation(); onFinish(false); }} onKeyDown={(e) => e.stopPropagation()}>
      <div ref={panel} tabIndex={-1} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-sheet outline-none sm:rounded-2xl"
        role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-m`}
        onClick={(e) => e.stopPropagation()}>
        <h3 id={`${id}-t`} className="mb-3 text-base font-bold">{title}</h3>
        <p id={`${id}-m`} className="whitespace-pre-line text-sm text-fg-muted">{opts.message}</p>
        {isReason && (
          <input className="input mt-3 w-full" autoFocus value={text} placeholder={opts.placeholder}
            aria-label={title} onChange={(e) => setText(e.target.value)} />
        )}
        <div className="mt-5 flex justify-end gap-2">
          {pending.kind !== "alert" && <button type="button" className="btn-secondary" onClick={() => onFinish(false)}>취소</button>}
          <button type="button" className={danger ? "btn-danger" : "btn-primary"} autoFocus={!isReason} disabled={blocked}
            onClick={() => onFinish(true, text)}>
            {opts.confirmLabel ?? "확인"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
