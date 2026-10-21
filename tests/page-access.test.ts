import { describe, expect, it } from "vitest";
import { homeFor, pageAllowed, pageRule } from "@/lib/page-access";

describe("화면 접근 규칙", () => {
  it("경로(하위·쿼리 포함)로 규칙을 찾는다", () => {
    expect(pageRule("/settings")?.scope).toBe("project");
    expect(pageRule("/closing?ym=2026-10")?.roles).toEqual(["MANAGER", "HQ", "ADMIN"]);
    expect(pageRule("/master")?.scope).toBe("global");
    expect(pageRule("/settlement")).toBeNull();
    expect(pageRule("/expenses/new")).toBeNull();
    expect(pageRule("/settings")?.roles).toEqual(["MANAGER"]);
    expect(pageRule("/dashboards")).toBeNull();
  });

  it("프로젝트 화면은 프로젝트 역할, 회사 화면은 회사 권한으로 판단", () => {
    const settings = pageRule("/settings")!;
    expect(pageAllowed(settings, "MANAGER", "MEMBER")).toBe(false); // 이 프로젝트에서는 팀원
    expect(pageAllowed(settings, "MEMBER", "MANAGER")).toBe(true);
    expect(pageAllowed(settings, "MEMBER", null)).toBe(true); // 프로젝트 없음 → 페이지가 안내 화면으로
    const eps = pageRule("/eps")!;
    expect(pageAllowed(eps, "MANAGER", "MANAGER")).toBe(false);
    expect(pageAllowed(eps, "HQ", "HQ")).toBe(true);
    expect(pageAllowed(pageRule("/audit")!, "HQ", "HQ")).toBe(false);
  });

  it("역할별 첫 화면", () => {
    expect(homeFor({ globalRole: "HQ", hasProject: true, role: "HQ" })).toBe("/projects");
    expect(homeFor({ globalRole: "ADMIN", hasProject: false, role: "ADMIN" })).toBe("/projects");
    expect(homeFor({ globalRole: "MEMBER", hasProject: false, role: "MEMBER" })).toBe("/no-project");
    expect(homeFor({ globalRole: "MEMBER", hasProject: true, role: "MEMBER" })).toBe("/expenses/new");
    expect(homeFor({ globalRole: "MEMBER", hasProject: true, role: "MEMBER", readOnly: true })).toBe("/dashboard");
    expect(homeFor({ globalRole: "MANAGER", hasProject: true, role: "MANAGER" })).toBe("/expenses/new");
    expect(homeFor({ globalRole: "MANAGER", hasProject: true, role: "MANAGER", readOnly: true })).toBe("/dashboard");
    expect(homeFor({ globalRole: "MANAGER", hasProject: true, role: "MEMBER" })).toBe("/expenses/new");
  });

  it("첫 화면은 그 역할이 들어갈 수 있는 화면이다 (돌려보내기 반복 없음)", () => {
    for (const [g, r] of [["MEMBER", "MEMBER"], ["MANAGER", "MANAGER"], ["MANAGER", "MEMBER"], ["HQ", "HQ"], ["ADMIN", "ADMIN"]] as const) {
      const home = homeFor({ globalRole: g, hasProject: true, role: r });
      const rule = pageRule(home);
      expect(!rule || pageAllowed(rule, g, r)).toBe(true);
    }
  });
});

describe("레이아웃 단계 돌려보내기", () => {
  const pm = { globalRole: "MANAGER" as const, hasProject: true, role: "MANAGER" as const };
  it("첫 화면·권한 없음·조회 전용 제한", async () => {
    const { pageRedirect } = await import("@/lib/page-access");
    // 첫 화면(/)은 안내 없이, 권한 없음·조회 전용 제한은 ?notice= 를 붙여 도착 화면이 토스트
    expect(pageRedirect("/", pm)).toBe("/expenses/new");
    expect(pageRedirect("/eps", pm)).toBe("/expenses/new?notice=role");
    expect(pageRedirect("/settings", pm)).toBeNull();
    expect(pageRedirect("/monthly?ym=2026-10", pm)).toBeNull();
    // 재무팀·관리자는 PM 설정에 들어갈 수 없다 (첫 화면으로), 상위 PM 조회는 대시보드로
    expect(pageRedirect("/settings", { globalRole: "ADMIN", hasProject: true, role: "ADMIN", readOnly: true })).toBe("/projects?notice=role");
    expect(pageRedirect("/settings", { globalRole: "HQ", hasProject: true, role: "HQ" })).toBe("/projects?notice=role");
    expect(pageRedirect("/settings", { ...pm, readOnly: true })).toBe("/dashboard?notice=readonly");
    expect(pageRedirect("/settings", { globalRole: "MEMBER", hasProject: true, role: "MEMBER" })).toBe("/expenses/new?notice=role");
    // 현황은 팀원도 연다 (내 지출 내역)
    expect(pageRedirect("/dashboard?ym=2026-10", { globalRole: "MEMBER", hasProject: true, role: "MEMBER" })).toBeNull();
  });
});

