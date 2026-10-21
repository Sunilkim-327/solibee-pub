import { describe, expect, it } from "vitest";
import { originalEndDate, restoredEndDate } from "@/lib/change-extension";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;

describe("본계약 연장 되돌리기", () => {
  const original = d("2026-12-31");
  const c1 = { id: "c1", endDate: d("2027-03-31"), extendedFrom: original };
  const c2 = { id: "c2", endDate: d("2027-06-30"), extendedFrom: d("2027-03-31") };
  const plain = { id: "p", endDate: d("2026-10-31"), extendedFrom: null };

  it("연장한 과업 삭제 → 원래 종료일", () => {
    expect(iso(restoredEndDate(d("2027-03-31"), [c1, plain], [plain]))).toBe("2026-12-31");
  });
  it("나중 연장 과업 삭제 → 남은 연장 과업 종료일", () => {
    expect(iso(restoredEndDate(d("2027-06-30"), [c1, c2], [c1]))).toBe("2027-03-31");
  });
  it("종료일 단축 → 단축된 종료일까지", () => {
    expect(iso(restoredEndDate(d("2027-03-31"), [c1], [{ endDate: d("2027-01-31") }]))).toBe("2027-01-31");
  });
  it("기간 안에 둬야 할 날(지출 등)보다 줄이지 않음", () => {
    expect(iso(restoredEndDate(d("2027-03-31"), [c1], [], [d("2027-02-10")]))).toBe("2027-02-10");
  });
  it("연장 이력이 없거나 바뀌지 않으면 null", () => {
    expect(restoredEndDate(d("2026-12-31"), [plain], [])).toBeNull();
    expect(restoredEndDate(d("2027-03-31"), [c1], [c1])).toBeNull();
  });
});

describe("본계약 원 종료일 (originalEndDate) — 연장 전 종료일은 extendedFrom에 보존", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  it("연장 이력이 없으면 지금 종료일", () => {
    expect(iso(originalEndDate(d("2026-12-31"), [{ extendedFrom: null }]))).toBe("2026-12-31");
    expect(iso(originalEndDate(d("2026-12-31"), []))).toBe("2026-12-31");
  });
  it("여러 번 연장했으면 가장 이른 extendedFrom", () => {
    expect(iso(originalEndDate(d("2027-06-30"), [{ extendedFrom: d("2027-03-31") }, { extendedFrom: d("2026-12-31") }, { extendedFrom: null }]))).toBe("2026-12-31");
  });
});

describe("중간까지만 되돌린 경우 원 종료일 보존", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const iso = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;
  const c1 = { id: "c1", endDate: d("2027-03-31"), extendedFrom: d("2026-12-31") };
  it("1월 지출이 있어 1/31까지만 돌아가도 원 종료일은 extendedFrom에서 그대로 읽힌다", () => {
    const next = restoredEndDate(d("2027-03-31"), [c1], [{ endDate: d("2027-01-31") }], [d("2027-01-15")]);
    expect(iso(next)).toBe("2027-01-31");
    const after = [{ ...c1, endDate: d("2027-01-31") }];
    expect(iso(originalEndDate(d("2027-01-31"), after))).toBe("2026-12-31");
    // 지출이 없어진 뒤 다시 줄이면 원 종료일로
    expect(iso(restoredEndDate(d("2027-01-31"), after, [{ endDate: d("2026-12-31") }]))).toBe("2026-12-31");
  });
});
