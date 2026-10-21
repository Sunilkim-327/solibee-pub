"use client";

import { useEffect } from "react";

/** 새 버전 배포 뒤 이전 화면 조각(JS)을 못 불러오는 오류 — 화면을 연 채로 배포되면 생긴다 */
export const isChunkError = (e: unknown) =>
  /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    e instanceof Error ? `${e.name} ${e.message}` : String(e ?? ""),
  );

const KEY = "opex:chunk-reload";

/** 한 번만 새로고침 (계속 실패하면 반복하지 않음 — 1분 안 재시도 금지) */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* 저장소를 못 쓰면 그냥 새로고침 */
  }
  window.location.reload();
  return true;
}

/** 전역: 조각 불러오기 실패를 잡아 새 버전으로 새로고침 */
export function ChunkReload() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => { if (isChunkError(e.error ?? e.message)) reloadOnce(); };
    const onRejection = (e: PromiseRejectionEvent) => { if (isChunkError(e.reason)) reloadOnce(); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
