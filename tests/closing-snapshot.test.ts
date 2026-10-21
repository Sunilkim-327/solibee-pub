// 상신본·승인본 스냅샷 규칙 (lib/snapshot.ts 순수함수) — 설계 검토(2026-10-14) P0-2
import { describe, expect, it } from "vitest";
import {
  APPROVED_EXISTS, budgetLineDiff, budgetReasonProblem, closeDriftMessage, downloadStats, exportSuffix, fileStamp, formatBytes,
  latestSnapshot, nextSnapshotVersion, servedSnapshotKind, shortSha, workbookFilename,
} from "@/lib/snapshot";

describe("스냅샷 버전", () => {
  it("같은 마감 안에서 kind별로 1부터 올라간다", () => {
    expect(nextSnapshotVersion([], "SUBMIT")).toBe(1);
    const list = [{ kind: "SUBMIT", version: 1 }, { kind: "SUBMIT", version: 2 }, { kind: "APPROVE", version: 1 }];
    expect(nextSnapshotVersion(list, "SUBMIT")).toBe(3);
    expect(nextSnapshotVersion(list, "APPROVE")).toBe(2);
    expect(latestSnapshot(list, "SUBMIT")?.version).toBe(2);
    expect(latestSnapshot(list, "APPROVE")?.version).toBe(1);
    expect(latestSnapshot([{ kind: "SUBMIT", version: 1 }], "APPROVE")).toBeNull();
  });

  it("승인된 달은 승인본, 상신된 달은 상신본, 그 외는 현재 데이터", () => {
    expect(servedSnapshotKind("APPROVED")).toBe("APPROVE");
    expect(servedSnapshotKind("SUBMITTED")).toBe("SUBMIT");
    expect(servedSnapshotKind("CLOSED")).toBeNull();
    expect(servedSnapshotKind("REJECTED")).toBeNull();
    expect(servedSnapshotKind("DRAFT")).toBeNull();
  });
});

describe("파일 이름 규칙", () => {
  const at = new Date("2026-10-05T09:00:00Z"); // KST 18:00
  it("시각은 한국 시간 'YYYY-MM-DD HHmm'", () => {
    expect(fileStamp(at)).toBe("2026-10-05 1800");
    expect(fileStamp(new Date("2026-10-05T15:30:00Z"))).toBe("2026-10-06 0030");
  });
  it("상태 접미: 작성중·마감·상신·승인본·반려, 승인된 달의 현재 데이터는 수정본_현재", () => {
    expect(exportSuffix("DRAFT")).toBe("작성중");
    expect(exportSuffix("CLOSED")).toBe("마감");
    expect(exportSuffix("SUBMITTED")).toBe("상신");
    expect(exportSuffix("APPROVED")).toBe("승인본");
    expect(exportSuffix("APPROVED", true)).toBe("수정본_현재");
    expect(exportSuffix("REJECTED")).toBe("반려");
    expect(exportSuffix("CLOSED", true)).toBe("마감"); // live는 승인된 달에만 의미
  });
  it("ym 지정: 운영비(26.09)_상신_2026-10-05 1800.xlsx / ym 없음: 기존 규칙", () => {
    const base = { years: "2025-2026", name: "○○팀", ym: "2026-09", at };
    expect(workbookFilename({ ...base, status: "SUBMITTED" })).toBe("2025-2026 ○○팀 운영비(26.09)_상신_2026-10-05 1800.xlsx");
    expect(workbookFilename({ ...base, status: "APPROVED" })).toBe("2025-2026 ○○팀 운영비(26.09)_승인본_2026-10-05 1800.xlsx");
    expect(workbookFilename({ ...base, status: "APPROVED", live: true })).toBe("2025-2026 ○○팀 운영비(26.09)_수정본_현재_2026-10-05 1800.xlsx");
    expect(workbookFilename({ ...base, status: "DRAFT" })).toBe("2025-2026 ○○팀 운영비(26.09)_작성중_2026-10-05 1800.xlsx");
    expect(workbookFilename(base)).toBe("2025-2026 ○○팀 운영비(26.09).xlsx");
  });
});

