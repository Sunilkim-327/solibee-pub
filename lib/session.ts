// HMAC 서명 쿠키 세션. (설계서의 NextAuth 대신 의존성 없는 최소 구현 — SSO 도입 시 교체)
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "opex_session";
export const REFRESH_COOKIE = "opex_refresh";
export const PROJECT_COOKIE = "opex_project";
/**
 * 로그인 유지 — 일반 웹앱 기준의 접근/리프레시 토큰 두 겹.
 * - 접근 토큰(세션 쿠키): 1시간. 지나면 리프레시 토큰으로 조용히 재발급 (미들웨어·API 클라이언트·SessionKeeper)
 * - 리프레시 토큰: 14일. 쓸 때마다 새로 발급되어 만료가 미뤄진다 → 14일 동안 접속이 없으면 다시 로그인
 * - 절대 만료: 최초 로그인(iat) 후 30일이 지나면 재발급 없이 다시 로그인
 * 로그아웃·비밀번호 변경·임시 비밀번호·역할 변경·비활성화는 User.sessionVersion을 올려 두 토큰 모두 무효.
 * - 리프레시 토큰에는 고유 번호(jti)가 있어 서버 기록(RefreshToken)과 대조한다. 쓴 토큰이 유예(30초) 뒤 다시 오면 복사된 것으로
 *   보고 그 사용자의 세션을 전부 끊는다 (lib/refresh-rotation.ts·refresh-store.ts).
 * 회사 보안 정책이 30분 무활동 만료를 요구하면 ACCESS_SEC·REFRESH_SEC만 줄이면 된다.
 */
export const ACCESS_SEC = 60 * 60;
export const REFRESH_SEC = 60 * 60 * 24 * 14;
export const ABSOLUTE_SEC = 60 * 60 * 24 * 30;

export const DEV_SECRET = "dev-only-secret";
export const MIN_SECRET_LENGTH = 32;

/** 운영 환경 SESSION_SECRET 점검 — 문제가 있으면 사유, 없으면 null */
export function sessionSecretProblem(s: string | undefined): string | null {
  if (!s) return "SESSION_SECRET 미설정";
  if (s === DEV_SECRET) return "SESSION_SECRET이 개발용 기본값입니다";
  if (s.length < MIN_SECRET_LENGTH) return `SESSION_SECRET은 ${MIN_SECRET_LENGTH}자 이상이어야 합니다`;
  return null;
}

let warned = false;
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    const problem = sessionSecretProblem(s);
    if (problem) throw new Error(problem);
    return s!;
  }
  if (!s && !warned) {
    warned = true;
    console.warn("[session] SESSION_SECRET 미설정 — 개발용 기본 키를 사용합니다. 운영 환경에서는 32자 이상 임의 값을 설정하세요.");
  }
  return s || DEV_SECRET;
}

type KeyKind = "session" | "refresh" | "purpose";

// 세션·리프레시·용도 한정 토큰은 서로 다른 파생 키로 서명 (한쪽 토큰을 다른 용도로 재사용 불가)
function sign(payload: string, kind: KeyKind): string {
  return createHmac("sha256", `${secret()}:${kind}`).update(payload).digest("base64url");
}

