import { describe, expect, it } from "vitest";
import {
  attributedMonths, closeBlockers, memberInputOpen, nextRoundName, nextRoundPeriod, proRate, projectPhase, rollupChildren, uncoveredMonths,
} from "@/lib/lifecycle";
import { seoulTodayDate } from "@/lib/format";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const p = { startDate: d("2025-12-01"), endDate: d("2026-11-30") };

describe("프로젝트 생애주기", () => {
  it("기간·종료 처리·보관에 따라 단계가 바뀐다", () => {
    expect(projectPhase(p, d("2025-11-30"))).toBe("UPCOMING");
    expect(projectPhase(p, d("2026-11-30"))).toBe("ACTIVE");
    expect(projectPhase(p, d("2026-12-01"))).toBe("WRAPUP");
    expect(projectPhase({ ...p, closedAt: d("2027-01-10") }, d("2027-02-01"))).toBe("CLOSED");
    expect(projectPhase({ ...p, closedAt: d("2027-01-10") }, d("2028-01-11"))).toBe("ARCHIVED"); // 종료 1년 후 자동 보관
    expect(projectPhase({ ...p, archivedAt: d("2027-01-11") }, d("2026-06-01"))).toBe("ARCHIVED");
  });

  it("팀원 입력은 종료월 다음 달까지만", () => {
    expect(memberInputOpen(p, d("2026-12-31"))).toBe(true);
    expect(memberInputOpen(p, d("2027-01-01"))).toBe(false);
    expect(memberInputOpen({ ...p, closedAt: d("2026-12-10") }, d("2026-12-11"))).toBe(false);
  });

  it("종료 처리 조건: 기간 종료 + 지출 있는 월 모두 승인", () => {
    const now = d("2027-01-05");
    expect(closeBlockers(p, [], [], d("2026-06-01"))[0]).toMatch(/끝나지/);
    expect(closeBlockers(p, [{ yearMonth: "2026-10", status: "APPROVED" }, { yearMonth: "2026-11", status: "SUBMITTED" }], ["2026-10", "2026-11"], now))
      .toEqual(["승인되지 않은 월이 있습니다: 2026년 11월"]);
    expect(closeBlockers(p, [{ yearMonth: "2026-11", status: "APPROVED" }], ["2026-11"], now)).toEqual([]);
    expect(closeBlockers(p, [{ yearMonth: "2026-11", status: "APPROVED" }], ["2026-11"], now, ["2026-11"])[0]).toMatch(/출입증/);
  });
});

describe("연차(연속 사업)", () => {
  it("다음 연차 기간·이름", () => {
    const n = nextRoundPeriod(p.startDate, p.endDate);
    expect([n.startDate.toISOString().slice(0, 10), n.endDate.toISOString().slice(0, 10)]).toEqual(["2026-12-01", "2027-11-30"]);
    const m = nextRoundPeriod(d("2025-03-15"), d("2026-03-14"));
    expect(m.endDate.toISOString().slice(0, 10)).toBe("2027-03-14");
    expect(nextRoundName("플랫폼 유지관리", null)).toBe("플랫폼 유지관리 2차");
    expect(nextRoundName("플랫폼 유지관리 2차", 2)).toBe("플랫폼 유지관리 3차");
  });

  it("서브는 연차 기간에 맞춰 월별로 귀속", () => {
    const y1 = { id: "y1", parentId: null, seriesId: "s", ...p };
    const y2 = { id: "y2", parentId: null, seriesId: "s", startDate: d("2026-12-01"), endDate: d("2027-11-30") };
    const sub = { id: "sub", parentId: "y1", seriesId: null, startDate: d("2026-08-01"), endDate: d("2027-03-31") };
    const old = { id: "old", parentId: "y1", seriesId: null, startDate: d("2026-01-01"), endDate: d("2026-06-30") };
    const nodes = [y1, y2, sub, old];
    expect(rollupChildren(nodes, "y1").sort()).toEqual(["old", "sub"]);
    expect(rollupChildren(nodes, "y2")).toEqual(["sub"]); // 1차에 연결된 서브도 2차와 겹치는 기간이 있으면
    expect(attributedMonths(sub, y1)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(attributedMonths(sub, y2)).toEqual(["2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(uncoveredMonths(sub, [y1])).toEqual(["2026-12", "2027-01", "2027-02", "2027-03"]); // 2차 생성 전
    expect(uncoveredMonths(sub, [y1, y2])).toEqual([]);
  });
});

describe("다음 연차 기간 — 없는 날짜는 말일로", () => {
  it("8/31 시작 6개월 → 다음 연차는 2월 말일 전날까지", () => {
    const n = nextRoundPeriod(d("2026-02-28"), d("2026-08-30")); // 6개월 사업
    expect([n.startDate.toISOString().slice(0, 10), n.endDate.toISOString().slice(0, 10)]).toEqual(["2026-08-31", "2027-02-27"]);
  });
  it("1/31 시작 1개월 → 2월 말일로 맞춘 뒤 전날", () => {
    const n = nextRoundPeriod(d("2025-12-31"), d("2026-01-30"));
    expect(n.endDate.toISOString().slice(0, 10)).toBe("2026-02-27");
  });
});

describe("하위 프로젝트 예산 비례 배분", () => {
  it("연차별로 나눈 금액의 합 = 원래 금액 (끝전은 마지막 몫)", () => {
    const sub = { startDate: d("2026-08-01"), endDate: d("2027-02-28") }; // 7개월
    const y1 = { startDate: d("2025-12-01"), endDate: d("2026-11-30") }; // 4개월 귀속
    const y2 = { startDate: d("2026-12-01"), endDate: d("2027-11-30") }; // 3개월 귀속
    const a = proRate(1_000_000, sub, y1);
    const b = proRate(1_000_000, sub, y2);
    expect(a).toBe(571_429);
    expect(a + b).toBe(1_000_000);
    expect(proRate(1_000_000, sub, { startDate: d("2030-01-01"), endDate: d("2030-12-31") })).toBe(0);
  });
});

describe("기준 시각 — 한국 날짜", () => {
  it("UTC 15:00 이후는 한국 다음 날 (기본값과 같은 기준)", () => {
    // 종료일 2026-11-30, 한국 2026-12-01 00:30 = UTC 11-30 15:30
    expect(projectPhase(p, seoulTodayDate(new Date("2026-11-30T15:30:00Z")))).toBe("WRAPUP");
    expect(projectPhase(p, seoulTodayDate(new Date("2026-11-30T14:30:00Z")))).toBe("ACTIVE");
  });
});
