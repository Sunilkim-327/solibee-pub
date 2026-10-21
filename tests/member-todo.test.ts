import { describe, expect, it } from "vitest";
import { buildMemberNotices, maxNotices, splitNotices, type MemberNoticeInput } from "@/lib/member-todo";
import { daysToDeadline } from "@/lib/month-phase";

// dDay = 입력 기한(다음 달 3일)까지 남은 날 — lib/month-phase daysToDeadline
const base = (o: Partial<MemberNoticeInput> = {}): MemberNoticeInput => ({
  ym: "2026-10", count: 3, unexplained: 0, rejected: [], passMonths: [], passName: "출입증", dDay: 10, ...o,
});
const keys = (o: Partial<MemberNoticeInput>) => buildMemberNotices(base(o)).map((n) => n.key);

describe("지출 입력 안내 — 우선순위", () => {
  it("할 일이 없으면 빈 목록", () => {
    expect(keys({})).toEqual([]);
  });

  it("반려 > 소명 필요 > 출입증 확인 > 입력 기한 순", () => {
    expect(keys({
      dDay: 3, count: 0, unexplained: 2, passMonths: ["2026-09"],
      rejected: [{ ym: "2026-09", note: "영수증 누락", revoked: false }],
    })).toEqual(["rejected", "flag", "pass", "deadline"]);
  });

  it("반려는 달마다 한 장, 오래된 달부터 · 승인 취소는 따로 표기", () => {
    const n = buildMemberNotices(base({ rejected: [{ ym: "2026-09", note: null, revoked: true }, { ym: "2026-08", note: "사유", revoked: false }] }));
    expect(n.map((x) => x.title)).toEqual(["2026년 8월 반려", "2026년 9월 승인 취소됨"]);
    expect(n[0].detail).toContain("사유: 사유");
    expect(n[0].href).toContain("ym=2026-08");
  });

  it("소명 필요는 그 달 소명 없는 건 필터로 연결", () => {
    const [n] = buildMemberNotices(base({ unexplained: 2 }));
    expect(n.title).toBe("소명 필요 2건");
    expect(n.href).toContain("check=unexplained");
  });

  it("출입증 — 팀원은 내 지출 내역 출입증 탭, PM은 출입증 정산으로", () => {
    const [member] = buildMemberNotices(base({ passMonths: ["2026-09", "2026-08"] }));
    expect(member.href).toContain("ym=2026-08");
    expect(member.title).toContain("출입증 사용 내역이 올라왔어요");
    const [pm] = buildMemberNotices(base({ passMonths: ["2026-09"], pm: true }));
    expect(pm.href).toBe("/pass?ym=2026-09");
    expect(pm.title).toBe("출입증 월 확정 전 1개월");
  });
});

describe("입력 기한 D-5 독촉", () => {
  it("그 달 지출 0건 · 기한 D-5 이내일 때만", () => {
    expect(keys({ count: 0, dDay: 5 })).toEqual(["deadline"]);
    expect(keys({ count: 0, dDay: 0 })).toEqual(["deadline"]);
    expect(keys({ count: 0, dDay: 6 })).toEqual([]);
  });
  it("이미 1건 이상 입력했으면 안 띄움", () => {
    expect(keys({ count: 1, dDay: 2 })).toEqual([]);
  });
  it("기한을 안 따지는 달(dDay null)·입력할 수 없는 팀원은 안 띄움", () => {
    expect(keys({ count: 0, dDay: null })).toEqual([]);
    expect(keys({ count: 0, dDay: 2, canInput: false })).toEqual([]);
  });
  it("문구: 오늘이 입력 기한 / D-N · 기한 날짜를 함께", () => {
    const today = buildMemberNotices(base({ count: 0, dDay: 0 }))[0];
    expect(today.title).toBe("오늘이 입력 기한");
    const d3 = buildMemberNotices(base({ count: 0, dDay: 3 }))[0];
    expect(d3.title).toBe("입력 기한까지 D-3");
    expect(d3.detail).toBe("10월 지출 0건 — 11월 3일까지 입력하세요.");
    expect(d3.short).toBe("입력 기한 D-3");
  });
  it("10월 29일에 보면 10월은 D-5 — 월말이 아니라 11월 3일 기준", () => {
    expect(daysToDeadline("2026-10", "2026-10-29")).toBe(5);
    expect(keys({ count: 0, dDay: daysToDeadline("2026-10", "2026-10-26") })).toEqual([]);
  });
});

describe("입력 기한이 지난 달 (마감 대기)", () => {
  it("팀원 지출 0건이면 한 줄 — 빠진 건은 PM에게", () => {
    const [n] = buildMemberNotices(base({ ym: "2026-09", count: 0, dDay: daysToDeadline("2026-09", "2026-10-15") }));
    expect(n.key).toBe("overdue");
    expect(n.title).toBe("9월 입력 기한(10월 3일)이 지났어요");
    expect(n.detail).toBe("빠진 건은 PM에게 알려 주세요.");
    expect(n.short).toBe("9월 기한 지남");
  });
  it("입력한 게 있으면·PM이면·입력할 수 없는 팀원이면 안 띄움", () => {
    expect(keys({ ym: "2026-09", count: 1, dDay: -12 })).toEqual([]);
    expect(keys({ ym: "2026-09", count: 0, dDay: -12, pm: true })).toEqual([]);
    expect(keys({ ym: "2026-09", count: 0, dDay: -12, canInput: false })).toEqual([]);
  });
  it("우선순위: 출입증 다음, 기한 D-n은 같은 달에 함께 나오지 않음", () => {
    expect(keys({ ym: "2026-09", count: 0, dDay: -1, passMonths: ["2026-09"] })).toEqual(["pass", "overdue"]);
  });
});

describe("보이는 수 제한", () => {
  it("기본 2개, 레이아웃 공통 알림(종료 대기)이 있으면 1개", () => {
    expect(maxNotices(false)).toBe(2);
    expect(maxNotices(true)).toBe(1);
  });
  it("앞에서 maxShown개만 보이고 나머지는 접힘", () => {
    const all = buildMemberNotices(base({
      dDay: 3, count: 0, unexplained: 1, passMonths: ["2026-09"],
      rejected: [{ ym: "2026-09", note: null, revoked: false }],
    }));
    const { shown, rest } = splitNotices(all, 2);
    expect(shown.map((n) => n.key)).toEqual(["rejected", "flag"]);
    expect(rest.map((n) => n.short)).toEqual(["출입증 확인 1개월", "입력 기한 D-3"]);
    expect(splitNotices(all, 1).shown.map((n) => n.key)).toEqual(["rejected"]);
  });
});
