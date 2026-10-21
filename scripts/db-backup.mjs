// SQLite DB 백업 — prisma/backups/<db이름>-YYYYMMDD-HHMMSS.db (최근 30개 보관)
// 사용: pnpm db:backup  (개발 서버 시작 시 predev로 자동 실행)
// 실행 중인 서버가 있어도 일관된 사본을 만들도록 SQLite "VACUUM INTO"를 사용한다.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = 30;
const quiet = process.argv.includes("--quiet");

export async function backupDb(label = "") {
  const url = process.env.DATABASE_URL ?? readEnvUrl();
  if (!url?.startsWith("file:")) return null; // SQLite가 아니면 (운영 DB) 건너뜀 — 운영은 DB 자체 백업 사용
  const dbFile = path.resolve(root, "prisma", url.slice("file:".length));
  if (!existsSync(dbFile)) return null;
  const dir = path.join(root, "prisma", "backups");
  mkdirSync(dir, { recursive: true });
  const ts = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = path.basename(dbFile, ".db");
  const target = path.join(dir, `${base}-${ts}${label ? `-${label}` : ""}.db`);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    await prisma.$disconnect();
  }
  // 오래된 백업 정리
  const files = readdirSync(dir).filter((f) => f.startsWith(`${base}-`) && f.endsWith(".db")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) rmSync(path.join(dir, f));
  return target;
}

function readEnvUrl() {
  try {
    const env = readFileSync(path.join(root, ".env"), "utf8");
    return env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)?.[1];
  } catch {
    return undefined;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backupDb(process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "")
    .then((t) => { if (!quiet || t) console.log(t ? `DB 백업: ${path.relative(root, t)}` : "백업할 DB가 없습니다."); })
    .catch((e) => { console.error("DB 백업 실패:", e.message); process.exitCode = quiet ? 0 : 1; });
}
