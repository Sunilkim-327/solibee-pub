import { describe, expect, it } from "vitest";
import { REFRESH_GRACE_MS, rotationDecision, type RefreshRow } from "@/lib/refresh-rotation";

const T0 = Date.UTC(2026, 9, 14, 0, 0, 0);
const row = (o: Partial<RefreshRow> = {}): RefreshRow => ({ userId: "u1", family: "f1", usedAt: null, exp: new Date(T0 + 14 * 86_400_000), ...o });

describe("리프레시 토큰 회전·재사용 탐지", () => {
  it("처음 쓰는 토큰은 회전", () => {
    expect(rotationDecision(row(), "u1", T0)).toBe("rotate");
  });
  it("방금(유예 안) 사용된 토큰은 새 토큰만 — 여러 탭의 동시 재발급", () => {
    expect(rotationDecision(row({ usedAt: new Date(T0) }), "u1", T0 + 1_000)).toBe("grace");
    expect(rotationDecision(row({ usedAt: new Date(T0) }), "u1", T0 + REFRESH_GRACE_MS)).toBe("grace");
  });
  it("유예가 지난 옛 토큰: 뒤 토큰이 이미 쓰였으면(또는 모르면) 탈취, 아무도 안 썼으면 잃어버린 쿠키로 보고 다시 발급", () => {
    expect(rotationDecision(row({ usedAt: new Date(T0) }), "u1", T0 + REFRESH_GRACE_MS + 1)).toBe("reuse");
    expect(rotationDecision(row({ usedAt: new Date(T0) }), "u1", T0 + 3 * 86_400_000, true)).toBe("reuse");
    expect(rotationDecision(row({ usedAt: new Date(T0) }), "u1", T0 + REFRESH_GRACE_MS + 1, false)).toBe("grace");
    expect(rotationDecision(row({ usedAt: new Date(T0) }), "u1", T0 + 3 * 86_400_000, false)).toBe("grace");
  });
  it("모르는·만료된·남의 토큰은 거부 (전체 로그아웃은 하지 않음)", () => {
    expect(rotationDecision(null, "u1", T0)).toBe("reject");
    expect(rotationDecision(row({ exp: new Date(T0) }), "u1", T0)).toBe("reject");
    expect(rotationDecision(row({ userId: "u2" }), "u1", T0)).toBe("reject");
    expect(rotationDecision(row({ userId: "u2", usedAt: new Date(T0 - 86_400_000) }), "u1", T0)).toBe("reject");
  });
});
