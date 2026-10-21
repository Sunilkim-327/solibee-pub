"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/client";
import { safeNextPath } from "@/lib/session-path";

const DEMO = [
  ["프로젝트 PM", "pm@opex.local"],
  ["팀원", "member1@opex.local"],
  ["재무 승인", "hq@opex.local"],
  ["시스템 관리자", "admin@opex.local"],
] as const;

/** 아이디 저장 — 이 브라우저에만 (비밀번호는 저장하지 않음, 공용 PC를 위해 기본은 꺼짐) */
const SAVED_ID_KEY = "opex:savedLoginId";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/");
  const [remember, setRemember] = useState(false);
  // 세션 만료로 돌아온 경우(?expired=1) — 왜 로그인 화면인지 알려 준다
  const [expired, setExpired] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setNext(safeNextPath(sp.get("next")));
    setExpired(sp.get("expired") === "1");
    try {
      const saved = localStorage.getItem(SAVED_ID_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
        pwRef.current?.focus();
      }
    } catch { /* 저장소를 못 쓰면 매번 입력 */ }
  }, []);

  async function submit(e?: React.FormEvent, creds?: { loginId: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", json: creds ?? { loginId: email, password } });
      if (!creds) {
        try {
          if (remember) localStorage.setItem(SAVED_ID_KEY, email.trim());
          else localStorage.removeItem(SAVED_ID_KEY);
        } catch { /* 저장 실패는 무시 */ }
      }
      window.location.href = next;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo sub={false} size="lg" />
          <h1 className="text-h1 font-bold">운영비 정산</h1>
          <p className="text-sm text-fg-muted">프로젝트 운영비 입력 · 정산 · 상신</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6">
          <div>
            <label className="label" htmlFor="email">아이디(이메일) 또는 사번</label>
            <input id="email" type="text" inputMode="email" className="input" placeholder="name@example.com" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="password">비밀번호</label>
            <input ref={pwRef} id="password" type="password" className="input" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <label className="-my-1 flex min-h-10 w-fit cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" className="size-4" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            아이디 저장
          </label>
          {expired && !error && <p className="alert alert-info" role="status">로그인이 만료되었습니다. 다시 로그인하면 보던 화면으로 돌아갑니다.</p>}
          {error && <p className="alert alert-danger" role="alert">{error}</p>}
          <button className="btn-primary btn-lg w-full" disabled={busy}>
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>

        {process.env.NODE_ENV !== "production" && (
          <div className="mt-6">
            <p className="mb-2 text-center text-xs text-fg-muted">데모 계정 (비밀번호 password123)</p>
            <div className="grid grid-cols-4 gap-2">
              {DEMO.map(([label, demoEmail]) => (
                <button key={demoEmail} type="button" className="btn-secondary px-2" disabled={busy}
                  onClick={() => submit(undefined, { loginId: demoEmail, password: "password123" })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
