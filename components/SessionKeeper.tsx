"use client";

import { useEffect } from "react";

const REFRESH_EVERY = 20 * 60 * 1000; // 활동 중이면 20분마다 접근 토큰 재발급 (수명 1시간)

/**
 * 로그인 유지 — 활동 중이거나 탭으로 돌아왔을 때 접근 토큰을 미리 재발급해 화면 이동·저장이 끊기지 않게.
 * 재발급이 거부되면(리프레시 14일·절대 30일 만료, 다른 기기에서 비밀번호 변경 등) 로그인 화면으로.
 */
export function SessionKeeper() {
  useEffect(() => {
    let lastRefresh = Date.now();
    const refresh = () => {
      lastRefresh = Date.now();
      fetch("/api/auth/refresh", { method: "POST" }).then((r) => {
        if (r.status === 401) window.location.href = "/login?expired=1";
      }).catch(() => undefined);
    };
    const onActivity = () => {
      if (Date.now() - lastRefresh > REFRESH_EVERY) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh > REFRESH_EVERY) refresh();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
