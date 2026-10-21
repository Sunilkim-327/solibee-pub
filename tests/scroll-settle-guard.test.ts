import { describe, expect, it } from "vitest";
import { SETTLE_MS, SLOP_PX, tapVerdict } from "@/components/hooks/useScrollSettleGuard";

// 스위치 실수 탭 방지 — 순수 판단 함수
describe("스크롤 직후·끌린 탭 무시", () => {
  const still = Number.NEGATIVE_INFINITY;
  const p = (x: number, y: number) => ({ x, y });

  it("가만히 있는 화면에서 보통 탭은 바로 실행", () => {
    expect(tapVerdict({ keyboard: false, now: 1000, lastScrollAt: still, down: p(10, 10), up: p(12, 11) })).toBe("ok");
    // 포인터 위치를 모르는 경우(합성 click)도 실행
    expect(tapVerdict({ keyboard: false, now: 1000, lastScrollAt: still, down: null, up: null })).toBe("ok");
  });

  it("스크롤이 멈춘 뒤 300ms 안의 탭은 무시, 그 뒤는 실행", () => {
    expect(SETTLE_MS).toBe(300);
    expect(tapVerdict({ keyboard: false, now: 1000, lastScrollAt: 900, down: p(0, 0), up: p(0, 0) })).toBe("scrolling");
    expect(tapVerdict({ keyboard: false, now: 1299, lastScrollAt: 1000, down: p(0, 0), up: p(0, 0) })).toBe("scrolling");
    expect(tapVerdict({ keyboard: false, now: 1300, lastScrollAt: 1000, down: p(0, 0), up: p(0, 0) })).toBe("ok");
    // 기준은 조정 가능
    expect(tapVerdict({ keyboard: false, now: 1100, lastScrollAt: 1000, down: null, up: null, settleMs: 50 })).toBe("ok");
  });

  it("누르고 떼는 사이 몇 px 넘게 움직인 탭(살짝 끈 것)은 무시", () => {
    expect(SLOP_PX).toBe(8);
    expect(tapVerdict({ keyboard: false, now: 1000, lastScrollAt: still, down: p(10, 10), up: p(10, 30) })).toBe("moved");
    expect(tapVerdict({ keyboard: false, now: 1000, lastScrollAt: still, down: p(10, 10), up: p(16, 15) })).toBe("ok"); // ≈7.8px
    expect(tapVerdict({ keyboard: false, now: 1000, lastScrollAt: still, down: p(10, 10), up: p(10, 13), slopPx: 2 })).toBe("moved");
  });

  it("키보드·보조기기 활성화(click.detail 0)는 스크롤 중이거나 움직였어도 절대 막지 않는다", () => {
    expect(tapVerdict({ keyboard: true, now: 1000, lastScrollAt: 990, down: p(0, 0), up: p(50, 50) })).toBe("keyboard");
  });

  it("스크롤 직후면 움직임보다 스크롤 사유를 먼저 알린다", () => {
    expect(tapVerdict({ keyboard: false, now: 1000, lastScrollAt: 990, down: p(0, 0), up: p(50, 50) })).toBe("scrolling");
  });
});
