import { describe, expect, it } from "vitest";
import { currentMemberWhere, isCurrentMember, leftLabel, servedInMonth, servedOn, servedSince } from "@/lib/membership";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const now = { leftAt: null };
const left = { leftAt: d("2026-03-31") };

describe("이전 팀원 (철수일)", () => {
  it("현재 팀원: 철수일이 없거나 철수일 당일까지", () => {
    expect(isCurrentMember(now, d("2026-10-11"))).toBe(true);
    expect(isCurrentMember(left, d("2026-03-31"))).toBe(true);
    expect(isCurrentMember(left, d("2026-04-01"))).toBe(false);
  });

  it("지출 결제자: 철수일 이후 날짜는 불가", () => {
    expect(servedOn(left, d("2026-03-31"))).toBe(true);
    expect(servedOn(left, d("2026-04-01"))).toBe(false);
    expect(servedOn(now, d("2027-01-01"))).toBe(true);
  });

  it("정산표 결제자 열: 철수한 달까지", () => {
    expect(servedInMonth(left, "2026-03")).toBe(true);
    expect(servedInMonth(left, "2026-04")).toBe(false);
    expect(servedInMonth(now, "2026-12")).toBe(true);
  });

  it("출입증 명세: 기간 시작일 이후까지 근무했으면 대상 (21일 기준 4월분 = 3/21~4/20)", () => {
    expect(servedSince(left, "2026-03-21")).toBe(true);
    expect(servedSince(left, "2026-04-21")).toBe(false);
    expect(servedSince(now, "2027-01-21")).toBe(true);
  });

  it("Prisma 조건과 표시", () => {
    expect(currentMemberWhere(d("2026-10-11"))).toEqual({ OR: [{ leftAt: null }, { leftAt: { gte: d("2026-10-11") } }] });
    expect(leftLabel("2026-03-31")).toBe("~3/31");
    expect(leftLabel(d("2026-06-30"))).toBe("~6/30");
  });
});
