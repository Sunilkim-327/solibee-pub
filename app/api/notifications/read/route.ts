import { NextResponse } from "next/server";
import { HttpError, SMALL_JSON_MAX_BYTES, apiUser, readJson, route } from "@/lib/access";
import { markRead, unreadCount } from "@/lib/notification-server";
import { strArray } from "@/lib/validate";

/** 읽음 처리: { ids?: string[]; all?: boolean } → { unread } — 본인 알림만 */
export const POST = route(async (req) => {
  const user = await apiUser();
  const body = await readJson<{ ids?: unknown; all?: unknown }>(req, SMALL_JSON_MAX_BYTES);
  const ids = strArray(body.ids, "알림", 200);
  if (body.all !== true && !ids.length) throw new HttpError(400, "읽음 처리할 알림을 지정하세요.");
  await markRead(user.id, body.all === true ? "all" : ids);
  return NextResponse.json({ unread: await unreadCount(user.id) });
});
