// 로그인·비밀번호 확인 실패 기록·조회 (서버 전용) — 정책은 lib/auth-throttle.ts
// 로그인은 대개 한동안 쉬었다가 오는 첫 요청이라 Prisma(쿼리 컴파일러 준비) 없이 직접 SQL로 처리한다 (운영 CPU)
import "server-only";
import { newCuid, sqlExec, sqlInt, sqlRows } from "./db";
import { WINDOW_MS, throttleDecision, throttleIpKey, type FailureCounts, type ThrottleLimits } from "./auth-throttle";

export type ThrottleScope = "login" | "password" | "pm-reset";

/** 보관 기간 — 이보다 오래된 실패 기록은 기록할 때 함께 지운다 */
const KEEP_MS = 60 * 60_000;

/**
 * 최근 실패 수 (IP·IP+계정·계정·전체 1분) — 한 번의 조회로 함께 센다
 * (1분 창은 15분 창 안에 있으므로 15분 창의 행에서 조건별로 센다)
 */
async function counts(scope: ThrottleScope, ip: string | null, subject: string, now: number): Promise<FailureCounts> {
  const since = new Date(now - WINDOW_MS);
  const since1m = new Date(now - 60_000);
  const [r] = await sqlRows<Record<string, unknown>>(
    `SELECT
       SUM(CASE WHEN "ip" = ? THEN 1 ELSE 0 END) AS "ipN",
       SUM(CASE WHEN "ip" = ? AND "subject" = ? THEN 1 ELSE 0 END) AS "pairN",
       SUM(CASE WHEN "subject" = ? THEN 1 ELSE 0 END) AS "subjectN",
       SUM(CASE WHEN "at" >= ? THEN 1 ELSE 0 END) AS "globalN"
     FROM "AuthFailure" WHERE "scope" = ? AND "at" >= ?`,
    [ip ?? "", ip ?? "", subject, subject, since1m, scope, since <= since1m ? since : since1m],
  );
  const n = (v: unknown) => sqlInt(v) ?? 0;
  return { ip: ip ? n(r?.ipN) : null, pair: ip ? n(r?.pairN) : null, subject: n(r?.subjectN), global1m: n(r?.globalN) };
}

/**
 * 시도 전 확인 — 차단이면 block, 아니면 필요한 만큼 기다린 뒤 null.
 * 이번 시도를 검증 **전에** 먼저 기록하고 나서 센다: 검증 뒤에 실패를 기록하면 동시에 보낸 요청들이 같은 수를 보고
 * 모두 통과해 한도 × 동시 요청 수만큼 시도할 수 있다 (서버리스는 요청마다 다른 인스턴스라 메모리 직렬화도 없음).
 * 성공하면 호출자가 clearFailures로 지우므로 정상 사용자에게는 실패 수와 같다. 차단된 시도는 창을 늘리지 않게 바로 지운다.
 */
export async function checkThrottle(scope: ThrottleScope, rawIp: string | null, subject: string, limits: ThrottleLimits) {
  const ip = throttleIpKey(rawIp);
  const now = Date.now();
  const id = newCuid();
  await sqlExec(`INSERT INTO "AuthFailure" ("id", "scope", "ip", "subject", "at") VALUES (?, ?, ?, ?, ?)`, [id, scope, ip, subject.slice(0, 200), new Date(now)]);
  const c = await counts(scope, ip, subject, now);
  // 방금 넣은 이번 시도는 '이전 시도'가 아니므로 뺀다 (동시에 들어온 다른 요청의 행은 남아서 함께 세어진다)
  const prior: FailureCounts = { ip: c.ip === null ? null : c.ip - 1, pair: c.pair === null ? null : c.pair - 1, subject: c.subject - 1, global1m: c.global1m - 1 };
  const d = throttleDecision(prior, limits);
  if (d.block) {
    await sqlExec(`DELETE FROM "AuthFailure" WHERE "id" = ?`, [id]);
    return d.block;
  }
  await sqlExec(`DELETE FROM "AuthFailure" WHERE "at" < ?`, [new Date(now - KEEP_MS)]);
  if (d.delayMs) await new Promise((r) => setTimeout(r, d.delayMs));
  return null;
}

/** 성공하면 그 IP+계정의 실패 기록을 지운다 (정상 사용자가 몇 번 틀린 뒤 맞힌 경우) */
export async function clearFailures(scope: ThrottleScope, rawIp: string | null, subject: string) {
  const ip = throttleIpKey(rawIp);
  await sqlExec(`DELETE FROM "AuthFailure" WHERE "scope" = ? AND "subject" = ?${ip ? ` AND "ip" = ?` : ""}`, [scope, subject, ...(ip ? [ip] : [])]);
}
