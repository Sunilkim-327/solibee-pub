"use client";

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * 스크롤 직후·손가락이 움직인 탭 무시 (실수로 스위치를 누르는 것 방지).
 * - 화면(또는 안쪽 스크롤 영역)이 멈춘 뒤 settleMs 안에 들어온 탭은 무시
 * - pointerdown→pointerup 사이에 slopPx 넘게 움직인 탭(살짝 끈 것)은 무시
 * - 키보드(Enter·Space)·보조기기 활성화(click.detail === 0)는 절대 막지 않는다
 * 가만히 있는 화면에서 보통 누르는 건 지연 없이 바로 실행된다.
 */

export const SETTLE_MS = 300;
export const SLOP_PX = 8;

export type TapVerdict = "ok" | "keyboard" | "scrolling" | "moved";
export type Point = { x: number; y: number };

/** 순수 판단: 이 탭을 실행할지 (ok·keyboard) 무시할지 (scrolling·moved) */
export function tapVerdict(input: {
  /** click.detail === 0 — 키보드·보조기기 활성화 */
  keyboard: boolean;
  now: number;
  /** 마지막 scroll 이벤트 시각 (없으면 -Infinity 등 아주 과거) */
  lastScrollAt: number;
  down: Point | null;
  up: Point | null;
  settleMs?: number;
  slopPx?: number;
}): TapVerdict {
  const { keyboard, now, lastScrollAt, down, up, settleMs = SETTLE_MS, slopPx = SLOP_PX } = input;
  if (keyboard) return "keyboard";
  if (now - lastScrollAt < settleMs) return "scrolling";
  if (down && up && Math.hypot(up.x - down.x, up.y - down.y) > slopPx) return "moved";
  return "ok";
}

// 마지막 scroll 시각 — 줄마다 리스너를 달지 않고 화면에 하나만 (캡처 단계라 안쪽 스크롤 영역의 scroll도 잡힌다)
let lastScrollAt = Number.NEGATIVE_INFINITY;
let subscribers = 0;
const onScroll = () => { lastScrollAt = performance.now(); };
function subscribe() {
  if (subscribers++ === 0) window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => { if (--subscribers === 0) window.removeEventListener("scroll", onScroll, { capture: true }); };
}

/**
 * 버튼에 펼쳐 쓰는 핸들러를 돌려준다: <button {...useScrollSettleGuard(fn)}>.
 * fn은 탭이 유효할 때(또는 키보드 활성화) click 이벤트와 함께 호출된다.
 */
export function useScrollSettleGuard<E extends HTMLElement = HTMLButtonElement>(
  onActivate: (e: ReactMouseEvent<E>) => void,
  opts: { settleMs?: number; slopPx?: number } = {},
) {
  const down = useRef<Point | null>(null);
  const up = useRef<Point | null>(null);
  const fn = useRef(onActivate);
  fn.current = onActivate;
  useEffect(subscribe, []);
  return {
    onPointerDown: (e: ReactPointerEvent<E>) => { down.current = { x: e.clientX, y: e.clientY }; up.current = null; },
    onPointerUp: (e: ReactPointerEvent<E>) => { up.current = { x: e.clientX, y: e.clientY }; },
    onPointerCancel: () => { down.current = null; up.current = null; },
    onClick: (e: ReactMouseEvent<E>) => {
      const v = tapVerdict({ keyboard: e.detail === 0, now: performance.now(), lastScrollAt, down: down.current, up: up.current, ...opts });
      down.current = null; up.current = null;
      if (v === "ok" || v === "keyboard") fn.current(e);
    },
  };
}
