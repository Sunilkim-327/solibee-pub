import { describe, expect, it } from "vitest";
import {
  b64urlDecode,
  b64urlEncode,
  buildPushRequest,
  concat,
  createVapidJwt,
  encryptPayload,
  generateVapidKeys,
  importEcdhKeyPair,
  type VapidKeys,
} from "@/lib/web-push";

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// RFC 8291 Section 5 / Appendix A 테스트 벡터 (원문 그대로, 공백만 제거)
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** 수신측(브라우저) 복호화 — 라이브러리와 별개로 RFC 8291/8188대로 직접 구현 */
async function decrypt(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const ecdh = { name: "ECDH", namedCurve: "P-256" };
  const asKey = await subtle.importKey("raw", asPublic, ecdh, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256));
  const hkdf = async (s: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) => {
    const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, k, n * 8));
  };
  const ikm = await hkdf(concat(auth), secret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(0x02); // 마지막 레코드 구분자
  return { rs, idlen, text: dec.decode(padded.subarray(0, end)) };
}

async function receiver() {
  const pair = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { pair, pub, auth, p256dh: b64urlEncode(pub), authB64: b64urlEncode(auth) };
}

function parseJwt(jwt: string) {
  const [h, p, s] = jwt.split(".");
  return {
    header: JSON.parse(dec.decode(b64urlDecode(h))),
    claims: JSON.parse(dec.decode(b64urlDecode(p))),
    signed: enc.encode(`${h}.${p}`),
    sig: b64urlDecode(s),
  };
}

async function verifyJwt(jwt: string, publicKey: string) {
  const { signed, sig } = parseJwt(jwt);
  const key = await subtle.importKey("raw", b64urlDecode(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, signed);
}

describe("base64url", () => {
  it("인코드/디코드 왕복, 패딩 없음", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe, 0x00, 0x01]);
    const s = b64urlEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(b64urlDecode(s))).toEqual(Array.from(bytes));
  });
});

describe("encryptPayload — RFC 8291 Appendix A 벡터", () => {
  it("벡터의 키·salt·평문을 주입하면 본문 바이트가 정확히 일치", async () => {
    const localKeyPair = await importEcdhKeyPair(V.asPublic, V.asPrivate);
    const body = await encryptPayload(V.plaintext, { p256dh: V.uaPublic, auth: V.auth }, {
      localKeyPair,
      salt: b64urlDecode(V.salt),
    });
    // 헤더 86 + 평문 41 + 구분자 1 + 태그 16 (RFC 예시의 "Content-Length: 145"는 오기 — 본문 base64는 144바이트)
    expect(body.length).toBe(144);
    expect(b64urlEncode(body.subarray(0, 86))).toBe(V.header);
    expect(b64urlEncode(body.subarray(86))).toBe(V.ciphertext);
    expect(b64urlEncode(body)).toBe(V.body);
  });

  it("벡터 본문을 수신측 개인키로 복호화하면 원문", async () => {
    const ua = await importEcdhKeyPair(V.uaPublic, V.uaPrivate);
    const out = await decrypt(b64urlDecode(V.body), ua.privateKey, b64urlDecode(V.uaPublic), b64urlDecode(V.auth));
    expect(out).toEqual({ rs: 4096, idlen: 65, text: V.plaintext });
  });

  it("너무 큰 페이로드는 거부", async () => {
    const r = await receiver();
    await expect(encryptPayload("가".repeat(2000), { p256dh: r.p256dh, auth: r.authB64 })).rejects.toThrow("너무 큽니다");
  });
});

