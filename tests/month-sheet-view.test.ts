// 재무 승인 검토 화면 집행내역 묶음 (가상의 값)
import { describe, expect, it } from "vitest";
import { groupByPayer } from "@/lib/month-sheet-view";
import type { MonthSheetRow } from "@/lib/month-sheet";

const row = (label: string, date: string, amount: number, id?: string): MonthSheetRow => ({
  label, date: new Date(`${date}T00:00:00Z`), amount, method: "개인법인카드", category: "식대", item: "야근식대", detail: "", headcount: null, attendees: null, id,
});

describe("groupByPayer", () => {
  it("날짜순 줄을 결제자별로 모으고, 묶음 순서는 마스터 순 → 처음 나온 순, 줄 순서는 원래대로", () => {
    const rows = [
      row("나", "2026-09-02", 10000, "e1"),
      row("공용법인카드", "2026-09-03", 50000, "e2"),
      row("가", "2026-09-03", 12000, "e3"),
      row("나", "2026-09-03", 8000, "e4"),
      row("나", "2026-09-03", 9000, "e5"),
      row("가", "2026-09-10", 7000, "e6"),
    ];
    const groups = groupByPayer(rows, ["가", "나", "다"]);
    expect(groups.map((g) => g.label)).toEqual(["가", "나", "공용법인카드"]); // '다'는 줄이 없어 묶음 없음
    expect(groups[0]).toMatchObject({ count: 2, sum: 19000 });
    expect(groups[0].rows.map((r) => r.key)).toEqual(["e3", "e6"]);
    expect(groups[1]).toMatchObject({ count: 3, sum: 27000 });
    expect(groups[1].rows.map((r) => r.sameDate)).toEqual([false, false, true]); // 02 → 03 → 03(같은 날)
    expect(groups[2].rows[0].sameDate).toBe(false);
  });

  it("순서 없이 부르면 처음 나온 순, 지출 id 없는 줄(출입증)은 라벨+순번 key", () => {
    const groups = groupByPayer([row("본사", "2026-09-30", 1000), row("본사", "2026-09-30", 2000)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.key)).toEqual(["본사-0", "본사-1"]);
    expect(groups[0].rows[1].sameDate).toBe(true);
    expect(groupByPayer([])).toEqual([]);
  });
});
