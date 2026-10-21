import { describe, expect, it } from "vitest";
import { normalizeSoliday, planSync, summarize, unwrap, type ExDept, type ExUser } from "@/lib/directory";

// 가상의 Soliday 응답 (실데이터 아님)
const depts = {
  departments: [
    { id: "s-co", departmentCode: "100", departmentName: "가상회사", departmentLevel: 0, parentId: null, hidden: false },
    { id: "s-biz", departmentCode: "200", departmentName: "사업본부", departmentLevel: 1, parentId: "s-co", hidden: false },
    { id: "s-dev", departmentCode: "210", departmentName: "개발팀", departmentLevel: 2, parentId: "s-biz", hidden: false },
  ],
};
const emps = {
  employees: [
    { id: "e1", fullName: "가나다", emailAddress: "A@x.test", employeeNumber: null, employeeStatus: "ACTIVE", department: { departmentCode: "210" }, title: { titleName: "책임" }, joinDate: "2021-03-02T00:00:00.000Z" },
    { id: "e2", fullName: "라마바", emailAddress: "b@x.test", employeeNumber: null, employeeStatus: "ON_LEAVE", department: { departmentCode: "210" }, title: { titleName: "사원" } },
    { id: "e3", fullName: "사아자", emailAddress: "c@x.test", employeeNumber: null, employeeStatus: "RESIGNED", department: { departmentCode: "200" }, title: null },
  ],
};

const src = normalizeSoliday(unwrap(depts, "departments"), unwrap(emps, "employees"));

describe("Soliday 정규화", () => {
  it("이메일 소문자·재직상태·직위", () => {
    expect(src.users.map((u) => [u.email, u.active, u.position])).toEqual([
      ["a@x.test", true, "책임"],
      ["b@x.test", true, "사원"], // 휴직 = 계정 유지
      ["c@x.test", false, null],
    ]);
    expect(src.departments.find((d) => d.code === "210")?.parentExternalId).toBe("s-biz");
  });
  it("입사일은 날짜만 (없으면 null)", () => {
    expect(src.users.map((u) => u.joinDate)).toEqual(["2021-03-02", null, null]);
  });
  it("배열·래핑 모두 허용", () => {
    expect(unwrap([1, 2], "x")).toEqual([1, 2]);
    expect(() => unwrap({}, "employees")).toThrow();
  });
});

describe("아이디", () => {
  it("이메일 주소(소문자)를 아이디로", () => {
    expect(src.users.map((u) => u.loginId)).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
  });
  it("같은 아이디를 다른 계정이 쓰면 건너뜀", () => {
    const base = { employeeNo: null, departmentId: null, position: null, joinDate: null, active: true, externalId: null, externalSource: null, employmentStatus: null };
    const plan = planSync(src, {
      departments: [],
      users: [
        { ...base, id: "x", name: "기존A", email: "a@other.test", loginId: "zz@other.test" },
        { ...base, id: "y", name: "다른사람", email: null, loginId: "a@x.test" },
      ],
    });
    // a@x.test(아이디 a)는 이메일이 다르지만 아이디 a가 y와 일치 → y에 연결
    expect(plan.users.update.some((u) => u.id === "y")).toBe(true);
  });
});

describe("변경 계획", () => {
  it("빈 DB → 전부 생성", () => {
    const s = summarize(planSync(src, { departments: [], users: [] }));
    expect(s.departments).toEqual({ create: 3, update: 0, deactivate: 0 });
    expect(s.users).toEqual({ create: 3, update: 0, deactivate: 0 });
  });

  it("부서코드·이메일로 기존 항목에 연결하고, 빠진 연동 사용자는 비활성화", () => {
    const exDepts: ExDept[] = [
      { id: "d1", code: "210", name: "개발1팀", parentId: null, order: 0, active: true, externalId: null, level: null },
      { id: "d9", code: "999", name: "폐지부서", parentId: null, order: 0, active: true, externalId: "s-old", level: 2 },
      { id: "d8", code: "LOCAL", name: "앱 자체 부서", parentId: null, order: 0, active: true, externalId: null, level: null },
    ];
    const base = { employeeNo: null, departmentId: null, position: null, joinDate: null, active: true, externalId: null, externalSource: null, employmentStatus: null, loginId: null };
    const exUsers: ExUser[] = [
      { ...base, id: "u1", name: "가나다", email: "a@x.test" },
      { ...base, id: "u7", name: "퇴사자", email: "gone@x.test", externalId: "e-gone", externalSource: "soliday" },
      { ...base, id: "u8", name: "관리자", email: "admin@local" },
    ];
    const plan = planSync(src, { departments: exDepts, users: exUsers });
    const dev = plan.departments.update.find((u) => u.id === "d1");
    expect(dev?.changes).toEqual(expect.arrayContaining(["부서명", "연동키", "상위부서"]));
    expect(plan.departments.create.map((d) => d.code)).toEqual(["100", "200"]);
    expect(plan.departments.deactivate.map((d) => d.id)).toEqual(["d9"]); // 자체 부서(d8)는 유지
    expect(plan.users.update.find((u) => u.id === "u1")?.changes).toEqual(expect.arrayContaining(["직급", "연동키", "부서", "아이디"]));
    expect(plan.users.deactivate.map((u) => u.id)).toEqual(["u7"]); // 자체 계정(u8)은 유지
    expect(plan.users.create.map((u) => u.email)).toEqual(["b@x.test", "c@x.test"]);
  });
});

