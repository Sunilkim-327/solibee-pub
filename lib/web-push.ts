// 웹 푸시 발송 — RFC 8291(페이로드 암호화, aes128gcm) + RFC 8292(VAPID).
// 외부 패키지 없이 Web Crypto만 사용 — Node 22·Cloudflare Workers 공통 (node:crypto·Buffer 금지).

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushOptions = {
  ttl?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  topic?: string;
};

type Bytes = Uint8Array<ArrayBuffer>;

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

/** 레코드 크기 (단일 레코드) */
export const RECORD_SIZE = 4096;
/** 헤더 86 + 태그 16 + 구분자 1을 빼고 본문 전체가 4096바이트를 넘지 않게 */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 86 - 16 - 1;

// ── base64url ──

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str: string): Bytes {
  const clean = str.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ── 키 가져오기 ──

/** 65바이트 비압축 P-256 점 → JWK x·y */
function pointToXY(pub: Uint8Array): { x: string; y: string } {
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("공개키는 65바이트 비압축 P-256 점이어야 합니다");
  return { x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33, 65)) };
}

function privateJwk(publicKey: string, privateKey: string): JsonWebKey {
  const d = b64urlDecode(privateKey);
  if (d.length !== 32) throw new Error("개인키는 32바이트여야 합니다");
  return { kty: "EC", crv: "P-256", ...pointToXY(b64urlDecode(publicKey)), d: b64urlEncode(d), ext: true };
}

/** raw 공개키(base64url)·d(base64url) → ECDH 키쌍 (송신측 키 주입·테스트용) */
export async function importEcdhKeyPair(publicKey: string, privateKey: string): Promise<CryptoKeyPair> {
  const alg = { name: "ECDH", namedCurve: "P-256" };
  const priv = await subtle().importKey("jwk", privateJwk(publicKey, privateKey), alg, true, ["deriveBits"]);
  const pub = await subtle().importKey("raw", b64urlDecode(publicKey), alg, true, []);
  return { publicKey: pub, privateKey: priv };
}

// ── HKDF ──

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// ── RFC 8291 페이로드 암호화 ──

export type EncryptOptions = { localKeyPair?: CryptoKeyPair; salt?: Uint8Array };

/** aes128gcm 본문(헤더 + 단일 레코드) 생성. 송신측 임시 키쌍·salt는 테스트용으로 주입 가능 */
export async function encryptPayload(
  payload: string | Uint8Array,
  sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  opts: EncryptOptions = {},
): Promise<Bytes> {
  const plaintext = typeof payload === "string" ? enc.encode(payload) : payload;
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error(`푸시 페이로드가 너무 큽니다 (최대 ${MAX_PAYLOAD_BYTES}바이트)`);

  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65) throw new Error("구독 p256dh 키가 올바르지 않습니다");
  if (authSecret.length !== 16) throw new Error("구독 auth 값이 올바르지 않습니다");

  const ecdh = { name: "ECDH", namedCurve: "P-256" };
  const local =
    opts.localKeyPair ?? ((await subtle().generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await subtle().exportKey("raw", local.publicKey));
  const salt = opts.salt ? concat(opts.salt) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("salt는 16바이트여야 합니다");

  // 공유 비밀 → IKM (auth_secret으로 결합)
  const uaKey = await subtle().importKey("raw", uaPublic, ecdh, false, []);
  const ecdhSecret = new Uint8Array(
    await subtle().deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256),
  );
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // CEK·NONCE (RFC 8188)
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 단일(마지막) 레코드 — 패딩 구분자 0x02
  const record = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  // 헤더: salt(16) | rs(4, BE) | idlen(1) | keyid(as_public 65)
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

// ── RFC 8292 VAPID ──

/** ES256 JWT (aud = endpoint origin, exp = 지금 + 12시간) */
export async function createVapidJwt(audience: string, vapid: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: audience, exp: nowSec + 12 * 60 * 60, sub: vapid.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const key = await subtle().importKey(
    "jwk",
    privateJwk(vapid.publicKey, vapid.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Web Crypto 서명은 이미 IEEE P1363(r||s 64바이트) — JWT에 그대로 사용
  const sig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `${unsigned}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** 푸시 서비스로 보낼 fetch 인자 생성 */
export async function buildPushRequest(
  sub: PushSubscriptionKeys,
  payload: string,
  vapid: VapidKeys,
  opts: PushOptions = {},
): Promise<{ url: string; init: RequestInit }> {
  if (!/^(mailto:|https:\/\/)/.test(vapid.subject)) throw new Error("VAPID subject는 mailto: 또는 https URL이어야 합니다");
  const url = new URL(sub.endpoint);
  if (url.protocol !== "https:") throw new Error("푸시 endpoint는 https여야 합니다");

  const ttl = opts.ttl ?? 86400;
  if (!Number.isInteger(ttl) || ttl < 0) throw new Error("TTL은 0 이상의 정수여야 합니다");

  const body = await encryptPayload(payload, sub);
  const jwt = await createVapidJwt(url.origin, vapid);
  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(ttl),
  };
  if (opts.urgency) headers.Urgency = opts.urgency;
  if (opts.topic) {
    // RFC 8030: base64url 문자 32자 이하
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) throw new Error("Topic은 base64url 문자 32자 이하여야 합니다");
    headers.Topic = opts.topic;
  }
  return { url: sub.endpoint, init: { method: "POST", headers, body } };
}

/** 새 VAPID 키쌍 (publicKey 65바이트 비압축 점, privateKey 32바이트 d — 모두 base64url) */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("개인키를 내보내지 못했습니다");
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d };
}
