"use client";

import { useState } from "react";
import { api } from "@/lib/client";

// 화면 안내용 규칙 점검 — 기준은 서버의 lib/auth-policy.ts passwordProblem (아이디·사번 포함 여부는 서버가 확인)
const KINDS = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];
function ruleState(pw: string) {
  const kinds = KINDS.filter((r) => r.test(pw)).length;
  return {
    kinds: kinds >= 2,
    length: pw.length >= (kinds >= 3 ? 8 : 10),
    max: pw.length <= 100,
    kindCount: kinds,
  };
}

function Rule({ ok, touched, children }: { ok: boolean; touched: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${!touched ? "text-fg-muted" : ok ? "text-status-approved" : "text-fg-muted"}`}>
      <span aria-hidden className={`flex size-4 shrink-0 items-center justify-center rounded-full text-xs font-bold leading-none ${
        touched && ok ? "bg-emerald-600 text-on-primary" : "border border-line-strong"
      }`}>{touched && ok ? "✓" : ""}</span>
      <span>{children}</span>
      <span className="sr-only">{touched && ok ? " (충족)" : " (미충족)"}</span>
    </li>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; describedBy?: string; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} className="input pr-16" autoComplete={autoComplete} value={value} autoFocus={autoFocus}
        aria-invalid={invalid || undefined} aria-describedby={describedBy} required autoCapitalize="none" spellCheck={false}
        onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="absolute inset-y-0 right-0 flex min-w-14 items-center justify-center rounded-r-lg px-3 text-label font-semibold text-fg-muted hover:text-fg"
        aria-pressed={show} aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShow((v) => !v)}>
        {show ? "숨기기" : "보기"}
      </button>
    </div>
  );
}

export default function PasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const rules = ruleState(next);
  const rulesOk = rules.kinds && rules.length && rules.max;
  const typed = next.length > 0;
  const match = confirm.length > 0 && confirm === next;
  const mismatch = confirm.length > 0 && confirm !== next;
  const sameAsCurrent = typed && next === current;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!rulesOk) return setError("새 비밀번호가 조건에 맞지 않습니다.");
    if (next !== confirm) return setError("새 비밀번호 확인이 일치하지 않습니다.");
    setBusy(true);
    setError("");
    try {
      await api("/api/account/password", { method: "POST", json: { current, next } });
      window.location.href = "/";
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("로그인")) window.location.href = "/login";
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-5">
          <h1 className="text-h1 font-bold">비밀번호 변경</h1>
          <p className="mt-1 text-sm text-fg-muted">새 비밀번호를 정하세요. 저장하면 다른 기기의 로그인은 모두 풀리고 이 브라우저만 유지돼요.</p>
        </div>
        <form onSubmit={submit} noValidate className="card space-y-5 p-5 sm:p-6">
          <div>
            <label className="label" htmlFor="cur">현재 비밀번호 <span className="font-normal text-fg-muted">(임시 비밀번호로 로그인했으면 그 비밀번호)</span></label>
            <PasswordInput id="cur" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus
              invalid={tried && !current} />
          </div>
          <div>
            <label className="label" htmlFor="new">새 비밀번호</label>
            <PasswordInput id="new" value={next} onChange={setNext} autoComplete="new-password" describedBy="pw-rules"
              invalid={tried && !rulesOk} />
            <ul id="pw-rules" className="mt-2 space-y-1 text-sm" aria-live="polite">
              <Rule ok={rules.kinds} touched={typed}>영문 대문자·소문자·숫자·특수문자 중 2종 이상</Rule>
              <Rule ok={rules.length} touched={typed}>
                {rules.kindCount >= 3 ? "3종 이상이면 8자 이상" : "2종이면 10자 이상 (3종 이상이면 8자)"}
                {typed && <span className="tabular"> · 지금 {next.length}자</span>}
              </Rule>
              <li className="pl-6 text-fg-muted">아이디·사번은 포함할 수 없어요.</li>
            </ul>
            {sameAsCurrent && <p className="mt-1 text-xs text-amber-800">현재 비밀번호와 같아요. 다른 비밀번호를 쓰세요.</p>}
          </div>
          <div>
            <label className="label" htmlFor="confirm">새 비밀번호 확인</label>
            <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" describedBy="pw-match"
              invalid={mismatch || (tried && !match)} />
            <p id="pw-match" className={`mt-1 min-h-4 text-xs ${match ? "text-status-approved" : mismatch ? "text-status-rejected" : "text-fg-muted"}`} aria-live="polite">
              {match ? "✓ 일치해요" : mismatch ? "새 비밀번호와 달라요" : ""}
            </p>
          </div>
          {error && <p className="alert alert-danger" role="alert">{error}</p>}
          <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
          <button type="button" className="btn-ghost w-full"
            onClick={async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>
            로그아웃
          </button>
        </form>
      </div>
    </main>
  );
}
