// 앱 내 알림 — 서버 전용 (저장·목록·읽음 처리·받는 사람 조회). 알림 내용은 lib/notifications.ts(순수함수)
import "server-only";
import { chunkIds } from "./chunk";
import { d1Batch, insertStatements, newCuid, prisma } from "./db";
import { seoulTodayDate } from "./format";
import { isCurrentMember } from "./membership";
import { pushNotifications } from "./push-server";
import type { NotificationDraft } from "./notifications";
import { sqlProjectMembers } from "./sql-loaders";

/** 목록 기본 개수 */
export const NOTIFICATION_LIST_LIMIT = 50;

/** (userId, key) 짝 조회는 짝마다 바인딩 2개 — D1 한도(100) 안에서 */
const KEY_CHUNK = 45;

const pairKey = (userId: string, key: string) => `${userId}\u0000${key}`;

/**
 * 알림 저장. key가 있는 것은 같은 사용자에게 같은 key가 이미 있으면 건너뛴다 (SQLite createMany는 skipDuplicates 미지원 → 먼저 조회).
 * 실패해도 본 작업(상신·승인·확정)을 깨뜨리지 않는다 — 오류는 기록만 하고 삼킨다.
 * @returns 만든 건수·건너뛴 건수
 */
export async function notify(drafts: NotificationDraft[]): Promise<{ created: number; skipped: number }> {
  try {
    const list = drafts.filter((d) => d.userId && d.title);
    if (!list.length) return { created: 0, skipped: 0 };
    const exists = new Set<string>();
    for (const chunk of chunkIds(list.filter((d) => d.key), KEY_CHUNK)) {
      const rows = await prisma.notification.findMany({
        where: { OR: chunk.map((d) => ({ userId: d.userId, key: d.key! })) },
        select: { userId: true, key: true },
      });
      for (const r of rows) if (r.key) exists.add(pairKey(r.userId, r.key));
    }
    // 같은 요청 안의 중복(같은 사람·같은 key)도 하나만
    const fresh = list.filter((d) => {
      if (!d.key) return true;
      const k = pairKey(d.userId, d.key);
      if (exists.has(k)) return false;
      exists.add(k);
      return true;
    });
    if (!fresh.length) return { created: 0, skipped: list.length };
    const at = new Date();
    const rows = fresh.map((d) => ({
      id: newCuid(), userId: d.userId, kind: d.kind, title: d.title, body: d.body ?? null, href: d.href ?? null,
      projectId: d.projectId ?? null, yearMonth: d.yearMonth ?? null, key: d.key ?? null, createdAt: at, readAt: null,
    }));
    // 운영(D1): 여러 행씩 한 번에 / 로컬: Prisma
    if (!(await d1Batch(insertStatements("Notification", rows)))) await prisma.notification.createMany({ data: rows });
    // 같은 내용을 받는 사람의 기기로도 (푸시 켠 사람만, 실패해도 무시)
    await pushNotifications(rows);
    return { created: rows.length, skipped: list.length - rows.length };
  } catch (err) {
    console.error("[notify] 알림 저장 실패", err);
    return { created: 0, skipped: drafts.length };
  }
}

/** 안 읽은 알림 수 */
export function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

const LIST_SELECT = { id: true, kind: true, title: true, body: true, href: true, projectId: true, yearMonth: true, createdAt: true, readAt: true } as const;

/** 최근 알림 — 안 읽은 것 먼저, 그다음 읽은 것. 둘 다 최신순 (readAt으로 정렬하면 "먼저 읽은 순"이 되므로 두 번 조회) */
export async function listNotifications(userId: string, { limit = NOTIFICATION_LIST_LIMIT }: { limit?: number } = {}) {
  const unread = await prisma.notification.findMany({ where: { userId, readAt: null }, orderBy: { createdAt: "desc" }, take: limit, select: LIST_SELECT });
  if (unread.length >= limit) return unread;
  const read = await prisma.notification.findMany({ where: { userId, readAt: { not: null } }, orderBy: { createdAt: "desc" }, take: limit - unread.length, select: LIST_SELECT });
  return [...unread, ...read];
}

/** 읽음 처리 (본인 것만). ids 또는 "all" → 바뀐 건수 */
export async function markRead(userId: string, ids: string[] | "all"): Promise<number> {
  const readAt = new Date();
  if (ids === "all") return (await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt } })).count;
  let n = 0;
  for (const chunk of chunkIds(ids)) n += (await prisma.notification.updateMany({ where: { userId, id: { in: chunk }, readAt: null }, data: { readAt } })).count;
  return n;
}

/** 프로젝트들의 현재 PM (활성 사용자, 철수 전) — 메인 + 함께 상신하는 서브를 한 번에 */
export async function projectPmIds(projectIds: string[]): Promise<string[]> {
  if (!projectIds.length) return [];
  const today = seoulTodayDate();
  const rows = await sqlProjectMembers(projectIds);
  return [...new Set(rows.filter((m) => m.isPm && m.user.active && isCurrentMember(m, today)).map((m) => m.userId))];
}

/** 재무 승인 담당 전원 (활성) */
export async function hqUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: "HQ", active: true }, select: { id: true } });
  return rows.map((r) => r.id);
}