function encode(data: object, kind: KeyKind): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload, kind)}`;
}

function decode(token: string | undefined, kind: KeyKind): Record<string, unknown> | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, kind));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type SessionData = { uid: string; v: number; iat: number; exp: number };
/** 리프레시 토큰 내용 — jti는 회전 기록 대조용 (예전 형식 토큰은 null: 첫 재발급 때 새 계열로 등록) */
export type RefreshData = SessionData & { jti: string | null };

/** 리프레시 토큰 고유 번호 */
export const newJti = () => randomBytes(16).toString("hex");

/** 리프레시 토큰 만료 시각 (14일, 절대 만료는 넘지 못함) */
export function refreshExpiry(iat = Date.now(), now = Date.now()): Date {
  return new Date(Math.min(now + REFRESH_SEC * 1000, iat + ABSOLUTE_SEC * 1000));
}

/**
 * 접근 토큰(로그인 세션). v = 사용자 sessionVersion(증가하면 기존 세션 무효), iat = 최초 로그인 시각(재발급해도 유지)
 */
export function createSessionToken(userId: string, version: number, iat = Date.now(), now = Date.now()): string {
  const exp = Math.min(now + ACCESS_SEC * 1000, iat + ABSOLUTE_SEC * 1000);
  return encode({ uid: userId, v: version, iat, exp }, "session");
}

function readToken(token: string | undefined, kind: "session" | "refresh", now: number): SessionData | null {
  const d = decode(token, kind);
  if (!d) return null;
  // 용도 한정 토큰(p)은 로그인 세션으로 쓸 수 없다
  if (d.p !== undefined) return null;
  const { uid, v, iat, exp } = d;
  if (typeof uid !== "string" || typeof v !== "number" || typeof iat !== "number" || typeof exp !== "number") return null;
  if (exp <= now) return null; // 수명 만료
  if (now >= iat + ABSOLUTE_SEC * 1000) return null; // 절대 만료
  if (iat > now + 60_000) return null; // 미래 발급 시각
  return { uid, v, iat, exp };
}

export function readSessionToken(token: string | undefined, now = Date.now()): SessionData | null {
  return readToken(token, "session", now);
}

/** 리프레시 토큰 — 접근 토큰이 만료됐을 때 새 접근 토큰(과 새 리프레시 토큰)을 받는 용도. 세션 쿠키로는 쓸 수 없다 (다른 파생 키) */
export function createRefreshToken(userId: string, version: number, jti: string, iat = Date.now(), now = Date.now()): string {
  return encode({ uid: userId, v: version, iat, exp: refreshExpiry(iat, now).getTime(), jti }, "refresh");
}

export function readRefreshToken(token: string | undefined, now = Date.now()): RefreshData | null {
  const d = readToken(token, "refresh", now);
  if (!d) return null;
  const jti = decode(token, "refresh")?.jti;
  return { ...d, jti: typeof jti === "string" && /^[0-9a-f]{32}$/.test(jti) ? jti : null };
}

function cookieBase() {
  return {
    httpOnly: true,
    // Strict는 Soliday 등 외부 링크로 들어올 때 로그인이 풀려 보이므로 Lax 유지 (변경 요청은 미들웨어에서 Origin 검사)
    sameSite: "lax" as const,
    // 사내 PC에서 http로 띄우는 실사용 서버(pnpm serve, LOCAL_HTTP=1)는 휴대폰 접속(http://PC주소)을 위해 Secure 제외
    secure: process.env.NODE_ENV === "production" && process.env.LOCAL_HTTP !== "1",
    path: "/",
  };
}

/** 쿠키 수명 = 토큰 수명 (절대 만료가 가까우면 그만큼 짧게) */
const lifetime = (sec: number, iat: number, now: number) => Math.max(0, Math.min(sec, Math.floor((iat + ABSOLUTE_SEC * 1000 - now) / 1000)));

/** 선택한 프로젝트 쿠키 옵션 (1년) — 보안 규칙은 세션 쿠키와 같게 */
export function projectCookieOptions() {
  return { ...cookieBase(), maxAge: 60 * 60 * 24 * 365 };
}

/** 접근 토큰(세션) 쿠키 옵션 */
export function sessionCookieOptions(iat = Date.now(), now = Date.now()) {
  return { ...cookieBase(), maxAge: lifetime(ACCESS_SEC, iat, now) };
}

/** 리프레시 토큰 쿠키 옵션 */
export function refreshCookieOptions(iat = Date.now(), now = Date.now()) {
  return { ...cookieBase(), maxAge: lifetime(REFRESH_SEC, iat, now) };
}

type CookieSetter = { cookies: { set(name: string, value: string, opts: ReturnType<typeof sessionCookieOptions>): unknown; delete(name: string): unknown } };

/** 접근·리프레시 쿠키를 한 번에 발급 (로그인·재발급·비밀번호 변경 뒤). jti는 기록된 리프레시 토큰 번호, iat는 최초 로그인 시각 그대로 */
export function issueSessionCookies(res: CookieSetter, userId: string, version: number, jti: string, iat = Date.now(), now = Date.now()) {
  res.cookies.set(SESSION_COOKIE, createSessionToken(userId, version, iat, now), sessionCookieOptions(iat, now));
  res.cookies.set(REFRESH_COOKIE, createRefreshToken(userId, version, jti, iat, now), refreshCookieOptions(iat, now));
}

/** 두 쿠키 모두 삭제 (로그아웃·재발급 실패) */
export function clearSessionCookies(res: CookieSetter) {
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
}

/** 용도 한정 일회성 토큰 (예: Soliday 조직도 전송 링크). jti로 1회 사용 처리 */
export function createPurposeToken(purpose: string, userId: string, ttlSec: number, now = Date.now()): string {
  return encode({ p: purpose, uid: userId, jti: randomBytes(16).toString("hex"), exp: now + ttlSec * 1000 }, "purpose");
}

export function readPurposeTokenData(token: string | undefined, purpose: string, now = Date.now()): { uid: string; jti: string; exp: number } | null {
  const d = decode(token, "purpose");
  if (!d || d.p !== purpose) return null;
  if (typeof d.uid !== "string" || typeof d.jti !== "string" || typeof d.exp !== "number" || d.exp <= now) return null;
  return { uid: d.uid, jti: d.jti, exp: d.exp };
}

export function readPurposeToken(token: string | undefined, purpose: string, now = Date.now()): string | null {
  return readPurposeTokenData(token, purpose, now)?.uid ?? null;
}
