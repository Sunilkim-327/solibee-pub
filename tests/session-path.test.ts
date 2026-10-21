import { describe, expect, it } from "vitest";
import { loginUrl, nextPathOf, safeNextPath } from "@/lib/session-path";

describe("로그인 후 돌아올 경로", () => {
  it("경로와 쿼리를 유지하고 RSC 내부 파라미터는 뺀다", () => {
    expect(nextPathOf("/expenses", "?ym=2026-05&_rsc=abc")).toBe("/expenses?ym=2026-05");
    expect(nextPathOf("/monthly", "")).toBe("/monthly");
  });
  it("홈은 next 없이", () => {
    expect(nextPathOf("/", "?_rsc=1")).toBeNull();
    expect(loginUrl(null)).toBe("/login");
    expect(loginUrl("/")).toBe("/login");
  });
  it("돌아올 경로는 같은 사이트 상대 경로만 (//·역슬래시·제어문자·로그인 화면 거부)", () => {
    expect(safeNextPath("/settlement?ym=2026-05")).toBe("/settlement?ym=2026-05");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/"); // new URL("/\\evil.example", base) → https://evil.example/
    expect(safeNextPath("/\\/evil.example")).toBe("/");
    expect(safeNextPath("/\u0000/x")).toBe("/");
    expect(safeNextPath("/login?next=%2Fx")).toBe("/");
    expect(loginUrl("/\\evil.example")).toBe("/login");
  });
  it("다른 사이트 경로는 무시", () => {
    expect(loginUrl("//evil.example")).toBe("/login");
    expect(loginUrl("https://evil.example")).toBe("/login");
    expect(loginUrl("/settlement?ym=2026-05")).toBe("/login?next=%2Fsettlement%3Fym%3D2026-05");
  });
});
