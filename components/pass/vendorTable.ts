// 출입증 '표시 열 · 업체 연결' 비교 표 모델 — 순수함수 (PM 설정 화면)
import { colLetter, type DisplayItem } from "@/lib/pass-statement";

/** 업체 서식의 시트 설정 요약 (화면용) */
export type VendorSheetView = {
  sheetName: string;
  /** 구분 (설정한 구분, 없으면 시트 이름) */
  label: string;
  /** 구분을 따로 정했는지 (안 정했으면 시트 이름이 구분이 됨) */
  explicitLabel: boolean;
  nameCol: string;
  amountCols: string[];
  dateCol: string | null;
  timeCol: string | null;
  links: { item: string; col: string }[];
};

export type VendorView = { id: string; vendorName: string; periodStartDay: number; sheets: VendorSheetView[] };

/** 표의 기본 열 행 (이름·금액·날짜·시간) */
export const BASE_ROWS = [
  { key: "base:name", name: "이름 열" },
  { key: "base:amount", name: "금액 열" },
  { key: "base:date", name: "날짜 열" },
  { key: "base:time", name: "시간 열" },
] as const;

/** "#3" → "D열" (lib/pass-statement refLabel과 같은 표기), 머리글은 그대로 */
export const colText = (c: string) => (/^#\d+$/.test(c) ? `${colLetter(Number(c.slice(1)))}열` : c);

/**
 * 구분 이름을 비워 시트 이름이 구분이 된 것으로 보이는지 — 구분을 따로 정하지 않았고 시트 이름이 일반적인 이름
 * (Sheet1·시트1·CSV, 숫자·괄호·밑줄이 든 파일용 이름, 긴 이름). 식당·카페처럼 짧은 이름은 구분으로 본다
 */
export function sectionNameMissing(s: Pick<VendorSheetView, "sheetName" | "explicitLabel">): boolean {
  if (s.explicitLabel) return false;
  const n = s.sheetName.trim();
  return /^(sheet|시트|csv)\s*\d*$/i.test(n) || /[\d()_[\]]/.test(n) || n.length > 8;
}

/** 칸 값: 모든 시트 설정이 같으면 value 하나, 구분마다 다르면 구분별 값 */
export type CellValue = { value: string | null; parts?: { label: string; value: string | null }[] };

export type TableColumn = {
  key: string;
  vendorId: string;
  vendorName: string;
  periodStartDay: number;
  sections: { label: string; missing: boolean }[];
  /** 행 키 → 연결된 원본 열 */
  cells: Record<string, CellValue>;
};

function cellsOf(s: VendorSheetView, items: DisplayItem[]): Record<string, string | null> {
  const out: Record<string, string | null> = {
    "base:name": colText(s.nameCol),
    "base:amount": s.amountCols.map(colText).join(" + ") || null,
    "base:date": s.dateCol ? colText(s.dateCol) : null,
    "base:time": s.timeCol ? colText(s.timeCol) : null,
  };
  for (const it of items) { const l = s.links.find((x) => x.item === it.key); out[it.key] = l ? colText(l.col) : null; }
  return out;
}

/**
 * 업체마다 열 하나 (구분은 칩으로). 한 행에서 시트 설정마다 연결 열이 다르면 그 칸만 '구분: 열'로 나눠 보여 준다.
 * 같은 구분 이름이 여러 시트에 있으면 시트 이름을 붙여 구분한다
 */
export function vendorColumns(vendors: VendorView[], items: DisplayItem[]): TableColumn[] {
  const rowKeys = [...BASE_ROWS.map((r) => r.key as string), ...items.map((i) => i.key)];
  return vendors.map((v) => {
    const per = v.sheets.map((sh) => ({ sh, cells: cellsOf(sh, items) }));
    const dupLabel = new Set(v.sheets.map((x) => x.label).filter((l, i, arr) => arr.indexOf(l) !== i));
    const labelOf = (sh: VendorSheetView) => (dupLabel.has(sh.label) ? `${sh.label}(${sh.sheetName})` : sh.label);
    const cells: Record<string, CellValue> = {};
    for (const k of rowKeys) {
      const byValue = new Map<string | null, string[]>();
      for (const p of per) byValue.set(p.cells[k] ?? null, [...(byValue.get(p.cells[k] ?? null) ?? []), labelOf(p.sh)]);
      cells[k] = byValue.size <= 1
        ? { value: per[0]?.cells[k] ?? null }
        : { value: null, parts: [...byValue].map(([value, labels]) => ({ label: [...new Set(labels)].join("·"), value })) };
    }
    return {
      key: v.id, vendorId: v.id, vendorName: v.vendorName, periodStartDay: v.periodStartDay,
      sections: [...new Map(v.sheets.map((x) => [x.label, { label: x.label, missing: sectionNameMissing(x) }])).values()],
      cells,
    };
  });
}

/** 정산 기간 짧은 표기 */
export const periodShort = (d: number) => (d === 1 ? "1일~말일" : `전월 ${d}일 ~ 당월 ${d - 1}일`);
