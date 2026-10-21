// 리프레시 토큰 기록 (서버 전용) — 판단은 lib/refresh-rotation.ts
// 로그인·재발급은 대개 쉬었다 오는 첫 요청이라 Prisma(쿼리 컴파일러 준비) 없이 직접 SQL로 처리한다 (운영 CPU)
import "server-only";
import { newCuid, sqlDate, sqlDateReq, sqlExec, sqlRows, sqlStr } from "./db";
import { newJti } from "./session";
import { rotationDecision, type RefreshRow } from "./refresh-rotation";

/** 만료된 기록은 하루 지나면 지운다 (새 계열을 시작할 때 함께) */
const KEEP_AFTER_EXP_MS = 24 * 60 * 60_000;

async function insert(userId: string, family: string, exp: Date, now: number): Promise<string> {
  const jti = newJti();
  await sqlExec(`INSERT INTO "RefreshToken" ("jti", "userId", "family", "issuedAt", "usedAt", "exp") VALUES (?, ?, ?, ?, NULL, ?)`, [jti, userId, family, new Date(now), exp]);
  return jti;
}

/** 새 계열 시작 (로그인·비밀번호 변경·예전 형식 토큰의 첫 재발급) → 첫 토큰의 jti */
export async function startRefreshFamily(userId: string, exp: Date, now = Date.now()): Promise<string> {
  await sqlExec(`DELETE FROM "RefreshToken" WHERE "exp" < ?`, [new Date(now - KEEP_AFTER_EXP_MS)]);
  return insert(userId, newCuid(), exp, now);
}

export type RotateResult = { status: "ok"; jti: string } | { status: "reuse" } | { status: "reject" };

/**
 * 토큰 회전: 기록을 찾아 사용 처리하고 같은 계열의 새 토큰 jti를 돌려준다.
 * reuse = 옛 토큰 재사용(탈취 의심) → 호출자가 sessionVersion을 올려 전부 로그아웃. reject = 모르는·만료된·남의 토큰
 */
export async function rotateRefreshToken(userId: string, jti: string, newExp: Date, now = Date.now()): Promise<RotateResult> {
  const [r] = await sqlRows<Record<string, unknown>>(`SELECT "userId", "family", "usedAt", "exp" FROM "RefreshToken" WHERE "jti" = ?`, [jti]);
  const row: RefreshRow | null = r ? { userId: sqlStr(r.userId) ?? "", family: sqlStr(r.family) ?? "", usedAt: sqlDate(r.usedAt), exp: sqlDateReq(r.exp) } : null;
  let d = rotationDecision(row, userId, now);
  if (d === "reuse") {
    // 유예가 지난 옛 토큰: 이 토큰 뒤에 발급된 같은 계열 토큰이 쓰인 적이 있는지 — 없으면 새 쿠키를 잃어버린 정상 사용자(탭 닫힘 등)
    const [c] = await sqlRows<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM "RefreshToken" WHERE "family" = ? AND "jti" <> ? AND "issuedAt" >= ? AND "usedAt" IS NOT NULL`,
      [row!.family, jti, row!.usedAt!],
    );
    d = rotationDecision(row, userId, now, Number(c?.n ?? 0) > 0);
  }
  if (d === "reject" || d === "reuse") return { status: d };
  // rotate: 사용 처리. 동시 요청이 먼저 처리해 0행이어도 방금(유예 안) 사용된 것이므로 그대로 새 토큰을 준다
  if (d === "rotate") await sqlExec(`UPDATE "RefreshToken" SET "usedAt" = ? WHERE "jti" = ? AND "usedAt" IS NULL`, [new Date(now), jti]);
  return { status: "ok", jti: await insert(userId, row!.family, newExp, now) };
}
