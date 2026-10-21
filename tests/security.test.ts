import { describe, expect, it } from "vitest";
import { maskLoginInput } from "@/lib/auth-policy";
import { LOGIN_LIMITS, PASSWORD_LIMITS, throttleDecision, throttleIpKey, type FailureCounts } from "@/lib/auth-throttle";
import { csrfProblem } from "@/lib/csrf";
import { verifyDummyPassword } from "@/lib/password";
import {
  ABSOLUTE_SEC,
  ACCESS_SEC,
  DEV_SECRET,
  REFRESH_SEC,
  createPurposeToken,
  createRefreshToken,
  createSessionToken,
  newJti,
  readPurposeToken,
  readPurposeTokenData,
  readRefreshToken,
  readSessionToken,
  refreshCookieOptions,
  refreshExpiry,
  sessionCookieOptions,
  sessionSecretProblem,
} from "@/lib/session";

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const JTI = "0123456789abcdef0123456789abcdef";
const MIN = 60_000;

describe("세션 토큰", () => {
  it("발급한 토큰을 읽으면 uid·버전·최초 로그인 시각", () => {
    const t = createSessionToken("u1", 3, T0, T0);
    expect(readSessionToken(t, T0 + MIN)).toMatchObject({ uid: "u1", v: 3, iat: T0 });
  });

  it("접근 토큰은 1시간이면 만료", () => {
    expect(ACCESS_SEC).toBe(3600);
    const t = createSessionToken("u1", 0, T0, T0);
    expect(readSessionToken(t, T0 + ACCESS_SEC * 1000 - 1)).not.toBeNull();
    expect(readSessionToken(t, T0 + ACCESS_SEC * 1000)).toBeNull();
  });

  it("재발급해도 최초 로그인 30일 뒤에는 만료 (절대 만료)", () => {
    expect(ABSOLUTE_SEC).toBe(30 * 24 * 3600);
    const now = T0 + ABSOLUTE_SEC * 1000 - 5 * MIN;
    const refreshed = createSessionToken("u1", 0, T0, now);
    // 토큰 만료가 절대 만료 시각으로 잘림
    expect(readSessionToken(refreshed, now + 4 * MIN)).not.toBeNull();
    expect(readSessionToken(refreshed, T0 + ABSOLUTE_SEC * 1000)).toBeNull();
    expect(sessionCookieOptions(T0, now).maxAge).toBe(5 * 60);
    expect(sessionCookieOptions(T0, T0).maxAge).toBe(ACCESS_SEC);
  });

  it("리프레시 토큰은 14일, 쓸 때마다 새로 발급되어 미뤄지고 절대 만료는 넘지 못한다", () => {
    expect(REFRESH_SEC).toBe(14 * 24 * 3600);
    const r = createRefreshToken("u1", 2, JTI, T0, T0);
    expect(readRefreshToken(r, T0 + REFRESH_SEC * 1000 - 1)).toMatchObject({ uid: "u1", v: 2, iat: T0 });
    expect(readRefreshToken(r, T0 + REFRESH_SEC * 1000)).toBeNull();
    // 13일째 재발급 → 그로부터 14일
    const day13 = T0 + 13 * 24 * 3600 * 1000;
    const r2 = createRefreshToken("u1", 2, JTI, T0, day13);
    expect(readRefreshToken(r2, day13 + REFRESH_SEC * 1000 - 1)).not.toBeNull();
    expect(refreshCookieOptions(T0, day13).maxAge).toBe(REFRESH_SEC);
    // 20일째 재발급 → 30일 절대 만료에서 잘림
    const day20 = T0 + 20 * 24 * 3600 * 1000;
    const r3 = createRefreshToken("u1", 2, JTI, T0, day20);
    expect(readRefreshToken(r3, T0 + ABSOLUTE_SEC * 1000 - 1)).not.toBeNull();
    expect(readRefreshToken(r3, T0 + ABSOLUTE_SEC * 1000)).toBeNull();
    expect(refreshCookieOptions(T0, day20).maxAge).toBe(10 * 24 * 3600);
  });

  it("리프레시 토큰은 jti를 품고, 예전 형식(jti 없음)·형식이 다른 jti는 null로 읽힌다", () => {
    expect(readRefreshToken(createRefreshToken("u1", 1, JTI, T0, T0), T0 + MIN)?.jti).toBe(JTI);
    expect(readRefreshToken(createRefreshToken("u1", 1, "", T0, T0), T0 + MIN)?.jti).toBeNull();
    expect(newJti()).toMatch(/^[0-9a-f]{32}$/);
    expect(newJti()).not.toBe(newJti());
    expect(refreshExpiry(T0, T0).getTime()).toBe(T0 + REFRESH_SEC * 1000);
  });
  it("리프레시 토큰은 세션으로, 세션 토큰은 리프레시로 쓸 수 없다 (별도 파생 키)", () => {
    expect(readSessionToken(createRefreshToken("u1", 0, JTI, T0, T0), T0)).toBeNull();
    expect(readRefreshToken(createSessionToken("u1", 0, T0, T0), T0)).toBeNull();
  });

  it("서명 변조·형식 오류는 거부", () => {
    const t = createSessionToken("u1", 0, T0, T0);
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", v: 0, iat: T0, exp: T0 + ACCESS_SEC * 1000 })).toString("base64url");
    expect(readSessionToken(`${forged}.${sig}`, T0)).toBeNull();
    expect(readSessionToken(`${payload}.`, T0)).toBeNull();
    expect(readSessionToken(`${t}.x`, T0)).toBeNull();
    expect(readSessionToken(undefined, T0)).toBeNull();
  });

  it("용도 한정 토큰은 세션으로 쓸 수 없고, 세션 토큰도 용도 토큰으로 쓸 수 없다 (별도 파생 키)", () => {
    const p = createPurposeToken("directory-push", "u1", 600, T0);
    expect(readSessionToken(p, T0)).toBeNull();
    const s = createSessionToken("u1", 0, T0, T0);
    expect(readPurposeToken(s, "directory-push", T0)).toBeNull();
  });

  it("용도 토큰: 용도·만료 확인, 매번 다른 jti", () => {
    const a = createPurposeToken("directory-push", "u1", 600, T0);
    const b = createPurposeToken("directory-push", "u1", 600, T0);
    expect(readPurposeToken(a, "directory-push", T0)).toBe("u1");
    expect(readPurposeToken(a, "other", T0)).toBeNull();
    expect(readPurposeToken(a, "directory-push", T0 + 600_000)).toBeNull();
    expect(readPurposeTokenData(a, "directory-push", T0)!.jti).not.toBe(readPurposeTokenData(b, "directory-push", T0)!.jti);
  });

  it("운영용 SESSION_SECRET 점검", () => {
    expect(sessionSecretProblem(undefined)).not.toBeNull();
    expect(sessionSecretProblem(DEV_SECRET)).not.toBeNull();
    expect(sessionSecretProblem("short-secret")).not.toBeNull();
    expect(sessionSecretProblem("x".repeat(32))).toBeNull();
  });
});