describe("buildPushRequest", () => {
  const vapidFrom = async (): Promise<VapidKeys> => ({ ...(await generateVapidKeys()), subject: "mailto:admin@example.com" });

  it("헤더 구성 + 본문을 수신측이 복호화하면 원문 (왕복)", async () => {
    const r = await receiver();
    const vapid = await vapidFrom();
    const endpoint = "https://push.example.net/push/abc123";
    const payload = JSON.stringify({ title: "운영비 정산", body: "입력 기한이 다가왔습니다" });
    const { url, init } = await buildPushRequest({ endpoint, p256dh: r.p256dh, auth: r.authB64 }, payload, vapid, {
      urgency: "high",
      topic: "settle-2026-10",
    });
    expect(url).toBe(endpoint);
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h.TTL).toBe("86400");
    expect(h.Urgency).toBe("high");
    expect(h.Topic).toBe("settle-2026-10");
    expect(h.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));

    const out = await decrypt(init.body as Uint8Array, r.pair.privateKey, r.pub, r.auth);
    expect(out).toEqual({ rs: 4096, idlen: 65, text: payload });
  });

  it("TTL 지정, Urgency·Topic 없으면 헤더 생략", async () => {
    const r = await receiver();
    const { init } = await buildPushRequest(
      { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: r.p256dh, auth: r.authB64 },
      "hi",
      await vapidFrom(),
      { ttl: 60 },
    );
    const h = init.headers as Record<string, string>;
    expect(h.TTL).toBe("60");
    expect(h.Urgency).toBeUndefined();
    expect(h.Topic).toBeUndefined();
  });

  it("VAPID JWT: 헤더·클레임(aud=origin, exp=+12시간, sub) + 공개키로 서명 검증", async () => {
    const r = await receiver();
    const vapid = await vapidFrom();
    const before = Math.floor(Date.now() / 1000);
    const { init } = await buildPushRequest(
      { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz?q=1", p256dh: r.p256dh, auth: r.authB64 },
      "hi",
      vapid,
    );
    const after = Math.floor(Date.now() / 1000);
    const jwt = /t=([^,]+),/.exec((init.headers as Record<string, string>).Authorization)![1];
    const { header, claims, sig } = parseJwt(jwt);
    expect(header).toEqual({ typ: "JWT", alg: "ES256" });
    expect(claims.aud).toBe("https://updates.push.services.mozilla.com");
    expect(claims.sub).toBe("mailto:admin@example.com");
    expect(claims.exp).toBeGreaterThanOrEqual(before + 43200);
    expect(claims.exp).toBeLessThanOrEqual(after + 43200);
    expect(sig.length).toBe(64); // P1363 r||s
    expect(await verifyJwt(jwt, vapid.publicKey)).toBe(true);
    // 다른 키로는 검증 실패
    expect(await verifyJwt(jwt, (await generateVapidKeys()).publicKey)).toBe(false);
  });

  it("createVapidJwt는 now를 주입받아 exp를 결정적으로 계산", async () => {
    const vapid = await vapidFrom();
    const jwt = await createVapidJwt("https://push.example.net", vapid, 1_000_000);
    expect(parseJwt(jwt).claims).toEqual({ aud: "https://push.example.net", exp: 1_043_200, sub: vapid.subject });
  });

  it("잘못된 subject·endpoint·topic은 거부", async () => {
    const r = await receiver();
    const keys = await generateVapidKeys();
    const sub = { endpoint: "https://push.example.net/p", p256dh: r.p256dh, auth: r.authB64 };
    await expect(buildPushRequest(sub, "x", { ...keys, subject: "admin@example.com" })).rejects.toThrow("subject");
    await expect(buildPushRequest({ ...sub, endpoint: "http://push.example.net/p" }, "x", { ...keys, subject: "mailto:a@b.c" })).rejects.toThrow("https");
    await expect(buildPushRequest(sub, "x", { ...keys, subject: "mailto:a@b.c" }, { topic: "공백 포함" })).rejects.toThrow("Topic");
  });
});

describe("generateVapidKeys", () => {
  it("공개키 65바이트(0x04 비압축), 개인키 32바이트", async () => {
    const k = await generateVapidKeys();
    const pub = b64urlDecode(k.publicKey);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
    expect(b64urlDecode(k.privateKey).length).toBe(32);
  });

  it("생성한 키로 buildPushRequest 동작 + 서명 검증", async () => {
    const k = await generateVapidKeys();
    const r = await receiver();
    const { init } = await buildPushRequest(
      { endpoint: "https://push.example.net/p", p256dh: r.p256dh, auth: r.authB64 },
      "ok",
      { ...k, subject: "https://solibee.example.com" },
    );
    const jwt = /t=([^,]+),/.exec((init.headers as Record<string, string>).Authorization)![1];
    expect(await verifyJwt(jwt, k.publicKey)).toBe(true);
    expect((await decrypt(init.body as Uint8Array, r.pair.privateKey, r.pub, r.auth)).text).toBe("ok");
  });
});
