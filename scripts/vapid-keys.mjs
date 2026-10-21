// 웹 푸시 VAPID 키쌍 생성 — `node scripts/vapid-keys.mjs`
// Web Crypto만 사용 (외부 패키지 없음, lib/web-push.ts의 generateVapidKeys와 같은 형식).
//   VAPID_PUBLIC_KEY  = 65바이트 비압축 P-256 점 (base64url) — 브라우저 구독(applicationServerKey)에도 쓴다
//   VAPID_PRIVATE_KEY = 32바이트 개인키 d (base64url) — 절대 커밋·공유하지 말 것
//
// 등록 방법
//   운영(Cloudflare Workers): npx wrangler secret put VAPID_PRIVATE_KEY  (붙여 넣기)
//                            npx wrangler secret put VAPID_PUBLIC_KEY
//   로컬: .env 에 아래 출력 두 줄을 그대로 추가
// 키를 바꾸면 기존 브라우저 구독은 모두 무효가 되므로 다시 구독해야 한다.

const subtle = globalThis.crypto.subtle;
const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64url(new Uint8Array(await subtle.exportKey("raw", pair.publicKey)));
const { d } = await subtle.exportKey("jwk", pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
