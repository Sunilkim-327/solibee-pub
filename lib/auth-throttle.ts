// 로그인·비밀번호 확인 실패 제한 — 순수함수 (실패 기록은 DB에 남겨 여러 서버 인스턴스가 공유: lib/auth-throttle-server.ts)
//
// 설계 (Cloudflare Workers는 요청마다 다른 인스턴스일 수 있어 메모리 제한기는 무력):
// - IP별: 15분에 실패 20회 → 그 IP 차단 (비밀번호 스프레이 — 계정마다 1~4회씩 여러 계정 — 를 막는다)
// - IP+계정별: 15분에 5회 → 그 IP에서 그 계정만 차단 (계정 잠금을 '그 IP에서의 실패'로 한정 →
//   아이디만 아는 공격자가 PM·재무 승인 계정을 계속 잠가도 다른 IP의 정상 로그인은 된다)
// - 계정별(모든 IP): 15분에 10회부터 점진 지연(0.5초씩, 최대 5초), 50회면 15분 차단
//   (여러 IP로 한 계정을 노리는 분산 대입을 늦추고, 차단은 IP 3개 이상을 다 소진해야 걸리게 해 잠금 악용을 어렵게)
// - 전체: 1분에 실패 100회 이상이면 모든 시도에 2초 지연 (대량 공격 시 속도 제한)
// - IP를 알 수 없으면(로컬 개발 등) 계정별 5회 차단 (예전 계정 잠금과 같음)

/**
 * 시도 제한용 IP 키 — IPv6는 /64 대역으로 묶는다 (한 가입자가 대역 안 주소를 마음껏 바꿔 IP별·IP+계정별 제한을 피하지 못하게).
 * IPv4·알 수 없는 형식은 그대로.
 */
export function throttleIpKey(ip: string | null): string | null {
  if (!ip) return null;
  const v = ip.trim().toLowerCase();
  if (!v.includes(":") || v.includes(".")) return v;
  const [head, tail = ""] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = v.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return v;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export const WINDOW_MS = 15 * 60_000;

export type ThrottleLimits = { ip: number; pair: number; subjectDelayFrom: number; subjectBlock: number; noIpSubject: number; global1m: number };

export const LOGIN_LIMITS: ThrottleLimits = { ip: 20, pair: 5, subjectDelayFrom: 10, subjectBlock: 50, noIpSubject: 5, global1m: 100 };
/** 비밀번호 변경(현재 비밀번호 확인) — 로그인한 본인만 하므로 계정별 5회 */
export const PASSWORD_LIMITS: ThrottleLimits = { ip: 20, pair: 5, subjectDelayFrom: 5, subjectBlock: 5, noIpSubject: 5, global1m: 100 };
/** PM의 팀원 임시 비밀번호 발급 — PM당 15분 10회 (반복 발급으로 팀원 로그인을 계속 끊는 일 방지) */
export const PM_RESET_LIMITS: ThrottleLimits = { ip: 20, pair: 10, subjectDelayFrom: 10, subjectBlock: 10, noIpSubject: 10, global1m: 100 };

/** 최근 실패 수 — ip·pair는 IP를 알 때만 */
export type FailureCounts = { ip: number | null; pair: number | null; subject: number; global1m: number };

export type ThrottleDecision = { block: null | "ip" | "pair" | "subject"; delayMs: number };

export function throttleDecision(c: FailureCounts, limits: ThrottleLimits): ThrottleDecision {
  if (c.ip !== null && c.ip >= limits.ip) return { block: "ip", delayMs: 0 };
  if (c.pair !== null && c.pair >= limits.pair) return { block: "pair", delayMs: 0 };
  if (c.ip === null && c.subject >= limits.noIpSubject) return { block: "subject", delayMs: 0 };
  if (c.subject >= limits.subjectBlock) return { block: "subject", delayMs: 0 };
  let delayMs = 0;
  if (c.subject >= limits.subjectDelayFrom) delayMs = Math.min(5000, (c.subject - limits.subjectDelayFrom + 1) * 500);
  if (c.global1m >= limits.global1m) delayMs = Math.max(delayMs, 2000);
  return { block: null, delayMs };
}

/** 차단 안내 (얼마나 기다려야 하는지 — 창 길이 기준) */
export const throttleMessage = (block: NonNullable<ThrottleDecision["block"]>) =>
  block === "pair"
    ? "이 접속 위치에서 로그인 실패가 반복되어 이 계정을 15분 동안 막았습니다. 15분 후 다시 시도하거나 시스템 관리자에게 요청하세요."
    : "시도 횟수가 너무 많습니다. 15분 후 다시 시도하세요.";
