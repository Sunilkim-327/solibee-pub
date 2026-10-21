import { describe, expect, it } from "vitest";
import { colText, sectionNameMissing, vendorColumns, type VendorSheetView, type VendorView } from "@/components/pass/vendorTable";

// 가상 데이터
const sheet = (p: Partial<VendorSheetView>): VendorSheetView => ({
  sheetName: "식당", label: "식당", explicitLabel: false, nameCol: "성명", amountCols: ["금액"], dateCol: "사용일", timeCol: null, links: [], ...p,
});
const items = [{ key: "상품", name: "상품명" }, { key: "매대", name: "매대" }];

describe("표시 항목 · 업체 연결 표", () => {
  it("업체마다 열 하나, 구분은 칩으로 — 시트 설정이 같은 열을 쓰면 칸에 값 하나", () => {
    const v: VendorView = { id: "v1", vendorName: "가상업체A", periodStartDay: 21, sheets: [sheet({ links: [{ item: "상품", col: "메뉴" }] }), sheet({ sheetName: "카페", label: "카페", links: [{ item: "상품", col: "메뉴" }] })] };
    const cols = vendorColumns([v], items);
    expect(cols).toHaveLength(1);
    expect(cols[0].sections.map((s) => s.label)).toEqual(["식당", "카페"]);
    expect([cols[0].cells["상품"], cols[0].cells["매대"], cols[0].cells["base:time"]]).toEqual([{ value: "메뉴" }, { value: null }, { value: null }]);
  });

  it("구분마다 연결 열이 다른 칸만 '구분: 열'로 나눈다 (같은 구분 이름이 여러 시트면 시트 이름을 붙임)", () => {
    const v: VendorView = {
      id: "v1", vendorName: "가상업체B", periodStartDay: 1, sheets: [
        sheet({ links: [{ item: "상품", col: "상품한글명" }] }),
        sheet({ sheetName: "Sheet1", label: "카페", explicitLabel: true, links: [{ item: "상품", col: "품목" }], amountCols: ["#6", "봉사료"] }),
        sheet({ sheetName: "Sheet2", label: "카페", explicitLabel: true, links: [{ item: "상품", col: "품목" }], amountCols: ["#6", "봉사료"], timeCol: "시각" }),
      ],
    };
    const [c] = vendorColumns([v], items);
    expect(c.cells["base:name"]).toEqual({ value: "성명" });
    expect(c.cells["상품"].parts).toEqual([{ label: "식당", value: "상품한글명" }, { label: "카페(Sheet1)·카페(Sheet2)", value: "품목" }]);
    expect(c.cells["base:amount"].parts?.map((p) => p.value)).toEqual(["금액", "G열 + 봉사료"]);
    expect(c.cells["base:time"].parts).toEqual([{ label: "식당·카페(Sheet1)", value: null }, { label: "카페(Sheet2)", value: "시각" }]);
  });

  it("구분 이름을 비워 시트 이름이 구분이 된 시트를 찾는다", () => {
    expect(sectionNameMissing({ sheetName: "Sheet1", explicitLabel: false })).toBe(true);
    expect(sectionNameMissing({ sheetName: "CSV", explicitLabel: false })).toBe(true);
    expect(sectionNameMissing({ sheetName: "(주)가상_개인별", explicitLabel: false })).toBe(true);
    expect(sectionNameMissing({ sheetName: "식당", explicitLabel: false })).toBe(false);
    expect(sectionNameMissing({ sheetName: "Sheet1", explicitLabel: true })).toBe(false);
    expect(colText("#0")).toBe("A열");
    expect(colText("#3")).toBe("D열");
    expect(colText("이름")).toBe("이름");
  });
});
