import { describe, expect, it } from "vitest";
import { allowedFromSources, validateExpenseFields } from "@/lib/expenses";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const period = { startDate: d("2026-01-01"), endDate: d("2026-02-28") };
const today = d("2026-02-15");
const ok = { date: "2026-02-10", amount: "12,000", detail: " 야근 식사 ", headcount: "2", attendees: " 가, 나 " };
const err = (x: object, p = period, t = today) => {
  const r = validateExpenseFields({ ...ok, ...x }, p, t);
  return r.ok ? null : r.error;
};

describe("지출 입력 필드 검증", () => {
  it("정상 입력은 정리된 값", () => {
    const r = validateExpenseFields({ ...ok, merchant: "  가게 ", justification: "  " }, period, today);
    expect(r.ok && r.value).toMatchObject({ yearMonth: "2026-02", amount: 12000, detail: "야근 식사", headcount: 2, attendees: "가, 나", merchant: "가게", justification: null, hasExternal: false });
  });
  it("날짜 형식·프로젝트 기간", () => {
    expect(err({ date: "2026-2-10" })).toMatch(/YYYY-MM-DD/);
    expect(err({ date: "2026-03-01" })).toBe("사용일이 프로젝트 기간(2026.01.01 ~ 2026.02.28) 밖이에요.");
    expect(err({ date: "2025-12-31" })).toMatch(/기간/);
    // 경계: 시작일·종료일(오늘 이전)은 입력 가능
    expect(err({ date: "2026-01-01" })).toBeNull();
    expect(err({ date: "2026-02-28" }, period, d("2026-03-10"))).toBeNull();
  });
  it("사용일은 오늘까지 — 기간 안이라도 미래 날짜는 거부", () => {
    expect(err({ date: "2026-02-15" })).toBeNull();
    expect(err({ date: "2026-02-16" })).toBe("사용일은 오늘까지만 입력할 수 있어요.");
    // 기간도 넘고 미래이면 기간 문구가 먼저
    expect(err({ date: "2026-03-01" })).toMatch(/기간/);
    // today를 넘기지 않으면 서버(한국 시간) 기준 오늘
    const far = { startDate: d("2026-01-01"), endDate: d("2999-12-31") };
    expect(validateExpenseFields({ ...ok, date: "2999-12-01" }, far).ok).toBe(false);
    expect(validateExpenseFields({ ...ok, date: "2026-02-10" }, far).ok).toBe(true);
  });
  it("금액: 1원 이상 정수, 1억 이하", () => {
    expect(err({ amount: "" })).toMatch(/1원 이상/);
    expect(err({ amount: 0 })).toMatch(/1원 이상/);
    expect(err({ amount: "1.5" })).toMatch(/정수/);
    expect(err({ amount: 100_000_001 })).toMatch(/1억원/);
    expect(err({ amount: 100_000_000 })).toBeNull();
  });
  it("세부내역·대상인원·참석자·소명 길이", () => {
    expect(err({ detail: "  " })).toMatch(/세부내역을/);
    expect(err({ detail: "x".repeat(301) })).toMatch(/300자/);
    expect(err({ headcount: 0 })).toMatch(/대상인원/);
    expect(err({ headcount: "" })).toBeNull();
    expect(err({ attendees: "x".repeat(501) })).toMatch(/500자/);
    expect(err({ justification: "x".repeat(301) })).toMatch(/소명/);
  });
});

describe("allowedFromSources (입력 가능 항목)", () => {
  const lines = [{ itemId: "a", bundleItemIds: '["b"]' }, { itemId: "c", bundleItemIds: null }];
  it("PM·재무팀은 예산 항목 전체 (묶음 포함)", () => {
    expect(allowedFromSources("MANAGER", lines, [], ["z"])).toEqual(["a", "b", "c"]);
  });
  it("팀원은 PM 노출 항목 + 담당 과업 항목 중 예산에 든 것만", () => {
    expect(allowedFromSources("MEMBER", lines, ["b"], ["c", "z"])).toEqual(["b", "c"]);
  });
});

// 팀원 입력 기한(다음 달 3일) — 서버 403 (lib/month-phase inputDeadlineProblem 문구)
import { assertInputDeadline } from "@/lib/expenses";
import { deadlinePassedMonths } from "@/lib/master";
import type { SessionUser } from "@/lib/access";

const member = { role: "MEMBER" } as SessionUser;
const pm = { role: "MANAGER" } as SessionUser;
const status = (fn: () => void) => { try { fn(); return 200; } catch (e) { return (e as { status: number }).status; } };

describe("팀원 입력 기한 검사 (assertInputDeadline)", () => {
  it("기한 당일까지는 통과, 다음 날부터 403 — 문구는 화면 안내와 같다", () => {
    expect(status(() => assertInputDeadline(member, "2026-09", "2026-10-03"))).toBe(200);
    expect(status(() => assertInputDeadline(member, "2026-09", "2026-09-01"))).toBe(200);
    expect(status(() => assertInputDeadline(member, "2026-09", "2026-10-04"))).toBe(403);
    expect(() => assertInputDeadline(member, "2026-09", "2026-10-15")).toThrow("9월 입력 기한(10월 3일)이 지났어요. 추가·수정할 건은 PM에게 요청하세요.");
  });
  it("PM·재무 승인·시스템 관리자는 기한과 무관 (대신 입력·수정)", () => {
    for (const role of ["MANAGER", "HQ", "ADMIN"]) expect(status(() => assertInputDeadline({ role } as SessionUser, "2026-03", "2026-10-15"))).toBe(200);
    expect(status(() => assertInputDeadline(pm, "2026-09", "2026-10-15"))).toBe(200);
  });
  it("미래 달도 403", () => {
    expect(status(() => assertInputDeadline(member, "2026-11", "2026-10-15"))).toBe(403);
  });
});

describe("입력 화면용 기한 지난 달 목록 (deadlinePassedMonths)", () => {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
  it("오늘 기준 기한이 지난 달만 — 이번 달·미래 달 제외", () => {
    expect(deadlinePassedMonths(months, "2026-10-15")).toEqual(["2026-07", "2026-08", "2026-09"]);
    // 다음 달 3일까지는 전월이 아직 열려 있다
    expect(deadlinePassedMonths(months, "2026-10-03")).toEqual(["2026-07", "2026-08"]);
    expect(deadlinePassedMonths(months, "2026-10-04")).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
});
