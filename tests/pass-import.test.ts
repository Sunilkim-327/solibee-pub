import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { FileFormatError, LIMITS, fileToSheets, zipStats } from "@/lib/pass-import";

const xlsx = async (rows: (string | number)[][]) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("식당");
  rows.forEach((r) => ws.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
};

describe("zipStats (압축 해제 크기 미리 확인)", () => {
  it("xlsx의 항목 수·풀린 크기", async () => {
    const z = zipStats(await xlsx([["이름", "금액"], ["가", 1000]]));
    expect(z).not.toBeNull();
    expect(z!.entries).toBeGreaterThan(3);
    expect(z!.total).toBeGreaterThan(0);
    expect(z!.total).toBeLessThan(LIMITS.unzippedBytes);
  });
  it("zip이 아니면 null", () => {
    expect(zipStats(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(zipStats(new TextEncoder().encode("PK".padEnd(100, "x")))).toBeNull();
  });
});

describe("파일 크기 제한", () => {
  it("CSV 열 수 초과는 거절", async () => {
    const line = Array.from({ length: LIMITS.cols + 1 }, (_, i) => i).join(",");
    await expect(fileToSheets("a.csv", new TextEncoder().encode(line))).rejects.toBeInstanceOf(FileFormatError);
  });
  it("손상된 xlsx는 읽기 오류", async () => {
    await expect(fileToSheets("a.xlsx", new Uint8Array([0x50, 0x4b, 0, 0]))).rejects.toThrow(/읽을 수 없습니다/);
  });
});
