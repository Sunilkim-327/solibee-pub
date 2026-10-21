// 출입증 내역 파일(엑셀·CSV) → 시트 목록 (exceljs 사용, 서버·테스트용)
import ExcelJS from "exceljs";
import { won } from "./format";
import { decodeText, parseCsv, type Cell, type Sheet, type Table } from "./pass-statement";

// 한도·오류는 가벼운 모듈에 (서버 라우트가 엑셀 라이브러리 없이 쓰도록) — 여기서 다시 내보낸다
import { FileFormatError, LIMITS } from "./pass-import-limits";
export { FileFormatError, LIMITS };

/**
 * ZIP(xlsx) 목차(central directory)만 읽어 압축 해제 크기 합계·파일 수 확인 (내용은 풀지 않음).
 * 목차를 읽을 수 없으면 null
 */
export function zipStats(bytes: Uint8Array): { total: number; entries: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of Central Directory: 끝에서 22~(22+65535)바이트 안
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) return null;
    total += dv.getUint32(p + 24, true);
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return { total, entries };
}

/** CSV 파일은 시트 하나("CSV")로 다룬다 */
const CSV_SHEET = "CSV";

/** exceljs 셀 값 → Cell (수식은 결과값, 서식 문자열은 이어 붙임) */
function excelCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("formula" in v || "sharedFormula" in v) return excelCell(((v as { result?: unknown }).result ?? null) as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return String(v);
}

const isFormula = (v: ExcelJS.CellValue) => !!v && typeof v === "object" && ("formula" in v || "sharedFormula" in v);

/** 모든 시트 → 표 (수식 셀 위치 기록 — 합계 행 건너뛰기용) */
async function readXlsxSheets(bytes: Uint8Array): Promise<Sheet[]> {
  const z = zipStats(bytes);
  if (!z) throw new FileFormatError("엑셀 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인하세요.");
  if (z.total > LIMITS.unzippedBytes || z.entries > LIMITS.zipEntries) throw new FileFormatError("엑셀 파일 내용이 너무 큽니다. 필요한 시트만 남겨 다시 저장해 올려 주세요.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new FileFormatError("엑셀 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인하세요.");
  }
  if (!wb.worksheets.length) throw new FileFormatError("엑셀에 시트가 없습니다.");
  for (const ws of wb.worksheets) {
    if (ws.rowCount > LIMITS.rows || ws.columnCount > LIMITS.cols) {
      throw new FileFormatError(`'${ws.name}' 시트가 너무 큽니다 (최대 ${won(LIMITS.rows)}행·${LIMITS.cols}열). 빈 행·열을 지우고 다시 올려 주세요.`);
    }
  }
  return wb.worksheets.map((ws) => {
    const table: Table = [];
    const formulas = new Set<string>();
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: Cell[] = [];
      for (let c = 1; c <= row.cellCount; c++) {
        const v = row.getCell(c).value;
        if (isFormula(v)) formulas.add(`${n - 1}:${c - 1}`);
        cells.push(excelCell(v));
      }
      table[n - 1] = cells;
    });
    for (let i = 0; i < table.length; i++) table[i] ??= [];
    return { name: ws.name, table, formulas };
  });
}

/** 파일 이름·내용 → 시트 목록 (xlsx: 'PK' 서명, xls(구형)는 안내, 그 외는 CSV/TSV 텍스트) */
export async function fileToSheets(fileName: string, bytes: Uint8Array): Promise<Sheet[]> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isOle || (/\.xls$/i.test(fileName) && !isZip)) throw new FileFormatError("예전 엑셀(.xls) 형식은 읽을 수 없습니다. 엑셀에서 .xlsx 또는 .csv로 다시 저장해 올려 주세요.");
  if (isZip) return readXlsxSheets(bytes);
  const table = parseCsv(decodeText(bytes));
  if (table.length > LIMITS.rows || table.some((r) => r.length > LIMITS.cols)) throw new FileFormatError(`파일이 너무 큽니다 (최대 ${won(LIMITS.rows)}행·${LIMITS.cols}열).`);
  return [{ name: CSV_SHEET, table }];
}
