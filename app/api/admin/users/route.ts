import { NextResponse } from "next/server";
import { sortPeople } from "@/lib/org";
import { apiUser, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { USER_SELECT, createUser, type UserInput } from "@/lib/users";

export const GET = route(async () => {
  await apiUser(["ADMIN"]);
  const users = sortPeople(await prisma.user.findMany({ select: USER_SELECT }), (u) => u);
  return NextResponse.json(users);
});

/** 사용자 생성 (시스템 관리자) — 임시 비밀번호 발급 */
export const POST = route(async (req) => {
  const admin = await apiUser(["ADMIN"]);
  const { user, tempPassword } = await createUser(await readJson<UserInput>(req));
  await audit(admin, { entity: "User", entityId: user.id, action: "create", data: { ...user, tempPassword: undefined } });
  return NextResponse.json({ user, tempPassword }, { status: 201 });
});
