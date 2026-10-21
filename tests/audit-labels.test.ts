import { describe, expect, it } from "vitest";
import { AUDIT_GROUPS, auditActionLabel, auditEntityLabel, auditRange, kstToday } from "@/lib/audit-labels";

describe("auditActionLabel / auditEntityLabel", () => {
  it("알려진 값은 한국어로", () => {
    expect(auditActionLabel("revoke")).toBe("승인 취소");
    expect(auditActionLabel("lifecycle-archive")).toBe("프로젝트 보관");
    expect(auditEntityLabel("PassStatement")).toBe("출입증 내역");
  });
  it("일괄 작업은 접두어를 붙인다", () => {
    expect(auditActionLabel("bulk:collect")).toBe("일괄 · 외부인 수금 기록");
    expect(auditActionLabel("bulk:clear")).toBe("일괄 · 결정 지우기 (미결정으로)");
    expect(auditActionLabel("bulk:unknown")).toBe("일괄 · unknown");
  });
  it("팀원 본인 부담 확인(일괄)·해제에 표시 이름이 있다", () => {
    expect(auditActionLabel("member:personal")).toContain("본인 부담으로 확인");
    expect(auditActionLabel("member:personal-clear")).toContain("확인 해제");
  });
  it("모르는 값·프로토타입 키는 원문 그대로", () => {
    expect(auditActionLabel("weird")).toBe("weird");
    expect(auditActionLabel("toString")).toBe("toString");
    expect(auditEntityLabel("constructor")).toBe("constructor");
  });
  it("모든 그룹의 대상에 표시 이름이 있다", () => {
    for (const e of Object.values(AUDIT_GROUPS).flat()) expect(auditEntityLabel(e)).not.toBe(e);
  });
});

describe("auditRange", () => {
  // 2026-10-11 00:30 KST = 2026-10-10 15:30 UTC
  const now = new Date("2026-10-10T15:30:00Z");

  it("KST 기준 오늘", () => {
    expect(kstToday(now)).toBe("2026-10-11");
  });
  it("기본값: KST 오늘까지 30일", () => {
    const r = auditRange(undefined, undefined, now);
    expect(r.toDay).toBe("2026-10-11");
    expect(r.fromDay).toBe("2026-09-11");
    expect(r.lte.toISOString()).toBe("2026-10-11T14:59:59.999Z");
    expect(r.gte.toISOString()).toBe("2026-09-10T15:00:00.000Z");
  });
  it("잘못된 날짜는 기본값으로 (Invalid Date 방지)", () => {
    const r = auditRange("garbage", "2026-13-45", now);
    expect(r.toDay).toBe("2026-10-11");
    expect(Number.isNaN(r.gte.getTime())).toBe(false);
  });
  it("시작 > 종료면 바꾼다", () => {
    const r = auditRange("2026-10-05", "2026-10-01", now);
    expect([r.fromDay, r.toDay]).toEqual(["2026-10-01", "2026-10-05"]);
  });
});
