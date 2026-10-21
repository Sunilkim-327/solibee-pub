import { describe, expect, it } from "vitest";
import { loginBlocked, passwordProblem, tempPassword } from "@/lib/auth-policy";
import { buildTree, descendantIds, flattenTree, wouldCycle } from "@/lib/org";

describe("로그인 정책", () => {
  it("비밀번호 규칙", () => {
    expect(passwordProblem("short1")).not.toBeNull();
    expect(passwordProblem("onlyletters")).not.toBeNull();
    expect(passwordProblem("12345678")).not.toBeNull();
    expect(passwordProblem("abcd1234")).not.toBeNull(); // 2종 8자
    expect(passwordProblem("abcde12345")).toBeNull(); // 2종 10자
    expect(passwordProblem("Abcd1234")).toBeNull(); // 3종 8자
    expect(passwordProblem("Kim12345!", { loginId: "kim@example.com" })).toMatch(/아이디/);
    expect(passwordProblem("Ab!E2026001", { employeeNo: "E2026001" })).toMatch(/사번/);
  });

  it("임시 비밀번호는 규칙을 만족", () => {
    for (let i = 0; i < 50; i++) expect(passwordProblem(tempPassword())).toBeNull();
  });

  it("잠금(lockedUntil)은 시각이 지나면 풀린다", () => {
    const now = new Date("2026-10-09T09:00:00Z");
    const s = { active: true, lockedUntil: new Date("2026-10-09T09:15:00Z"), failedLogins: 0 };
    expect(loginBlocked(s, now)).toMatch(/잠겼습니다/);
    expect(loginBlocked(s, new Date("2026-10-09T09:16:00Z"))).toBeNull();
  });

  it("비활성 계정 차단", () => {
    expect(loginBlocked({ active: false, lockedUntil: null, failedLogins: 0 })).toMatch(/비활성/);
  });
});

describe("조직도 트리", () => {
  const depts = [
    { id: "co", name: "회사", parentId: null, order: 0 },
    { id: "biz", name: "사업본부", parentId: "co", order: 1 },
    { id: "mgmt", name: "경영지원본부", parentId: "co", order: 0 },
    { id: "fin", name: "재무팀", parentId: "mgmt", order: 0 },
    { id: "plat", name: "플랫폼사업팀", parentId: "biz", order: 0 },
  ];

  it("트리·경로·정렬", () => {
    const flat = flattenTree(buildTree(depts));
    expect(flat.map((d) => d.id)).toEqual(["co", "mgmt", "fin", "biz", "plat"]);
    expect(flat.find((d) => d.id === "plat")?.path).toBe("회사 > 사업본부 > 플랫폼사업팀");
    expect(flat.find((d) => d.id === "fin")?.depth).toBe(2);
  });

  it("하위 부서·순환 방지", () => {
    expect([...descendantIds(depts, "biz")].sort()).toEqual(["biz", "plat"]);
    expect(wouldCycle(depts, "biz", "plat")).toBe(true);
    expect(wouldCycle(depts, "biz", "biz")).toBe(true);
    expect(wouldCycle(depts, "plat", "mgmt")).toBe(false);
    expect(wouldCycle(depts, "plat", null)).toBe(false);
  });
});

describe("프로젝트 체계도(EPS) 부서", () => {
  it("사용 부서와 그 상위 경로만, 미사용 상위는 묶음으로", async () => {
    const { epsDepartments } = await import("@/lib/org");
    const depts = [
      { id: "co", parentId: null, epsEnabled: false },
      { id: "mgmt", parentId: "co", epsEnabled: false }, // 경영지원 — 프로젝트 없음
      { id: "fin", parentId: "mgmt", epsEnabled: false },
      { id: "biz", parentId: "co", epsEnabled: false }, // 본부 — 묶음
      { id: "plat", parentId: "biz", epsEnabled: true },
      { id: "data", parentId: "biz", epsEnabled: true },
    ];
    const r = epsDepartments(depts);
    expect(r.map((d) => `${d.id}${d.group ? "(묶음)" : ""}`)).toEqual(["co(묶음)", "biz(묶음)", "plat", "data"]);
  });
});
