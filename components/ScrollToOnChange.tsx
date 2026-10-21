"use client";

import { useEffect, useRef } from "react";

/**
 * 좁은 화면(목록 아래·상세 위로 쌓이는 배치)에서 선택이 바뀌면 상세로 스크롤.
 * 처음 열 때는 움직이지 않고, dep(선택한 달 등)가 바뀔 때만. PC(lg 이상)는 상세가 옆에 고정이라 움직이지 않는다.
 */
export function ScrollToOnChange({ targetId, dep }: { targetId: string; dep: string }) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [dep, targetId]);
  return null;
}
