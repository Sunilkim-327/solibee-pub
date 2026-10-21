import { describe, expect, it } from "vitest";
import { navItems, primaryHrefs } from "@/components/Nav";

const hrefs = (role: Parameters<typeof navItems>[0], ...rest: [boolean?, boolean?, Parameters<typeof navItems>[3]?, boolean?]) => navItems(role, ...rest).map((n) => n.href);

describe("역할별 메뉴", () => {
  it("모바일 하단 탭은 4개 이하, 모두 보이는 메뉴 안에서", () => {
    for (const role of ["MEMBER", "MANAGER", "HQ", "ADMIN"] as const) {
      for (const pass of [false, true]) {
        const primary = primaryHrefs(role, false, pass);
        expect(primary.length).toBeLessThanOrEqual(4);
        const visible = hrefs(role);
        for (const h of primary) expect(visible).toContain(h);
      }
    }
  });
  it("출입증을 쓰는 프로젝트의 PM은 하단 탭에 출입증", () => {
    expect(primaryHrefs("MANAGER", false, true)).toContain("/pass");
    expect(primaryHrefs("MANAGER", false, false)).not.toContain("/pass");
  });
  it("조회 전용(상위 PM)은 입력·마감·출입증·설정이 없다", () => {
    const v = hrefs("MANAGER", true, true);
    for (const h of ["/expenses/new", "/closing", "/pass", "/settings"]) expect(v).not.toContain(h);
  });
  it("팀원: 회사·관리 메뉴 없음 (내 계정은 메뉴 대신 상단 이름 영역에서)", () => {
    const m = hrefs("MEMBER");
    expect(m).not.toContain("/me");
    expect(m).not.toContain("/org");
    expect(m).not.toContain("/master");
  });
  it("조직도·체계도는 재무팀·관리자만 (팀원·PM에게는 없음)", () => {
    for (const role of ["MEMBER", "MANAGER"] as const) {
      expect(hrefs(role, false, false, role)).not.toContain("/org");
      expect(hrefs(role, false, false, role)).not.toContain("/eps");
    }
    expect(hrefs("MEMBER", false, false, "HQ")).toContain("/org");
    expect(hrefs("HQ", false, false, "HQ")).toContain("/eps");
  });
  it("화면 이름: 현황·마감·출입증 정산 (메뉴·하단 탭)", () => {
    const pm = navItems("MANAGER");
    const by = (h: string) => pm.find((n) => n.href === h)!;
    expect([by("/dashboard").label, by("/dashboard").short]).toEqual(["팀 현황", "현황"]);
    expect([by("/closing").label, by("/closing").short]).toEqual(["마감 · 상신", "마감"]);
    expect([by("/pass").label, by("/pass").short]).toEqual(["출입증 정산", "출입증 정산"]);
    expect(navItems("HQ").find((n) => n.href === "/dashboard")?.labelByRole?.HQ).toBe("프로젝트 현황");
  });
  it("재무팀 메뉴에는 출입증 정산·PM 설정이 없다 (출입증 처리는 PM, 검토는 마감·상신에서)", () => {
    const hq = hrefs("HQ", false, false, "HQ", true);
    for (const h of ["/pass", "/settings"]) expect(hq).not.toContain(h);
    expect(hq).toEqual(["/projects", "/expenses/new", "/dashboard", "/closing", "/budget", "/org", "/eps", "/notifications", "/master"]);
  });
  it("기준 정보(구 마스터 관리)는 재무팀·관리자만", () => {
    expect(hrefs("HQ")).toContain("/master");
    expect(hrefs("MANAGER")).not.toContain("/master");
    expect(navItems("HQ").find((n) => n.href === "/master")?.label).toBe("기준 정보");
  });
});

describe("알림 메뉴", () => {
  it("모든 역할의 회사 묶음에 '알림' — 조회 전용·프로젝트 종료·시스템 관리자도", () => {
    for (const role of ["MEMBER", "MANAGER", "HQ", "ADMIN"] as const) {
      const item = navItems(role, false, false, role).find((n) => n.href === "/notifications");
      expect(item?.label).toBe("알림");
      expect(item?.group).toBe("company");
    }
    expect(hrefs("MANAGER", true, true)).toContain("/notifications");
    expect(hrefs("MEMBER", true, false, "MEMBER")).toContain("/notifications");
  });
  it("모바일 하단 탭에는 없다 (상단 바의 종으로 연다)", () => {
    for (const role of ["MEMBER", "MANAGER", "HQ", "ADMIN"] as const) {
      for (const pass of [false, true]) expect(primaryHrefs(role, false, pass)).not.toContain("/notifications");
    }
  });
});

describe("현황 (팀 현황 + 월별 현황 합침)", () => {
  it("월별 현황 메뉴는 없고 현황 하나 — 역할별 이름", () => {
    for (const role of ["MEMBER", "MANAGER", "HQ", "ADMIN"] as const) {
      expect(hrefs(role, false, false, role)).not.toContain("/monthly");
      expect(hrefs(role, false, false, role)).toContain("/dashboard");
    }
    const item = navItems("MEMBER").find((n) => n.href === "/dashboard")!;
    expect([item.labelByRole?.MEMBER, item.shortByRole?.MEMBER]).toEqual(["내 지출 내역", "내역"]);
  });
  it("하단 탭: 팀원 입력·내역(내 정산은 내역 상단 요약), PM 입력·현황·마감·예산 (출입증 프로젝트는 예산 대신 출입증, 마감이 먼저)", () => {
    expect(primaryHrefs("MEMBER", false, false)).toEqual(["/expenses/new", "/dashboard"]);
    expect(primaryHrefs("MANAGER", false, false)).toEqual(["/expenses/new", "/dashboard", "/closing", "/budget"]);
    expect(primaryHrefs("MANAGER", false, true)).toEqual(["/expenses/new", "/dashboard", "/closing", "/pass"]);
  });
  it("PM 메뉴 순서는 업무 빈도순: 마감·상신 → 출입증 정산 → 운영비 → PM 설정, 팀원 메뉴에 내 정산 없음", () => {
    const pm = hrefs("MANAGER", false, false, "MANAGER", true);
    const order = ["/closing", "/pass", "/budget", "/settings"].map((h) => pm.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(hrefs("MEMBER", false, false, "MEMBER")).not.toContain("/settlement");
  });
  it("조회 전용도 현황(요약·예산)은 메뉴에 있다", () => {
    expect(hrefs("MANAGER", true, true)).toContain("/dashboard");
  });
});

describe("관리자 메뉴", () => {
  const admin = navItems("ADMIN", true, false, "ADMIN");
  it("기본 메뉴: 전체 프로젝트·조직도·체계도·기준 정보·기록", () => {
    const main = admin.filter((n) => n.group !== "support").map((n) => n.href);
    expect(main).toEqual(["/projects", "/org", "/eps", "/notifications", "/master", "/audit"]);
  });
  it("프로젝트 화면은 '지원용 조회' 묶음 — 지출 입력·PM 설정 없음", () => {
    const support = admin.filter((n) => n.group === "support").map((n) => n.href);
    expect(support).toEqual(["/dashboard", "/closing", "/pass", "/budget"]);
    expect(admin.map((n) => n.href)).not.toContain("/expenses/new");
  });
  it("재무팀은 그대로 이 프로젝트 묶음", () => {
    expect(navItems("HQ").some((n) => (n.group as string) === "support")).toBe(false);
  });
});