describe("시도 제한 (DB 실패 기록 — 서버 인스턴스 간 공유)", () => {
  const c = (o: Partial<FailureCounts> = {}): FailureCounts => ({ ip: 0, pair: 0, subject: 0, global1m: 0, ...o });
  it("IP당 20회면 그 IP 차단 (계정마다 몇 번씩 시도하는 스프레이)", () => {
    expect(throttleDecision(c({ ip: 19 }), LOGIN_LIMITS).block).toBeNull();
    expect(throttleDecision(c({ ip: 20 }), LOGIN_LIMITS).block).toBe("ip");
  });
  it("같은 IP·같은 계정 5회면 그 IP에서만 막는다 — 다른 IP(정상 사용자)는 계정 실패가 쌓여도 지연만", () => {
    expect(throttleDecision(c({ pair: 5, subject: 5 }), LOGIN_LIMITS).block).toBe("pair");
    expect(throttleDecision(c({ pair: 0, subject: 12 }), LOGIN_LIMITS)).toEqual({ block: null, delayMs: 1500 });
    expect(throttleDecision(c({ pair: 0, subject: 49 }), LOGIN_LIMITS).delayMs).toBe(5000);
    expect(throttleDecision(c({ pair: 0, subject: 50 }), LOGIN_LIMITS).block).toBe("subject");
  });
  it("전체 실패 급증이면 지연, IP를 모르면 계정 5회 차단", () => {
    expect(throttleDecision(c({ global1m: 100 }), LOGIN_LIMITS).delayMs).toBe(2000);
    expect(throttleDecision({ ip: null, pair: null, subject: 5, global1m: 0 }, LOGIN_LIMITS).block).toBe("subject");
    expect(throttleDecision({ ip: null, pair: null, subject: 4, global1m: 0 }, LOGIN_LIMITS).block).toBeNull();
  });
  it("비밀번호 변경은 계정 5회 실패면 차단", () => {
    expect(throttleDecision(c({ subject: 5 }), PASSWORD_LIMITS).block).toBe("subject");
  });
});