describe("돌려보낼 때 안내 (?notice=)", () => {
  it("쿼리·해시가 있어도 붙고, 도착 화면 이름으로 문구를 만든다", async () => {
    const { withNotice, redirectNoticeText } = await import("@/lib/page-access");
    expect(withNotice("/dashboard", "readonly")).toBe("/dashboard?notice=readonly");
    expect(withNotice("/dashboard?ym=2026-10#settle", "role")).toBe("/dashboard?ym=2026-10&notice=role#settle");
    expect(redirectNoticeText("readonly", "팀 현황")).toBe("조회 전용 프로젝트라 팀 현황 화면으로 이동했어요");
    expect(redirectNoticeText("role", "전체 프로젝트 현황")).toBe("권한이 없는 화면이라 전체 프로젝트 현황 화면으로 이동했어요");
    expect(redirectNoticeText("role", null)).toBe("권한이 없는 화면이라 첫 화면으로 이동했어요");
    expect(redirectNoticeText("x", "팀 현황")).toBeNull();
    expect(redirectNoticeText(null, "팀 현황")).toBeNull();
  });
});

describe("월별 현황 → 현황 합침", () => {
  it("예전 /monthly 주소는 쿼리(ym·check·edit·scope·기타)를 그대로 현황 지출 내역으로", async () => {
    const { legacyRedirect } = await import("@/lib/page-access");
    expect(legacyRedirect("/monthly", "")).toBe("/dashboard#ledger");
    expect(legacyRedirect("/monthly", "?ym=2026-10")).toBe("/dashboard?ym=2026-10#ledger");
    expect(legacyRedirect("/monthly", "?ym=2026-10&check=unexplained&scope=all&edit=abc"))
      .toBe("/dashboard?ym=2026-10&check=unexplained&scope=all&edit=abc#ledger");
    // RSC 내부 파라미터는 버린다
    expect(legacyRedirect("/monthly", "?ym=2026-10&_rsc=x1")).toBe("/dashboard?ym=2026-10#ledger");
    expect(legacyRedirect("/monthly/anything", "?ym=2026-09")).toBe("/dashboard?ym=2026-09#ledger");
    for (const p of ["/dashboard", "/monthlyx", "/settlement", "/"]) expect(legacyRedirect(p, "?ym=2026-10")).toBeNull();
  });
  it("예전 내 정산(/settlement)은 현황의 정산 구역으로 — 팀원은 내 지출 내역(달만), PM·재무는 팀원별 정산(달·범위 유지)", async () => {
    const { settlementRedirect } = await import("@/lib/page-access");
    expect(settlementRedirect("MEMBER")).toBe("/dashboard#settle");
    expect(settlementRedirect("MEMBER", { ym: "2026-09" })).toBe("/dashboard?ym=2026-09#settle");
    // 팀원은 하위 포함 범위가 없다 — scope는 버린다
    expect(settlementRedirect("MEMBER", { ym: "2026-09", scope: "all" })).toBe("/dashboard?ym=2026-09#settle");
    expect(settlementRedirect("MANAGER", { ym: "2026-09", scope: "all" })).toBe("/dashboard?ym=2026-09&scope=all#settle");
    expect(settlementRedirect("HQ", { scope: "all" })).toBe("/dashboard?scope=all#settle");
    // 잘못된 달은 버린다 (화면이 마지막 본 달로)
    expect(settlementRedirect("MEMBER", { ym: "abc" })).toBe("/dashboard#settle");
  });
  it("출입증 확인은 내 지출 내역의 출입증 탭 — 예전 지출 입력 출입증 탭 주소는 새 주소로", async () => {
    const { legacyRedirect, passCheckHref } = await import("@/lib/page-access");
    expect(passCheckHref()).toBe("/dashboard?tab=pass");
    expect(passCheckHref("2026-09")).toBe("/dashboard?tab=pass&ym=2026-09");
    expect(legacyRedirect("/expenses/new", "?mode=pass")).toBe("/dashboard?tab=pass");
    expect(legacyRedirect("/expenses/new", "?mode=pass&ym=2026-09")).toBe("/dashboard?tab=pass&ym=2026-09");
    expect(legacyRedirect("/expenses/new", "?ym=2026-09&mode=pass&_rsc=x")).toBe("/dashboard?tab=pass&ym=2026-09");
    // 잘못된 달은 버린다 (명세 월 선택은 화면이 정한다)
    expect(legacyRedirect("/expenses/new", "?mode=pass&ym=abc")).toBe("/dashboard?tab=pass");
    // 지출 입력 자체(지난달 고르기 ?ym= 포함)는 그대로
    for (const q of ["", "?ym=2026-09", "?mode=card"]) expect(legacyRedirect("/expenses/new", q)).toBeNull();
    expect(legacyRedirect("/expenses/new/x", "?mode=pass")).toBeNull();
  });
  it("지출 내역 링크", async () => {
    const { ledgerHref } = await import("@/lib/page-access");
    expect(ledgerHref()).toBe("/dashboard#ledger");
    expect(ledgerHref("2026-10")).toBe("/dashboard?ym=2026-10#ledger");
    expect(ledgerHref("2026-10", { check: "flag" })).toBe("/dashboard?ym=2026-10&check=flag#ledger");
    expect(ledgerHref("2026-10", { edit: "e1" })).toBe("/dashboard?ym=2026-10&edit=e1#ledger");
  });
});
