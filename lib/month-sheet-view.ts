// 재무 승인 검토 화면의 집행내역 묶음 — 순수함수 (화면 표현만, 엑셀 출력 lib/export.ts와 무관)
import { formatDate } from "./format";
import type { MonthSheetRow } from "./month-sheet";

export type SheetGroupRow = {
  row: MonthSheetRow;
  /** React key (지출 id, 출입증 줄은 라벨+원래 순번) */
  key: string;
  /** 묶음 안 바로 앞 줄과 같은 날 — 날짜를 흐리게 보일 때 */
  sameDate: boolean;
};
export type SheetGroup = { label: string; count: number; sum: number; rows: SheetGroupRow[] };

/**
 * 결제자별 묶음.
 * 월 시트 줄은 날짜순으로 오므로(엑셀 시트 순서) 같은 결제자 줄을 한데 모은다 — 연속만 묶으면 날짜마다 끊겨 묶음이 되지 않는다.
 * 묶음 순서: `order`(결제자 마스터 라벨, 직급→성명) → 그 밖(공용법인카드·마스터에 없는 사람)은 처음 나온 순.
 * 묶음 안 줄 순서는 원래 순서(날짜순) 그대로.
 */
export function groupByPayer(rows: MonthSheetRow[], order: string[] = []): SheetGroup[] {
  const byLabel = new Map<string, SheetGroup>();
  for (const label of order) if (!byLabel.has(label)) byLabel.set(label, { label, count: 0, sum: 0, rows: [] });
  rows.forEach((row, i) => {
    let g = byLabel.get(row.label);
    if (!g) byLabel.set(row.label, (g = { label: row.label, count: 0, sum: 0, rows: [] }));
    const prev = g.rows.at(-1)?.row;
    g.rows.push({ row, key: row.id ?? `${row.label}-${i}`, sameDate: !!prev && formatDate(prev.date) === formatDate(row.date) });
    g.count += 1;
    g.sum += row.amount;
  });
  // 줄이 없는 결제자(마스터에는 있지만 이 달 지출 없음)는 묶음을 만들지 않는다
  return [...byLabel.values()].filter((g) => g.count > 0);
}
