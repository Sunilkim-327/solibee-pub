"use client";
// 상단 바 종 — 안 읽은 알림 수 배지. 누르면 알림 화면.
// 초깃값은 레이아웃이 서버에서 세어 준다. 이후 경로가 바뀔 때·탭이 다시 보일 때만 다시 센다 (폴링 없음)
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { BELL_ICON } from "./kinds";
import { refreshUnread, useUnread } from "./unread";

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const path = usePathname();
  const unread = useUnread(initialUnread);
  // 처음 그릴 때는 서버가 준 값을 쓰고, 경로가 바뀐 뒤부터 다시 센다 (StrictMode의 이중 effect에도 한 번만)
  const seen = useRef(path);
  useEffect(() => {
    if (seen.current === path) return;
    seen.current = path;
    void refreshUnread();
  }, [path]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") void refreshUnread(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const active = path === "/notifications" || path.startsWith("/notifications/");
  const n = unread ?? 0;
  return (
    <Link href="/notifications" title="알림" aria-label={n > 0 ? `알림 — 안 읽음 ${n}개` : "알림"} aria-current={active ? "page" : undefined}
      className={`relative flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors sm:size-8 ${
        active ? "bg-brand-50 text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
      }`}>
      <Icon d={BELL_ICON} box={24} sw={2} className="size-5" />
      {n > 0 && (
        <span aria-hidden className="tabular absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold leading-none text-on-primary sm:-right-1 sm:-top-1">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}
