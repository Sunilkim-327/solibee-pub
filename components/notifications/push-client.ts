// 브라우저 웹 푸시 — 순수 로직 (지원 여부·iOS 홈 화면 판정·키 변환·페이로드 해석·안전한 이동 경로)
// public/sw.js는 번들되지 않는 서비스 워커라 같은 규칙(safeHref·알림 옵션·클릭 이동 주소)을 그대로 복제해 두었다.
// 규칙을 바꾸면 sw.js도 함께 바꾸고 tests/push-client.test.ts가 둘 다 확인한다.

/** 푸시 알림 아이콘 (홈 화면 아이콘과 같은 S 마크) */
export const PUSH_ICON = "/icons/icon-192.png";
/** 안드로이드 상태 표시줄 작은 아이콘 — 단색 전용 아이콘이 없어 같은 S 마크 */
export const PUSH_BADGE = "/icons/icon-192.png";

/** 알림 화면을 진입점으로 쓰는 쿼리 — 다른 프로젝트 알림이면 여기서 프로젝트를 바꾼 뒤 href로 이동 */
export const PUSH_ENTRY_PATH = "/notifications";

export type PushEnv = {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  userAgent: string;
  /** navigator.maxTouchPoints — 데스크톱 모드 iPad(맥 UA) 판정용 */
  maxTouchPoints: number;
  /** display-mode: standalone 또는 navigator.standalone (iOS 홈 화면 앱) */
  standalone: boolean;
};

export type PushSupport = "supported" | "unsupported" | "ios-install";

/** iPhone·iPad (데스크톱 모드 iPad는 Macintosh UA + 터치) */
export function isIOS(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/**
 * 이 기기에서 푸시를 켤 수 있는지.
 * iOS는 16.4부터 '홈 화면에 추가'한 앱에서만 PushManager가 생기므로, 홈 화면 앱이 아니면 설치 안내를 먼저 보여 준다.
 */
export function pushSupport(env: PushEnv): PushSupport {
  const ok = env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (isIOS(env.userAgent, env.maxTouchPoints) && !env.standalone) return "ios-install";
  return ok ? "supported" : "unsupported";
}

/** VAPID 공개키(base64url) → Uint8Array (applicationServerKey) */
export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const clean = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 기존 구독의 applicationServerKey와 서버 공개키가 같은지 (다르면 재구독) — 키를 알 수 없으면 다르다고 본다 */
export function sameKey(current: ArrayBuffer | ArrayBufferView | null | undefined, expected: Uint8Array): boolean {
  if (!current) return false;
  const a = current instanceof ArrayBuffer ? new Uint8Array(current) : new Uint8Array(current.buffer, current.byteOffset, current.byteLength);
  if (a.length !== expected.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== expected[i]) return false;
  return true;
}

/** 같은 출처 상대경로만 허용 ('/'로 시작, '//'·'/\' 아님, 제어문자 없음) — 아니면 null */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  return value;
}

/** 프로젝트 id — 짧은 문자열만 (POST /api/session/project와 같은 제한) */
export function safeProjectId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[\w-]+$/.test(value) ? value : null;
}

export type PushPayload = { title: string; body?: string | null; href?: string | null; projectId?: string | null; tag?: string; id?: string };
export type PushNotice = {
  title: string;
  options: { body?: string; icon: string; badge: string; tag?: string; data: { href: string | null; projectId: string | null; id: string | null } };
};

/** 푸시 메시지(JSON 문자열) → showNotification 인자. 해석 못 하면 기본 제목으로 알림 화면을 연다 */
export function toNotice(raw: string | null | undefined): PushNotice {
  let p: Partial<PushPayload> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (v && typeof v === "object") p = v as Partial<PushPayload>;
  } catch {
    p = {};
  }
  const title = typeof p.title === "string" && p.title.trim() ? p.title : "Solibee 알림";
  const options: PushNotice["options"] = {
    icon: PUSH_ICON,
    badge: PUSH_BADGE,
    data: { href: safeHref(p.href), projectId: safeProjectId(p.projectId), id: typeof p.id === "string" && p.id.length <= 64 ? p.id : null },
  };
  if (typeof p.body === "string" && p.body) options.body = p.body;
  if (typeof p.tag === "string" && p.tag) options.tag = p.tag;
  return { title, options };
}

/** 알림 id — cuid 같은 영숫자만 */
export function safeNotificationId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[\w-]+$/.test(value) ? value : null;
}

/**
 * 알림을 눌렀을 때 열 주소.
 * - 알림 id가 있거나 프로젝트가 정해진 알림: 알림 화면 진입점(/notifications?read=…&go=…&project=…)으로 — 화면이 읽음 처리·프로젝트 전환 뒤 이동 (앱 내 알림 클릭과 같은 방식)
 * - 그 밖: href 그대로 · href 없으면 알림 화면
 */
export function clickTarget(data: { href?: unknown; projectId?: unknown; id?: unknown } | null | undefined): string {
  const href = safeHref(data?.href);
  const projectId = href ? safeProjectId(data?.projectId) : null;
  const id = safeNotificationId(data?.id);
  if (!id && !projectId) return href ?? PUSH_ENTRY_PATH;
  const q = new URLSearchParams();
  if (id) q.set("read", id);
  if (href) q.set("go", href);
  if (projectId) q.set("project", projectId);
  return `${PUSH_ENTRY_PATH}?${q.toString()}`;
}

export type PushEntry = { readId: string | null; href: string | null; projectId: string | null };

/** 알림 화면 진입점 쿼리 해석 — read(알림 id) 또는 go(안전한 경로)+project. 해당 없으면 null */
export function readPushEntry(search: string): PushEntry | null {
  const q = new URLSearchParams(search);
  const readId = safeNotificationId(q.get("read"));
  const href = safeHref(q.get("go"));
  const projectId = href ? safeProjectId(q.get("project")) : null;
  if (!readId && !(href && projectId)) return null;
  return { readId, href, projectId };
}
