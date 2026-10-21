import { describe, expect, it } from "vitest";
import { canManageProjectSettings } from "@/lib/rules";
import { accountStatus, filterUsers, projectSetupIssues, tempPasswordCsv } from "@/lib/user-admin";

const now = new Date("2026-03-10T12:00:00Z");
const base = { active: true, mustChangePassword: false, lockedUntil: null, tempPasswordExpiresAt: null };

describe("계정 상태", () => {
  it("연동으로 만든 계정(만료 epoch 0)과 만료 시각 없는 계정은 미발급", () => {
    expect(accountStatus({ ...base, mustChangePassword: true, tempPasswordExpiresAt: new Date(0) }, now)).toBe("NOT_ISSUED");
    expect(accountStatus({ ...base, mustChangePassword: true, tempPasswordExpiresAt: new Date(0).toISOString() }, now)).toBe("NOT_ISSUED");
    expect(accountStatus({ ...base, mustChangePassword: true }, now)).toBe("NOT_ISSUED");
  });
  it("임시 비밀번호 유효·만료 구분", () => {
    expect(accountStatus({ ...base, mustChangePassword: true, tempPasswordExpiresAt: "2026-03-11T00:00:00Z" }, now)).toBe("TEMP");
    expect(accountStatus({ ...base, mustChangePassword: true, tempPasswordExpiresAt: "2026-03-10T11:59:59Z" }, now)).toBe("TEMP_EXPIRED");
  });
  it("비활성 > 잠김 > 비밀번호 상태 순서", () => {
    const locked = { ...base, mustChangePassword: true, lockedUntil: "2026-03-10T12:10:00Z" };
    expect(accountStatus({ ...locked, active: false }, now)).toBe("INACTIVE");
    expect(accountStatus(locked, now)).toBe("LOCKED");
    expect(accountStatus({ ...base, lockedUntil: "2026-03-10T11:00:00Z" }, now)).toBe("IN_USE");
  });
});

describe("사용자 목록 필터", () => {
  const depts = [
    { id: "root", name: "본부", parentId: null, order: 0 },
    { id: "team", name: "팀", parentId: "root", order: 0 },
    { id: "other", name: "다른팀", parentId: null, order: 1 },
  ];
  const u = (id: string, x: Partial<{ departmentId: string | null; role: string; active: boolean; mustChangePassword: boolean; tempPasswordExpiresAt: string | null }>) => ({
    ...base, id, name: `사용자${id}`, loginId: `${id}@example.com`, employeeNo: null, departmentId: null, role: "MEMBER", ...x,
  });
  const users = [
    u("a", { departmentId: "root", role: "MANAGER" }),
    u("b", { departmentId: "team", mustChangePassword: true, tempPasswordExpiresAt: new Date(0).toISOString() }),
    u("c", { departmentId: "other" }),
    u("d", { departmentId: "team", active: false }),
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("부서는 하위 부서 포함, 비활성은 기본 제외", () => {
    expect(ids(filterUsers(users, depts, { deptId: "root" }, now))).toEqual(["a", "b"]);
    expect(ids(filterUsers(users, depts, { deptId: "root", includeInactive: true }, now))).toEqual(["a", "b", "d"]);
  });
  it("역할·상태·검색", () => {
    expect(ids(filterUsers(users, depts, { role: "MANAGER" }, now))).toEqual(["a"]);
    expect(ids(filterUsers(users, depts, { status: "NOT_ISSUED" }, now))).toEqual(["b"]);
    expect(ids(filterUsers(users, depts, { status: "INACTIVE" }, now))).toEqual(["d"]);
    expect(ids(filterUsers(users, depts, { q: "C@EXAMPLE" }, now))).toEqual(["c"]);
  });
});

describe("임시 비밀번호 CSV", () => {
  it("UTF-8 BOM + 헤더, 쉼표·따옴표는 감싼다", () => {
    const csv = tempPasswordCsv([{ name: '홍,"길동"', loginId: "a@example.com", tempPassword: "Ab3defgh2k" }]);
    expect(csv.startsWith("﻿이름,아이디(이메일),임시 비밀번호,만료 시각\r\n")).toBe(true);
    expect(csv).toContain('"홍,""길동""",a@example.com,Ab3defgh2k,');
  });
  it("수식으로 읽힐 첫 글자는 작은따옴표로 막는다", () => {
    const csv = tempPasswordCsv([{ name: "=HYPERLINK(1)", loginId: "@x", tempPassword: "-1" }]);
    expect(csv).toContain("'=HYPERLINK(1),'@x,'-1,");
  });
});

describe("프로젝트 시작 준비", () => {
  it("예산·PM 미비만 알려준다 (구성원·팀원 항목은 선택)", () => {
    expect(projectSetupIssues({ budgetLines: 0, members: [] })).toEqual(["NO_BUDGET", "NO_PM"]);
    // 구성원 0명(PM만)·팀원 지출 항목 없음은 정상 운영 형태 — 준비 필요가 아니다
    expect(projectSetupIssues({ budgetLines: 3, members: [{ isPm: true }] })).toEqual([]);
    expect(projectSetupIssues({ budgetLines: 3, members: [{ isPm: true }, { isPm: false }] })).toEqual([]);
  });
  it("팀원 입력 항목은 이 프로젝트 PM만 설정한다 (재무팀·관리자 불가)", () => {
    expect(canManageProjectSettings("MANAGER")).toBe(true);
    expect(canManageProjectSettings("HQ")).toBe(false);
    expect(canManageProjectSettings("ADMIN")).toBe(false);
    expect(canManageProjectSettings("MEMBER")).toBe(false);
  });
});
