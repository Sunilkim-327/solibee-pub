import { describe, expect, it } from "vitest";
import { buildTodos, setupComplete, type TodoExpense, type TodoInput } from "@/lib/todo";

const exp = (o: Partial<TodoExpense>): TodoExpense => ({
  payerId: "u1", yearMonth: "2026-10", isHq: false, payMethod: "PERSONAL_CARD", flags: null, ...o,
});

const base = (o: Partial<TodoInput> = {}): TodoInput => ({
  ym: "2026-10",
  now: "2026-10",
  months: ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"],
  setup: { hasBudget: true, hasMemberItems: true, hasMembers: true },
  payers: [{ id: "u1", name: "가" }, { id: "u2", name: "나" }],
  expenses: [exp({ payerId: "u1" }), exp({ payerId: "u2" })],
  closings: [
    { yearMonth: "2026-07", status: "APPROVED", reviewNote: null },
    { yearMonth: "2026-08", status: "APPROVED", reviewNote: null },
    { yearMonth: "2026-09", status: "APPROVED", reviewNote: null },
  ],
  ...o,
});

const keys = (i: TodoInput) => buildTodos(i).map((t) => t.key);

describe("PM 이번 달 할 일", () => {
  it("모두 정리되면 할 일 없음", () => {
    expect(buildTodos(base())).toEqual([]);
  });

  it("시작 준비 미완료 = 예산 없음", () => {
    const s = { hasBudget: false, hasMemberItems: true, hasMembers: true };
    expect(setupComplete(s)).toBe(false);
    const t = buildTodos(base({ setup: s }));
    expect(t[0].key).toBe("setup");
    expect(t[0].detail).toBe("예산 등록 필요");
    expect(t[0].href).toBe("/settings");
  });

  it("구성원·팀원 지출 항목은 선택 — 없어도 준비 완료 (PM만 입력하는 프로젝트)", () => {
    expect(setupComplete({ hasBudget: true, hasMemberItems: false, hasMembers: true })).toBe(true);
    expect(setupComplete({ hasBudget: true, hasMemberItems: false, hasMembers: false })).toBe(true);
    // 팀원 항목이 없으면 입력 대상 팀원이 없어 payers가 비고, 할 일도 없다
    expect(keys(base({ setup: { hasBudget: true, hasMemberItems: false, hasMembers: true }, payers: [], expenses: [] }))).toEqual([]);
  });

  it("이번 달 입력 없는 팀원", () => {
    const t = buildTodos(base({ expenses: [exp({ payerId: "u1" }), exp({ payerId: "u2", isHq: true })] }));
    const row = t.find((x) => x.key === "noinput");
    expect(row?.title).toContain("1명");
    expect(row?.detail).toBe("나");
  });

  it("구성원이 없으면 입력 없는 팀원 항목은 생략 (시작 준비도 완료)", () => {
    expect(keys(base({ setup: { hasBudget: true, hasMemberItems: true, hasMembers: false }, payers: [], expenses: [] }))).toEqual([]);
  });

  it("규정 점검은 이번 달만, 현황 지출 내역 필터로 연결 (영수증 항목 없음)", () => {
    const t = buildTodos(base({
      expenses: [
        exp({ payerId: "u1", flags: "PER_PERSON" }),
        // 안내성 점검만 있는 건은 세지 않음
        exp({ payerId: "u1", flags: "ACCOUNT_CHECK" }),
        exp({ payerId: "u2" }),
        exp({ payerId: "u2", isHq: true, payMethod: "HQ" }),
        exp({ payerId: "u2", yearMonth: "2026-09", flags: "PER_CASE" }),
      ],
    }));
    expect(t.find((x) => x.key === "flag")).toMatchObject({ title: "소명 없는 1건 — 수정에서 소명 입력", href: "/dashboard?ym=2026-10&check=unexplained#ledger" });
    // 소명이 있으면 할 일에서 빠진다
    const done = buildTodos(base({ expenses: [exp({ payerId: "u1", flags: "PER_PERSON", justification: "팀 회식" })] }));
    expect(done.some((x) => x.key === "flag")).toBe(false);
    expect(t.some((x) => x.title.includes("영수증"))).toBe(false);
  });

  it("지난 달 마감·상신 대상 (지출 없는 작성중 월은 제외)", () => {
    const t = buildTodos(base({
      expenses: [...base().expenses, exp({ yearMonth: "2026-08" })],
      closings: [{ yearMonth: "2026-09", status: "CLOSED", reviewNote: null }],
    }));
    expect(t.find((x) => x.key === "toclose")).toMatchObject({ title: "8월 마감 대기 — 마감하세요", href: "/closing?ym=2026-08" });
    expect(t.find((x) => x.key === "toclose")?.detail).toBe("팀원 입력 기한(9월 3일) 지남");
    expect(t.find((x) => x.key === "tosubmit")).toMatchObject({ title: "상신 대기 1건" });
  });

  it("오늘을 주면 마감 대상은 팀원 입력 기한(다음 달 3일)이 지난 달만 — 10월 3일까지 9월은 아직 작성중", () => {
    const o = { expenses: [...base().expenses, exp({ yearMonth: "2026-09" }), exp({ yearMonth: "2026-08" })], closings: [] };
    expect(buildTodos(base({ ...o, today: "2026-10-03" })).find((x) => x.key === "toclose")).toMatchObject({ title: "8월 마감 대기 — 마감하세요", href: "/closing?ym=2026-08" });
    expect(buildTodos(base({ ...o, today: "2026-10-04" })).find((x) => x.key === "toclose")).toMatchObject({ title: "8월, 9월 마감 대기 — 마감하세요", detail: "2개월", href: "/closing?ym=2026-08" });
  });

  it("반려는 사유와 함께 맨 앞, 상신은 승인 대기", () => {
    const t = buildTodos(base({
      closings: [
        { yearMonth: "2026-07", status: "APPROVED", reviewNote: null },
        { yearMonth: "2026-08", status: "REJECTED", reviewNote: "영수증 누락" },
        { yearMonth: "2026-09", status: "SUBMITTED", reviewNote: null },
      ],
    }));
    expect(t[0]).toMatchObject({ key: "rejected", tone: "danger", detail: "사유: 영수증 누락", href: "/closing?ym=2026-08" });
    expect(t.at(-1)).toMatchObject({ key: "submitted", title: "재무 승인 대기 1건", detail: "9월" });
  });
});

describe("PM 할 일 — 출입증·준비 단계", () => {
  it("출입증은 종류별로 하나씩 묶고 앞으로의 달은 빼며, 가장 오래된 달로 연결", () => {
    const t = buildTodos(base({
      passChecks: [
        { ym: "2026-09", count: 0, unmatched: 2 },
        { ym: "2026-08", count: 0, unmatched: 1 },
        { ym: "2026-10", count: 3 },
        { ym: "2026-11", count: 0, unmatched: 4 }, // 앞으로의 달 — 제외
      ],
    }));
    const pass = t.filter((x) => x.key === "pass");
    expect(pass.map((x) => [x.title, x.href])).toEqual([
      ["출입증 팀원 요청 3건", "/pass?ym=2026-10"],
      ["출입증 연결 안 된 이름 2개월", "/pass?ym=2026-08"],
    ]);
  });

  it("시작 준비가 덜 됐으면 '입력 없는 팀원' 독려는 하지 않는다", () => {
    const t = buildTodos(base({ setup: { hasBudget: false, hasMemberItems: true, hasMembers: true }, expenses: [] }));
    expect(t.map((x) => x.key)).toEqual(["setup"]);
  });
});
