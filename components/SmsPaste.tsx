"use client";

import { useState } from "react";
import { won } from "@/lib/format";
import { parseCardSmsBatch, type CardSms } from "@/lib/sms";
import { Icon } from "./icons";

/**
 * 카드 승인 문자 붙여넣기.
 * 버튼을 누르면 클립보드를 먼저 읽고(모바일 권한 허용 시), 안 되면 붙여넣기 창을 연다.
 */
export function SmsPaste({ onPick }: { onPick: (sms: CardSms, rest: CardSms[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  function apply(t: string) {
    const list = parseCardSmsBatch(t);
    if (!list.length) {
      setError("승인 금액을 찾지 못했습니다. 카드 승인 문자 전체를 붙여넣어 주세요.");
      setOpen(true);
      setText(t);
      return;
    }
    const usable = list.filter((s) => !s.cancelled);
    if (!usable.length) {
      setError("취소 문자만 있습니다. 취소된 결제는 입력하지 않아도 됩니다.");
      return;
    }
    setError("");
    setOpen(false);
    setText("");
    onPick(usable[0], usable.slice(1));
  }

  async function fromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) return apply(t);
    } catch {
      /* 권한 거부·미지원 → 직접 붙여넣기 */
    }
    setOpen(true);
  }

  return (
    <div>
      {/* 한 줄 버튼 — 문자를 복사해 두고 누르면 날짜·금액·가맹점이 채워진다 */}
      <button type="button" onClick={fromClipboard} aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-brand-100 bg-brand-50 px-3 text-left text-sm transition hover:bg-brand-100 sm:min-h-10">
        <Icon name="message" className="size-5 shrink-0 text-primary" />
        <span className="font-semibold text-primary">카드 문자 붙여넣기</span>
        <span className="ml-auto truncate text-xs text-fg-muted">날짜·금액·가맹점이 채워져요</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-3">
          <textarea autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)}
            className="input text-base sm:text-sm" placeholder={"승인 문자를 여기에 붙여넣으세요 (여러 건 가능)\n예) 신한카드(1234)승인 홍*동 12,000원(일시불)10/09 12:34 스타벅스"} />
          {error && <p className="mt-2 text-sm text-status-rejected" role="alert">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setError(""); }}>닫기</button>
            <button type="button" className="btn-primary" disabled={!text.trim()} onClick={() => apply(text)}>채우기</button>
          </div>
        </div>
      )}
      {!open && error && <p className="mt-2 text-sm text-status-rejected" role="alert">{error}</p>}
    </div>
  );
}

/** 문자에서 읽은 정보 요약 띠 */
export function SmsInfo({ sms, remaining, onNext, onClear }: { sms: CardSms; remaining: number; onNext?: () => void; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-muted px-3 py-2 text-sm" role="status">
      <span className="inline-flex items-center gap-1.5 font-semibold"><Icon name="message" className="size-4 text-primary" />문자로 채워짐</span>
      <span className="text-fg-muted">
        {[sms.cardCompany && `${sms.cardCompany}${sms.cardLast4 ? `(${sms.cardLast4})` : ""}`, sms.time, sms.installment, sms.amount !== null && `${won(sms.amount)}원`]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <span className="ml-auto flex items-center gap-1">
        {remaining > 0 && onNext && (
          <button type="button" className="btn-ghost btn-sm text-primary" onClick={onNext}>다음 문자 ({remaining}건 남음) →</button>
        )}
        <button type="button" className="btn-ghost btn-sm" onClick={onClear}>지우기</button>
      </span>
    </div>
  );
}