describe("권한 표시 — 기본 규칙과 다를 때만", () => {
  it("예외 권한만 돌려준다", async () => {
    const { nonDefaultRole } = await import("@/lib/directory");
    expect(nonDefaultRole({ role: "MANAGER", position: "책임", deptName: "개발팀" })).toBe("MANAGER");
    expect(nonDefaultRole({ role: "MANAGER", position: "팀장", deptName: "개발팀" })).toBe("MANAGER");
    expect(nonDefaultRole({ role: "HQ", position: "책임", deptName: "재무회계팀" })).toBeNull();
    expect(nonDefaultRole({ role: "HQ", position: "책임", deptName: "개발팀" })).toBe("HQ");
    expect(nonDefaultRole({ role: "HQ", position: "선임", deptName: "재무팀" })).toBeNull();
    expect(nonDefaultRole({ role: "MANAGER", position: "팀장", deptName: "재무회계팀" })).toBe("MANAGER");
    expect(nonDefaultRole({ role: "ADMIN", position: "책임", deptName: "IT운영팀" })).toBe("ADMIN");
    expect(nonDefaultRole({ role: "MEMBER", position: "팀장", deptName: "개발팀" })).toBeNull();
  });
});

describe("기본 권한", () => {
  it("재무회계팀 → 재무팀, 그 외(팀장 포함) 팀원 — PM은 직급과 무관", async () => {
    const { defaultRole } = await import("@/lib/directory");
    expect(defaultRole({ position: "책임", deptName: "재무회계팀" })).toBe("HQ");
    expect(defaultRole({ position: "팀장", deptName: "재무회계팀" })).toBe("HQ");
    expect(defaultRole({ position: "팀장", deptName: "개발팀" })).toBe("MEMBER");
    expect(defaultRole({ position: "그룹장", deptName: "영업그룹" })).toBe("MEMBER");
    expect(defaultRole({ position: "본부장", deptName: "공공1본부" })).toBe("MEMBER");
    expect(defaultRole({ position: "수석", deptName: "개발팀" })).toBe("MEMBER");
    expect(defaultRole({ position: "부사장", deptName: null })).toBe("MEMBER");
    expect(defaultRole({ position: null, deptName: null })).toBe("MEMBER");
  });
});

describe("조직장 = 팀장·본부장·그룹장", () => {
  it("1명이면 지정, 없음·여러 명·직급 불일치는 예외", async () => {
    const { planOrgHeads } = await import("@/lib/directory");
    const depts = [
      { id: "t1", name: "개발팀", active: true, headId: null },
      { id: "t2", name: "운영팀", active: true, headId: null },
      { id: "t3", name: "재무팀", active: true, headId: null },
      { id: "t4", name: "기획팀", active: true, headId: "someone" }, // 이미 지정 → 유지
      { id: "b1", name: "공공1본부", active: true, headId: null },
      { id: "g1", name: "영업그룹", active: true, headId: null },
      { id: "s1", name: "경영기획실", active: true, headId: null },
      { id: "t5", name: "폐지팀", active: false, headId: null },
    ];
    const u = (id: string, departmentId: string, position: string, active = true) => ({ id, name: id, position, departmentId, active });
    const plan = planOrgHeads(depts, [
      u("a", "t1", "팀장"), u("b", "t1", "책임"),
      u("c", "t2", "수석"),
      u("d", "t3", "팀장"), u("e", "t3", "팀장"),
      u("f", "t4", "팀장"),
      u("j", "b1", "본부장"),
      u("k", "g1", "그룹장"), u("g", "g1", "팀장"), // 그룹에 있는 팀장 → 불일치
      u("m", "s1", "팀장"), // 팀이 아닌 조직의 팀장 → 불일치
      u("h", "t2", "팀장", false), // 비활성 제외
      u("i", "t5", "팀장"),
    ]);
    expect(plan.assign).toEqual([{ deptId: "t1", userId: "a" }, { deptId: "b1", userId: "j" }, { deptId: "g1", userId: "k" }]);
    expect(plan.noLeader.map((x) => x.name)).toEqual(["운영팀"]);
    expect(plan.multiple).toEqual([{ deptId: "t3", name: "재무팀", title: "팀장", leaders: ["d", "e"] }]);
    expect(plan.mismatched.map((x) => `${x.name}/${x.title}/${x.leaders}`)).toEqual(["영업그룹/팀장/g", "경영기획실/팀장/m"]);
  });
});
