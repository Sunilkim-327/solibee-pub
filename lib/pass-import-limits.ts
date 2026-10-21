// 출입증 파일 읽기 한도·오류 (가벼운 모듈 — 엑셀 라이브러리 없이 서버 라우트가 불러올 수 있게, 본체는 lib/pass-import.ts)

export class FileFormatError extends Error {}

/** 압축을 풀었을 때 최대 크기·파일 수, 시트 최대 행·열 (압축 폭탄·거대 시트로 서버 메모리가 바닥나는 것을 막음) */
export const LIMITS = { unzippedBytes: 80 * 1024 * 1024, zipEntries: 2000, rows: 50_000, cols: 300 };
