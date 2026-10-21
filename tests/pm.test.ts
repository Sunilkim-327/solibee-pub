import { describe, expect, it, vi } from "vitest";
import { pmInvariantViolations, pmRoleChange, projectScopedUser, roleInProject, syncPmRoles } from "@/lib/pm";

describe("PM 지정 → 권한", () => {
  it("팀원이 PM으로 지정되면 PM 권한 부여", () => {
    expect(pmRoleChange("MEMBER", true, false)).toEqual({ role: "MANAGER", pmAutoGranted: true });
  });
  it("자동 부여된 PM이 모든 프로젝트에서 빠지면 회수", () => {
    expect(pmRoleChange("MANAGER", false, true)).toEqual({ role: "MEMBER", pmAutoGranted: false });
  });
  it("관리자가 직접 준 PM 권한은 유지", () => {
    expect(pmRoleChange("MANAGER", false, false)).toBeNull();
  });
  it("재무팀·관리자 역할은 변경하지 않음", () => {
    expect(pmRoleChange("HQ", true, false)).toBeNull();
    expect(pmRoleChange("ADMIN", true, false)).toBeNull();
  });
  it("이미 PM이면 변화 없음", () => {
    expect(pmRoleChange("MANAGER", true, true)).toBeNull();
  });
});

describe("프로젝트 안의 역할", () => {
  it("PM 권한이 있어도 PM이 아닌 프로젝트에서는 팀원", () => {
    expect(roleInProject("MANAGER", { isPm: false })).toBe("MEMBER");
    expect(roleInProject("MANAGER", { isPm: true })).toBe("MANAGER");
  });
  it("재무팀·관리자는 그대로", () => {
    expect(roleInProject("HQ", null)).toBe("HQ");
    expect(roleInProject("ADMIN", { isPm: false })).toBe("ADMIN");
  });
});

describe("프로젝트 안의 사용자 (projectScopedUser)", () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const active = { startDate: d("2026-01-01"), endDate: d("2026-12-31"), closedAt: null, archivedAt: null };
  const now = d("2026-06-15");
  const u = (role: "MEMBER" | "MANAGER" | "HQ" | "ADMIN"): { id: string; role: typeof role; readOnly?: boolean; readOnlyReason?: "view" | "closed" | "admin" } => ({ id: "u", role });

  it("구성원: 프로젝트 역할 반영", () => {
    expect(projectScopedUser(u("MANAGER"), active, { isPm: false }, now).user.role).toBe("MEMBER");
    expect(projectScopedUser(u("MANAGER"), active, { isPm: true }, now).user).toEqual({ id: "u", role: "MANAGER" });
  });
  it("구성원이 아니면 PM 화면을 조회 전용으로", () => {
    expect(projectScopedUser(u("MEMBER"), active, null, now).user).toEqual({ id: "u", role: "MANAGER", readOnly: true, readOnlyReason: "view" });
  });
  it("재무팀은 역할 그대로", () => {
    expect(projectScopedUser(u("HQ"), active, null, now).user).toEqual({ id: "u", role: "HQ" });
  });
  it("관리자는 프로젝트 데이터 조회 전용 (admin)", () => {
    expect(projectScopedUser(u("ADMIN"), active, null, now).user).toEqual({ id: "u", role: "ADMIN", readOnly: true, readOnlyReason: "admin" });
  });
  it("종료된 프로젝트는 모두 조회 전용", () => {
    const closed = { ...active, closedAt: d("2026-06-01") };
    const r = projectScopedUser(u("ADMIN"), closed, null, now);
    expect(r.phase).toBe("CLOSED");
    expect(r.user).toMatchObject({ role: "ADMIN", readOnly: true, readOnlyReason: "closed" });
    expect(projectScopedUser(u("MEMBER"), closed, null, now).user.readOnlyReason).toBe("closed");
  });
});

describe("PM 권한 일괄 동기화 (syncPmRoles)", () => {
  it("한 번에 읽고 바뀌는 사용자만 갱신", async () => {
    const users = [
      { id: "a", name: "가", role: "MEMBER", pmAutoGranted: false },
      { id: "b", name: "나", role: "MANAGER", pmAutoGranted: true },
      { id: "c", name: "다", role: "MANAGER", pmAutoGranted: true },
    ];
    const updates: unknown[] = [];
    const db = {
      user: {
        findMany: vi.fn(async () => users),
        update: vi.fn(async (x: unknown) => updates.push(x)),
      },
      projectMember: { findMany: vi.fn(async () => [{ userId: "a" }, { userId: "c" }]) },
    };
    const changes = await syncPmRoles(db as never, ["a", "b", "c", "a", "x"]);
    expect(changes).toEqual([
      { userId: "a", name: "가", from: "MEMBER", to: "MANAGER" },
      { userId: "b", name: "나", from: "MANAGER", to: "MEMBER" },
    ]);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.projectMember.findMany).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(2);
  });
  it("대상이 없으면 조회하지 않음", async () => {
    const db = { user: { findMany: vi.fn() }, projectMember: { findMany: vi.fn() } };
    expect(await syncPmRoles(db as never, [])).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("역할 ↔ PM 지정 불변식 (pmInvariantViolations)", () => {
  const u = (id: string, role: string, pmAutoGranted = false) => ({ id, name: id, role, pmAutoGranted });
  it("맞으면 빈 목록", () => {
    const users = [u("pm", "MANAGER", true), u("fixed", "MANAGER"), u("m", "MEMBER"), u("hq", "HQ"), u("admin", "ADMIN")];
    expect(pmInvariantViolations(users, [{ userId: "pm", isPm: true }, { userId: "fixed", isPm: false }, { userId: "m", isPm: false }])).toEqual([]);
  });
  it("PM으로 지정됐는데 MANAGER가 아님 → PM_ROLE (HQ·ADMIN 포함)", () => {
    const out = pmInvariantViolations([u("m", "MEMBER"), u("hq", "HQ")], [{ userId: "m", isPm: true }, { userId: "m", isPm: true }, { userId: "hq", isPm: true }]);
    expect(out).toEqual([
      { userId: "m", name: "m", role: "MEMBER", pmProjects: 2, kind: "PM_ROLE" },
      { userId: "hq", name: "hq", role: "HQ", pmProjects: 1, kind: "PM_ROLE" },
    ]);
  });
  it("자동 부여 PM인데 어느 프로젝트에서도 PM이 아님 → STALE_AUTO_GRANT (pmRoleChange가 MEMBER로 되돌리는 상태)", () => {
    const out = pmInvariantViolations([u("x", "MANAGER", true)], [{ userId: "x", isPm: false }]);
    expect(out.map((v) => v.kind)).toEqual(["STALE_AUTO_GRANT"]);
    expect(pmRoleChange("MANAGER", false, true)).toEqual({ role: "MEMBER", pmAutoGranted: false });
  });
  it("자동 부여 표시가 MANAGER 아닌 역할에 남음 → AUTO_GRANT_FLAG (한 사람에 중복 보고 없음)", () => {
    expect(pmInvariantViolations([u("y", "MEMBER", true)], []).map((v) => v.kind)).toEqual(["AUTO_GRANT_FLAG"]);
    expect(pmInvariantViolations([u("z", "MEMBER", true)], [{ userId: "z", isPm: true }]).map((v) => v.kind)).toEqual(["PM_ROLE", "AUTO_GRANT_FLAG"]);
  });
});
