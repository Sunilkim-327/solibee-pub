import { NextResponse } from "next/server";
import { HttpError, apiUser, auditMany, readJson, route } from "@/lib/access";
import { tempPassword, tempPasswordExpiry } from "@/lib/auth-policy";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { BULK_RESET_MAX } from "@/lib/user-admin";

/**
 * 임시 비밀번호 일괄 발급 (시스템 관리자) — 조직도 연동으로 만들어진 계정에 한꺼번에 발급할 때.
 * 활성 계정만 대상. 임시 비밀번호는 응답으로 한 번만 보여준다.
 */
export const POST = route(async (req) => {
  const admin = await apiUser(["ADMIN"]);
  const { userIds } = await readJson<{ userIds?: unknown }>(req);
  if (!Array.isArray(userIds) || !userIds.every((x) => typeof x === "string")) throw new HttpError(400, "사용자 목록이 필요합니다.");
  const ids = [...new Set(userIds as string[])];
  if (ids.length === 0) throw new HttpError(400, "발급할 사용자를 선택하세요.");
  if (ids.length > BULK_RESET_MAX) throw new HttpError(400, `한 번에 최대 ${BULK_RESET_MAX}명까지 발급할 수 있습니다.`);

  const targets = await prisma.user.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, name: true, loginId: true },
    orderBy: { name: "asc" },
  });
  if (targets.length === 0) throw new HttpError(400, "발급할 수 있는 활성 사용자가 없습니다.");

  const issued = targets.map((u) => ({ ...u, tempPassword: tempPassword(), expiresAt: tempPasswordExpiry() }));
  await prisma.$transaction(
    issued.map((u) =>
      prisma.user.update({
        where: { id: u.id },
        data: {
          passwordHash: hashPassword(u.tempPassword),
          mustChangePassword: true,
          tempPasswordExpiresAt: u.expiresAt,
          lockedUntil: null,
          failedLogins: 0,
          sessionVersion: { increment: 1 }, // 기존 로그인 세션 무효화
        },
      }),
    ),
  );
  await auditMany(admin, issued.map((u) => ({ entity: "User", entityId: u.id, action: "password-reset", data: { bulk: true } })));
  return NextResponse.json(
    issued.map((u) => ({ id: u.id, name: u.name, loginId: u.loginId ?? "", tempPassword: u.tempPassword, expiresAt: u.expiresAt.toISOString() })),
  );
});
