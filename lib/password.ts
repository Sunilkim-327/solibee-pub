import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 검증 시간 맞추기용 해시 — 버린 임의 비밀번호로 만든 고정 값 (같은 scrypt 설정).
 * 예전에는 격리(isolate)마다 처음 한 번 만들어서 그 요청만 scrypt를 두 번 돌렸다 (운영 CPU 한도). 결과는 항상 false라 값의 비밀성은 무관.
 */
const DUMMY_HASH =
  "080786c6fb0486197225a0973072106c:9d60ce88755e7224847f2c30044d60f0d7e39b72cc78cfeb361230e09497a3974a69fd11b1f880987736cf232e40e7d8c73019d5f6971e9705ea0c503143f544";
/** 없는 계정에도 같은 시간만큼 검증해 계정 존재 여부가 응답 시간으로 드러나지 않게 */
export function verifyDummyPassword(password: string): false {
  verifyPassword(password, DUMMY_HASH);
  return false;
}