describe("상신 전 마감 후 변경 감지", () => {
  it("마감 기록 총합계와 지금 총합계가 다르면 안내 (마감 N원 → 지금 M원)", () => {
    const msg = closeDriftMessage(JSON.stringify({ from: "DRAFT", to: "CLOSED", total: 1_250_000, hq: 0, pass: 0 }), 1_262_000);
    expect(msg).toContain("마감 1,250,000원 → 지금 1,262,000원");
    expect(msg).toContain("마감 해제 후 다시 마감");
    expect(closeDriftMessage({ total: 500 }, 600)).toContain("마감 500원");
  });
  it("같으면 통과, 총합계가 없는 옛 기록·기록 없음·깨진 JSON은 검사 생략", () => {
    expect(closeDriftMessage(JSON.stringify({ total: 1000 }), 1000)).toBeNull();
    expect(closeDriftMessage(JSON.stringify({ from: "DRAFT", to: "CLOSED" }), 1000)).toBeNull();
    expect(closeDriftMessage(null, 1000)).toBeNull();
    expect(closeDriftMessage("{not json", 1000)).toBeNull();
    expect(closeDriftMessage(JSON.stringify({ total: "1000" }), 1000)).toBeNull();
  });
});

describe("승인된 달이 있는 예산 변경 — 사유", () => {
  it("승인된 달이 없으면 사유 없이 통과", () => {
    expect(budgetReasonProblem([], undefined)).toBeNull();
    expect(budgetReasonProblem([], "")).toBeNull();
  });
  it("승인된 달이 있고 사유가 없으면 409 APPROVED_EXISTS + 승인된 달(정렬)", () => {
    const p = budgetReasonProblem(["2026-10", "2026-09"], undefined);
    expect(p?.status).toBe(409);
    expect(p?.extra).toEqual({ code: APPROVED_EXISTS, approvedMonths: ["2026-09", "2026-10"] });
    expect(budgetReasonProblem(["2026-09"], "   ")?.status).toBe(409);
  });
  it("사유 길이 10~300자", () => {
    expect(budgetReasonProblem(["2026-09"], "짧음")?.status).toBe(400);
    expect(budgetReasonProblem(["2026-09"], "변경계약 2차 반영으로 단가 조정")).toBeNull();
    expect(budgetReasonProblem(["2026-09"], "가".repeat(301))?.status).toBe(400);
    expect(budgetReasonProblem(["2026-09"], "가".repeat(300))).toBeNull();
  });
});

describe("예산 행별 diff (감사 기록)", () => {
  const l = (itemId: string, unitPrice: number, detail = "", bundleItemIds: string | null = null, periods = 12, changeId: string | null = null) => ({ itemId, detail, unitPrice, periods, changeId, bundleItemIds });
  it("바뀐 항목만 before/after 행으로, 순서만 바뀐 것은 제외", () => {
    const before = [l("a", 100), l("b", 200), l("c", 300, "상세")];
    const after = [l("b", 200), l("a", 150), l("d", 50)];
    const diff = budgetLineDiff(before, after);
    expect(diff.map((d) => d.itemId)).toEqual(["a", "c", "d"]);
    expect(diff[0]).toEqual({ itemId: "a", before: [{ detail: "", unitPrice: 100, periods: 12, changeId: null, bundleItemIds: null }], after: [{ detail: "", unitPrice: 150, periods: 12, changeId: null, bundleItemIds: null }] });
    expect(diff[1].after).toEqual([]); // 삭제
    expect(diff[2].before).toEqual([]); // 추가
  });
  it("한 항목에 여러 행이면 행 묶음으로 비교 (같은 구성이면 변경 없음)", () => {
    expect(budgetLineDiff([l("a", 1, "x"), l("a", 2, "y")], [l("a", 2, "y"), l("a", 1, "x")])).toEqual([]);
    expect(budgetLineDiff([l("a", 1, "x")], [l("a", 1, "x", '["b"]')])).toHaveLength(1);
  });
});

describe("표시 도우미", () => {
  it("다운로드 횟수·마지막 (감사 기록)", () => {
    const logs = [
      { entityId: "s1", userId: "u1", createdAt: new Date("2026-10-06T00:12:00Z") },
      { entityId: "s1", userId: "u2", createdAt: new Date("2026-10-05T10:00:00Z") },
      { entityId: "s1", userId: "u3", createdAt: new Date("2026-10-06T00:10:00Z") },
      { entityId: "s2", userId: "u1", createdAt: new Date("2026-10-01T00:00:00Z") },
    ];
    const st = downloadStats(logs);
    expect(st.get("s1")).toEqual({ count: 3, last: { at: new Date("2026-10-06T00:12:00Z"), userId: "u1" } });
    expect(st.get("s2")?.count).toBe(1);
    expect(st.has("s3")).toBe(false);
  });
  it("SHA-256 앞 12자, 파일 크기", () => {
    expect(shortSha("a1b2c3d4e5f6a7b8c9d0")).toBe("a1b2c3d4e5f6…");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(131_072)).toBe("128 KB");
    expect(formatBytes(1_258_291)).toBe("1.2 MB");
  });
});
