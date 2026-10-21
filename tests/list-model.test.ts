import { describe, expect, it } from "vitest";
import { duplicateNames, groupByDay, initialOf, kstParts, settlementMonthCells, sortRows } from "@/components/list/model";

describe("목록 공통 도우미", () => {
  it("groupByDay: 처음 나온 순서 유지, 합계, 날짜 없음은 한 묶음", () => {
    const rows = [
      { d: "2026-10-05", a: 100 }, { d: "2026-10-06", a: 50 }, { d: "2026-10-05", a: 20 }, { d: null, a: 1 }, { d: undefined, a: 2 },
    ];
    const g = groupByDay(rows, (r) => r.d, (r) => r.a);
    expect(g.map((x) => [x.date, x.items.length, x.total])).toEqual([["2026-10-05", 2, 120], ["2026-10-06", 1, 50], ["", 2, 3]]);
  });
  it("groupByDay: 월 키·일시 문자열도 앞 10자리로", () => {
    expect(groupByDay(["2026-10", "2026-09", "2026-10"], (s) => s).map((x) => x.date)).toEqual(["2026-10", "2026-09"]);
    expect(groupByDay(["2026-10-05T10:00"], (s) => s)[0].date).toBe("2026-10-05");
  });
  it("initialOf: 첫 글자, 비면 ?", () => {
    expect(initialOf("김하늘")).toBe("김");
    expect(initialOf(" kim")).toBe("K");
    expect(initialOf("")).toBe("?");
  });
  it("duplicateNames: 동명이인만", () => {
    expect([...duplicateNames([{ name: "이서준" }, { name: "박지민" }, { name: "이서준" }])]).toEqual(["이서준"]);
  });
  it("sortRows: 날짜순(같은 날 원래 순서) / 금액 큰 순", () => {
    const rows = [{ id: 1, date: "2026-10-06", amount: 10 }, { id: 2, date: "2026-10-05", amount: 30 }, { id: 3, date: "2026-10-06", amount: 30 }];
    expect(sortRows(rows, "date").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortRows(rows, "amount").map((r) => r.id)).toEqual([2, 3, 1]);
  });
  it("kstParts: 한국 시간 날짜·시각", () => {
    expect(kstParts(new Date("2026-10-11T15:30:05Z"))).toEqual({ day: "2026-10-12", time: "00:30:05" });
  });
});

describe("내 정산 월별 행 (settlementMonthCells)", () => {
  it("받을 돈·공제: 0은 '-', 확정 전은 예정(회색), 확정은 확정(붉은 글자)", () => {
    expect(settlementMonthCells({ amount: 54000, deduct: { amount: 12000, confirmed: false } }))
      .toEqual({ receive: "54,000", deduct: "12,000", deductTone: "pending", deductWord: "예정" });
    expect(settlementMonthCells({ amount: 0, deduct: { amount: 5000, confirmed: true } }))
      .toEqual({ receive: "-", deduct: "5,000", deductTone: "confirmed", deductWord: "확정" });
    // 출입증을 안 쓰거나 공제 0원이면 none
    expect(settlementMonthCells({ amount: 15000 })).toMatchObject({ receive: "15,000", deduct: "-", deductTone: "none", deductWord: "" });
    expect(settlementMonthCells({ amount: 15000, deduct: { amount: 0, confirmed: true } }).deductTone).toBe("none");
  });
});
