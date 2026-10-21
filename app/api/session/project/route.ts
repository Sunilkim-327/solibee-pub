import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectAccess, readJson, route } from "@/lib/access";
import { PROJECT_COOKIE, projectCookieOptions } from "@/lib/session";

/** 현재 작업 프로젝트 선택 */
export const POST = route(async (req) => {
  const user = await apiUser();
  const { projectId } = await readJson<{ projectId?: unknown }>(req);
  if (typeof projectId !== "string" || !projectId || projectId.length > 64) throw new HttpError(400, "프로젝트를 선택하세요.");
  await assertProjectAccess(user, projectId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PROJECT_COOKIE, projectId, projectCookieOptions());
  return res;
});
