"use client";

import { useEffect, useRef } from "react";

/**
 * 가로 스크롤 표 래퍼 — 처음 그릴 때 [data-current] 칸이 보이도록 가운데로 스크롤 (연간 추이의 선택 월).
 * 고정 열(왼쪽 결제자·오른쪽 합계)에 가리지 않게 가운데 정렬한다.
 */
export function AutoScrollX({ children, className = "", watch }: { children: React.ReactNode; className?: string; watch?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const cell = box?.querySelector<HTMLElement>("[data-current]");
    if (!box || !cell) return;
    const left = cell.offsetLeft - (box.clientWidth - cell.offsetWidth) / 2;
    box.scrollLeft = Math.max(0, left);
  }, [watch]);
  return <div ref={ref} className={`overflow-x-auto ${className}`}>{children}</div>;
}
