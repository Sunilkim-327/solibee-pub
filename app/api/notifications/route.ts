import { NextResponse } from "next/server";
import { apiUser, route } from "@/lib/access";
import { listNotifications, unreadCount } from "@/lib/notification-server";

/** 내 알림 목록 (최근 50, 안 읽은 것 먼저·최신순) + 안 읽은 건수 → { items, unread } — 로그인한 누구나 */
export const GET = route(async () => {
  const user = await apiUser();
  const [items, unread] = await Promise.all([listNotifications(user.id), unreadCount(user.id)]);
  return NextResponse.json({ items, unread });
});
