"use client";

import { useEffect } from "react";

/** 저장하지 않은 변경이 있으면 새로고침·탭 닫기 때 브라우저가 경고한다 */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/**
 * 설정 카드 하단 저장 바. 변경이 있으면 카드 안에서 화면 아래에 붙어 따라오고(sticky),
 * [변경 취소]·[저장]과 "저장하지 않은 변경" 안내를 보여 준다. 저장 안 한 채 떠나면 경고.
 * 카드는 overflow-hidden 대신 overflow-clip을 써야 sticky가 동작한다.
 */
export function SaveBar({ dirty, busy, onSave, onReset, label = "저장", status, note, alwaysEnabled }: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  /** 변경 취소 — 저장 전 편집 버리기 (없으면 버튼 숨김) */
  onReset?: () => void;
  label?: string;
  /** useRun의 결과 메시지 */
  status?: React.ReactNode;
  /** 변경이 없을 때 왼쪽에 보일 안내 (예: "2개 항목 노출") */
  note?: React.ReactNode;
  /** 변경 여부와 관계없이 저장 가능 (예: 켜기/끄기 설정) */
  alwaysEnabled?: boolean;
}) {
  useUnsavedWarning(dirty && !busy);
  return (
    <div data-bottom-bar={dirty || undefined} className={`z-10 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 sm:px-5 ${
      dirty
        ? "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] border-primary/30 bg-brand-50/95 backdrop-blur lg:bottom-0"
        : "border-line"
    }`}>
      <div className="min-w-0 flex-1 text-sm" aria-live="polite">
        {status ?? (dirty
          ? <span className="font-semibold text-primary">저장하지 않은 변경이 있어요</span>
          : note && <span className="text-xs text-fg-muted">{note}</span>)}
      </div>
      {dirty && onReset && (
        <button type="button" className="btn-ghost" disabled={busy} onClick={onReset}>변경 취소</button>
      )}
      <button type="button" className="btn-primary" disabled={busy || (!dirty && !alwaysEnabled)} onClick={onSave}>
        {busy ? "저장 중…" : label}
      </button>
    </div>
  );
}
