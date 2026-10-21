"use client";
// 안 읽은 알림 수 — 상단 종·모바일 메뉴가 같이 쓰는 값.
// 바꾼 곳(종의 갱신, 알림 화면의 읽음 처리)이 이벤트로 알리고, 보여 주는 곳은 useUnread로 받는다.
// 주기 폴링은 하지 않는다 (무료 요금제 CPU 예산) — 경로가 바뀔 때·탭이 다시 보일 때만 갱신.
import { useEffect, useState } from "react";

const EVENT = "opex:unread";
/** 마지막으로 알린 값 — 나중에 붙는 컴포넌트도 받을 수 있게. undefined = 아직 없음 */
let last: number | null | undefined;

/** null = 모름(요청 실패) → 배지를 숨긴다 */
export function publishUnread(n: number | null) {
  last = n;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<number | null>(EVENT, { detail: n }));
}

/** GET /api/notifications로 안 읽은 수를 다시 센다. 실패(백엔드 없음·세션 만료 등)하면 조용히 배지만 숨긴다 */
export async function refreshUnread(): Promise<void> {
  try {
    const res = await fetch("/api/notifications", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) { publishUnread(null); return; }
    const data = (await res.json()) as { unread?: unknown };
    publishUnread(typeof data.unread === "number" ? data.unread : null);
  } catch {
    publishUnread(null);
  }
}

/** 안 읽은 수 (서버가 준 초깃값에서 시작, 이후 이벤트로 갱신). null이면 배지 숨김 */
export function useUnread(initial: number): number | null {
  const [n, setN] = useState<number | null>(initial);
  useEffect(() => setN(initial), [initial]);
  useEffect(() => {
    if (last !== undefined) setN(last);
    const on = (e: Event) => setN((e as CustomEvent<number | null>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return n;
}
