import { describe, expect, it } from "vitest";
import { boardLabel, defaultBoardYm, monthBoard } from "@/lib/portfolio-view";
import type { ClosingStatus } from "@/lib/types";

const r = (name: string, months: string[], statuses: Record<string, ClosingStatus> = {}) => ({ name, months, statuses });

describe("재무팀 월별 마감 현황", () => {
  const rows = [
    r("승인", ["2026-10"], { "2026-10": "APPROVED" }),
    r("상신", ["2026-10"], { "2026-10": "SUBMITTED" }),
    r("미마감", ["2026-10"]),
    r("반려", ["2026-10"], { "2026-10": "REJECTED" }),
    r("마감", ["2026-10"], { "2026-10": "CLOSED" }),
    r("기간 외", ["2026-11"]),
  ];
  it("기간 안만, 안 끝난 곳 먼저 (미마감 → 반려 → 마감 → 상신 → 승인)", () => {
    const b = monthBoard(rows, "2026-10");
    expect(b.list.map((x) => x.name)).toEqual(["미마감", "반려", "마감", "상신", "승인"]);
    expect(b.outside).toBe(1);
    expect(b.counts).toEqual({ DRAFT: 1, REJECTED: 1, CLOSED: 1, SUBMITTED: 1, APPROVED: 1 });
  });
  it("상태 필터 — 건수는 필터와 무관", () => {
    const b = monthBoard(rows, "2026-10", "SUBMITTED");
    expect(b.list.map((x) => x.name)).toEqual(["상신"]);
    expect(b.counts.DRAFT).toBe(1);
  });
});

describe("월별 마감 현황 기본 달", () => {
  it("승인 대기가 있으면 가장 오래된 상신 달", () => {
    const rows = [{ submitted: ["2026-09"] }, { submitted: ["2026-08", "2026-10"] }, { submitted: [] }];
    expect(defaultBoardYm(rows, "2026-10")).toEqual({ ym: "2026-08", moved: true });
  });
  it("없으면 이번 달", () => {
    expect(defaultBoardYm([{ submitted: [] }], "2026-10")).toEqual({ ym: "2026-10", moved: false });
  });
  it("상신 달이 이번 달이면 옮긴 게 아니다", () => {
    expect(defaultBoardYm([{ submitted: ["2026-10"] }], "2026-10")).toEqual({ ym: "2026-10", moved: false });
  });
});

describe("보드 상태 라벨 — 작성중은 오늘 기준 단계", () => {
  it("기한 지난 지난달은 마감 대기, 이번 달은 작성중, 앞으로의 달은 예정 · 다른 상태는 그대로", () => {
    const today = "2026-10-15";
    expect(boardLabel("DRAFT", "2026-09", today)).toBe("마감 대기");
    expect(boardLabel("DRAFT", "2026-10", today)).toBe("작성중");
    expect(boardLabel("DRAFT", "2026-11", today)).toBe("예정");
    expect(boardLabel("CLOSED", "2026-09", today)).toBe("마감");
    expect(boardLabel("REJECTED", "2026-09", today)).toBe("반려");
  });
});
