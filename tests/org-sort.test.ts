import { describe, expect, it } from "vitest";
import { byPositionThenName, positionRank } from "@/lib/org";

describe("조직원 정렬 — 직급, 성명 순", () => {
  it("직급 순서", () => {
    expect(positionRank("대표이사")).toBeLessThan(positionRank("본부장"));
    expect(positionRank("팀장")).toBeLessThan(positionRank("수석"));
    expect(positionRank("사원")).toBeLessThan(positionRank("인턴"));
    expect(positionRank("인턴")).toBeLessThan(positionRank("IMSI"));
    expect(positionRank("IMSI")).toBeLessThan(positionRank("고문")); // 목록에 없는 직급
    expect(positionRank("고문")).toBeLessThan(positionRank(null)); // 직급 없음
  });

  it("같은 직급은 가나다순", () => {
    const people = [
      { name: "하나", position: "책임" },
      { name: "다라", position: "사원" },
      { name: "가나", position: "책임" },
      { name: "마바", position: "팀장" },
      { name: "사아", position: null },
    ];
    expect([...people].sort(byPositionThenName).map((p) => p.name)).toEqual(["마바", "가나", "하나", "다라", "사아"]);
  });
});

describe("직급 구분", async () => {
  const { positionTier } = await import("@/lib/org");
  it("임원·조직장·책임급·실무·인턴", () => {
    expect(["본부장", "팀장", "수석", "사원", "인턴", null].map(positionTier)).toEqual(["exec", "lead", "senior", "staff", "temp", "none"]);
  });
});

describe("sortPeople — 모든 사람 목록 기본 정렬", async () => {
  const { sortPeople } = await import("@/lib/org");
  it("중첩된 사람 정보도 직급 → 성명 순, 직급 없으면 뒤", () => {
    const rows = [
      { id: 1, user: { name: "다라", position: "사원" } },
      { id: 2, user: { name: "가나", position: null } },
      { id: 3, user: { name: "나다", position: "책임" } },
      { id: 4, user: { name: "가가", position: "책임" } },
    ];
    expect(sortPeople(rows, (r) => r.user).map((r) => r.id)).toEqual([4, 3, 1, 2]);
    expect(rows[0].id).toBe(1); // 원본은 그대로
  });
});
