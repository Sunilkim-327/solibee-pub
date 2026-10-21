import { NextResponse } from "next/server";
import { HttpError, SMALL_JSON_MAX_BYTES, apiUser, readJson, route } from "@/lib/access";
import { isPushEndpoint } from "@/lib/notifications";
import { removeSubscription, saveSubscription, vapidKeys } from "@/lib/push-server";
import { str } from "@/lib/validate";

/** 푸시 켜기에 쓰는 공개키 → { publicKey } (서버에 키가 없으면 null — 화면이 스위치를 숨긴다) */
export const GET = route(async () => {
  await apiUser();
  return NextResponse.json({ publicKey: vapidKeys()?.publicKey ?? null });
});

const endpointOf = (v: unknown) => {
  const endpoint = str(v, "푸시 주소", 1000, { required: true });
  if (!isPushEndpoint(endpoint)) throw new HttpError(400, "지원하지 않는 푸시 주소입니다.");
  return endpoint;
};

const b64url = (v: unknown, max: number) => {
  const s = str(v, "푸시 키", max, { required: true });
  if (!/^[A-Za-z0-9_-]+=*$/.test(s)) throw new HttpError(400, "푸시 키 형식이 올바르지 않습니다.");
  return s;
};

/** 이 기기 푸시 켜기: PushSubscription.toJSON() 그대로 { endpoint, keys: { p256dh, auth } } */
export const POST = route(async (req) => {
  const user = await apiUser();
  if (!vapidKeys()) throw new HttpError(503, "푸시 알림이 아직 설정되지 않았습니다.");
  const body = await readJson<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(req, SMALL_JSON_MAX_BYTES);
  const keys = body.keys && typeof body.keys === "object" ? body.keys : {};
  await saveSubscription(user.id, {
    endpoint: endpointOf(body.endpoint),
    p256dh: b64url(keys.p256dh, 200),
    auth: b64url(keys.auth, 100),
    userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
  });
  return NextResponse.json({ ok: true });
});

/** 이 기기 푸시 끄기: { endpoint } — 본인 것만 */
export const DELETE = route(async (req) => {
  const user = await apiUser();
  const body = await readJson<{ endpoint?: unknown }>(req, SMALL_JSON_MAX_BYTES);
  await removeSubscription(user.id, endpointOf(body.endpoint));
  return NextResponse.json({ ok: true });
});
