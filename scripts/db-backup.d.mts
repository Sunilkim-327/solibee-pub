/** SQLite DB 백업 — 백업 파일 경로 (SQLite가 아니거나 DB가 없으면 null) */
export function backupDb(label?: string): Promise<string | null>;
