"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type RunMessage = { ok: boolean; text: string };

/** 결과 메시지 색 — 화면마다 기존 색을 유지하기 위해 지정할 수 있다 (size: 글자 크기, 기본 text-sm) */
export type RunColors = { ok: string; error: string; size?: string };
export const STATUS_COLORS: RunColors = { ok: "text-status-approved", error: "text-status-rejected" };

/** 실행 옵션 — refresh: 성공 시 router.refresh() (기본 true) */
export type RunOptions = { refresh?: boolean };

/** 성공 메시지는 잠깐 보여 주고 사라진다 (오류는 다음 동작까지 남김) */
export const OK_MESSAGE_MS = 2500;

/**
 * 비동기 동작 실행 훅: 진행 중(busy) 표시, 성공/실패 메시지(view), 성공 시 router.refresh().
 * - run: 성공하면 fn의 결과, 실패하면 null
 * - act: 성공 여부(boolean)
 * ok 메시지를 주면 성공 시 표시하고 OK_MESSAGE_MS 뒤 자동으로 지운다.
 * 이미 실행 중이면 새 호출은 실행하지 않고 실패로 돌려준다 (두 번 눌러 중복 생성 방지).
 */
export function useRun(colors: RunColors = STATUS_COLORS) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<RunMessage | null>(null);
  const [fading, setFading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // busy state는 다음 렌더 전까지 반영되지 않으므로 중복 실행은 ref로 막는다
  const inflight = useRef(false);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);
  // 성공 메시지: 잠시 뒤 흐려지며 사라짐
  useEffect(() => {
    clearTimers();
    setFading(false);
    if (!msg?.ok) return;
    timers.current.push(setTimeout(() => setFading(true), OK_MESSAGE_MS - 400));
    timers.current.push(setTimeout(() => setMsg(null), OK_MESSAGE_MS));
  }, [msg]);

  async function attempt<T>(fn: () => Promise<T>, ok?: string, opts?: RunOptions): Promise<{ done: true; value: T } | { done: false }> {
    if (inflight.current) return { done: false };
    inflight.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const value = await fn();
      if (ok) setMsg({ ok: true, text: ok });
      if (opts?.refresh !== false) router.refresh();
      return { done: true, value };
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return { done: false };
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  async function run<T>(fn: () => Promise<T>, ok?: string, opts?: RunOptions): Promise<T | null> {
    const r = await attempt(fn, ok, opts);
    return r.done ? r.value : null;
  }

  async function act(fn: () => Promise<unknown>, ok?: string, opts?: RunOptions): Promise<boolean> {
    return (await attempt(fn, ok, opts)).done;
  }

  const view = msg && (
    <span role={msg.ok ? "status" : "alert"}
      className={`${colors.size ?? "text-sm"} transition-opacity duration-300 ${fading ? "opacity-0" : "opacity-100"} ${msg.ok ? colors.ok : colors.error}`}>
      {msg.text}
    </span>
  );
  return { run, act, busy, view, msg, setMsg };
}