describe("로그인 보조", () => {
  it("감사 로그용 아이디 마스킹: 원문 미포함·대소문자 무시", () => {
    const m = maskLoginInput(" Hong@Example.com ");
    expect(m).toMatch(/^id#[0-9a-f]{12}$/);
    expect(m).not.toContain("hong");
    expect(maskLoginInput("hong@example.com")).toBe(m);
  });

  it("없는 계정용 더미 검증은 항상 실패", () => {
    expect(verifyDummyPassword("anything")).toBe(false);
  });
});

describe("CSRF (Origin 검사)", () => {
  const base = { pathname: "/api/expenses/1", origin: null, referer: null, allowedHosts: ["app.example.com"] };
  it("GET·HEAD·OPTIONS는 통과", () => {
    expect(csrfProblem({ ...base, method: "GET" })).toBeNull();
    expect(csrfProblem({ ...base, method: "OPTIONS" })).toBeNull();
  });
  it("같은 호스트 Origin은 통과, 다른 호스트·null·누락은 거부", () => {
    expect(csrfProblem({ ...base, method: "POST", origin: "https://app.example.com" })).toBeNull();
    expect(csrfProblem({ ...base, method: "POST", origin: "https://evil.example.com" })).not.toBeNull();
    expect(csrfProblem({ ...base, method: "DELETE", origin: "null" })).not.toBeNull();
    expect(csrfProblem({ ...base, method: "PATCH" })).not.toBeNull();
  });
  it("Origin이 없으면 Referer로 판단", () => {
    expect(csrfProblem({ ...base, method: "POST", referer: "https://app.example.com/expenses" })).toBeNull();
    expect(csrfProblem({ ...base, method: "POST", referer: "https://evil.com/x" })).not.toBeNull();
  });
  it("포트까지 비교", () => {
    expect(csrfProblem({ ...base, method: "POST", origin: "http://localhost:3001", allowedHosts: ["localhost:3000"] })).not.toBeNull();
    expect(csrfProblem({ ...base, method: "POST", origin: "http://localhost:3000", allowedHosts: ["localhost:3000"] })).toBeNull();
  });
  it("북마클릿 전송 엔드포인트는 제외, API 외 경로는 대상 아님", () => {
    expect(csrfProblem({ ...base, method: "POST", pathname: "/api/directory/push", origin: "https://soliday.example.com" })).toBeNull();
    expect(csrfProblem({ ...base, method: "POST", pathname: "/api/directory/pushx", origin: "https://evil.com" })).not.toBeNull();
    expect(csrfProblem({ ...base, method: "POST", pathname: "/login", origin: "https://evil.com" })).toBeNull();
  });
});

describe("JSON 본문 크기 상한", () => {
  const big = JSON.stringify({ x: "a".repeat(2 * 1024 * 1024) });
  const req = (body: string, headers: Record<string, string> = {}) => new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
  it("Content-Length가 상한을 넘으면 413, 없거나 거짓이어도 읽다가 413", async () => {
    const { readJson } = await import("@/lib/access");
    await expect(readJson(req(big, { "content-length": String(big.length) }))).rejects.toMatchObject({ status: 413 });
    const stream = new Request("http://x/api", { method: "POST", body: new Blob([big]).stream(), headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit & { duplex: "half" });
    await expect(readJson(stream)).rejects.toMatchObject({ status: 413 });
    await expect(readJson(req(JSON.stringify({ a: 1 })))).resolves.toEqual({ a: 1 });
    await expect(readJson(req(JSON.stringify({ p: "x".repeat(20_000) })), 16 * 1024)).rejects.toMatchObject({ status: 413 });
  });
});

describe("시도 제한 IP 키", () => {
  it("IPv6는 /64 대역으로 묶는다", () => {
    expect(throttleIpKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(throttleIpKey("2001:0DB8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(throttleIpKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(throttleIpKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(throttleIpKey("2001:db8:1:2::9"));
  });
  it("IPv4·알 수 없음은 그대로", () => {
    expect(throttleIpKey("203.0.113.7")).toBe("203.0.113.7");
    expect(throttleIpKey("::ffff:203.0.113.7")).toBe("::ffff:203.0.113.7");
    expect(throttleIpKey(null)).toBeNull();
  });
});
