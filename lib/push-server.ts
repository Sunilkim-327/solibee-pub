// 웹 푸시 — 서버 전용 (구독 저장·삭제, 알림 발송). 암호화·VAPID는 lib/web-push.ts, 메시지 내용은 lib/notifications.ts pushPayload
// 키: VAPID_PUBLIC_KEY·VAPID_PRIVATE_KEY(운영은 wrangler secret, 로컬은 .env). 없으면 푸시 전체가 꺼진다 (켜기 스위치도 숨김)
// 새 키 만들기: node scripts/vapid-keys.mjs
import "server-only";
import { chunkIds } from "./chunk";
import { prisma } from "./db";
import { pushPayload } from "./notifications";
import { buildPushRequest, type VapidKeys } from "./web-push";

/** 연락처 (푸시 서비스가 문제 있을 때 연락하는 주소 — RFC 8292). VAPID_SUBJECT(mailto: 또는 https:)로 바꿀 수 있다 */
const DEFAULT_SUBJECT = "https://app.example.com";

/** 한 사람이 둘 수 있는 기기 수 — 넘으면 오래된 것부터 지운다 */
export const MAX_DEVICES_PER_USER = 10;

/** 기기에 머무는 시간 — 하루 안에 기기가 켜지지 않으면 버린다 (앱 내 알림 목록에는 남는다) */
const TTL_SECONDS = 24 * 60 * 60;

export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT };
}

/** 구독 저장 — 같은 기기(endpoint)를 다른 사람이 쓰던 것이면 지금 사용자로 옮긴다 (한 브라우저에서 계정을 바꾼 경우) */
export async function saveSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string; userAgent: string | null }) {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, ...sub },
    update: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent },
  });
  const extra = await prisma.pushSubscription.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES_PER_USER, select: { id: true },
  });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((r) => r.id) } } });
}

/** 구독 해제 (본인 것만) */
export async function removeSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

type SavedNotification = Parameters<typeof pushPayload>[0] & { userId: string };

/**
 * 저장한 알림을 받는 사람의 기기로 보낸다. 실패해도 본 작업을 깨뜨리지 않는다 (오류는 기록만).
 * 구독 조회는 지금 하고, 푸시 서비스로 보내는 일은 응답 뒤로 미룬다 (운영: waitUntil) — 상신·승인 응답이 느려지지 않게
 */
export async function pushNotifications(rows: SavedNotification[]): Promise<void> {
  try {
    const vapid = vapidKeys();
    if (!vapid || !rows.length) return;
    const subs = [];
    for (const chunk of chunkIds([...new Set(rows.map((r) => r.userId))])) {
      subs.push(...(await prisma.pushSubscription.findMany({ where: { userId: { in: chunk } }, select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true } })));
    }
    if (!subs.length) return;
    const byUser = new Map<string, typeof subs>();
    for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
    const jobs = rows.flatMap((n) => (byUser.get(n.userId) ?? []).map((s) => ({ s, payload: JSON.stringify(pushPayload(n)) })));
    runAfterResponse(deliver(jobs, vapid));
  } catch (err) {
    console.error("[push] 발송 준비 실패", err);
  }
}

async function deliver(jobs: { s: { id: string; endpoint: string; p256dh: string; auth: string }; payload: string }[], vapid: VapidKeys) {
  const gone: string[] = [];
  const sent: string[] = [];
  await Promise.all(jobs.map(async ({ s, payload }) => {
    try {
      const { url, init } = await buildPushRequest({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, vapid, { ttl: TTL_SECONDS, urgency: "normal" });
      const res = await fetch(url, init);
      // 404·410: 구독이 만료·해제됨 → 지운다. 그 밖의 실패는 기록만 (다음 알림 때 다시 시도)
      if (res.status === 404 || res.status === 410) gone.push(s.id);
      else if (res.ok) sent.push(s.id);
      else console.error("[push] 발송 실패", res.status, new URL(s.endpoint).host, (await res.text()).slice(0, 200));
    } catch (err) {
      console.error("[push] 발송 오류", new URL(s.endpoint).host, err);
    }
  }));
  try {
    for (const chunk of chunkIds(gone)) await prisma.pushSubscription.deleteMany({ where: { id: { in: chunk } } });
    const at = new Date();
    for (const chunk of chunkIds([...new Set(sent)])) await prisma.pushSubscription.updateMany({ where: { id: { in: chunk } }, data: { lastSentAt: at } });
  } catch (err) {
    console.error("[push] 구독 정리 실패", err);
  }
}

/** 응답을 보낸 뒤에도 이어서 실행 — 운영(Workers)은 waitUntil, 로컬(Node)은 그냥 진행 */
function runAfterResponse(p: Promise<unknown>) {
  const safe = p.catch((err) => console.error("[push]", err));
  if (process.env.DB_TARGET !== "d1") return;
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
  getCloudflareContext().ctx.waitUntil(safe);
}
