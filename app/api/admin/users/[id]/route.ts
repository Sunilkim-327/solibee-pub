import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route } from "@/lib/access";
import { tempPassword, tempPasswordExpiry } from "@/lib/auth-policy";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { USER_SELECT, validateUserInput, type UserInput } from "@/lib/users";

type Params = { id: string };

type Body = UserInput & { active?: boolean; resetPassword?: boolean; unlock?: boolean };

/** 사용자 수정 (시스템 관리자): 정보·역할·부서 / 활성화·비활성화 / 임시 비밀번호 발급 / 잠금 해제 */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const admin = await apiUser(["ADMIN"]);
  const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!before) throw new HttpError(404, "사용자를 찾을 수 없습니다.");
  const body = await readJson<Body>(req);

  if (id === admin.id && ((body.role && body.role !== "ADMIN") || body.active === false)) {
    throw new HttpError(400, "본인 계정의 권한 변경·비활성화는 할 수 없습니다. 다른 시스템 관리자에게 요청하세요.");
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined || body.loginId !== undefined || body.role !== undefined ||
      body.employeeNo !== undefined || body.position !== undefined || body.joinDate !== undefined || body.departmentId !== undefined) {
    Object.assign(data, await validateUserInput({ ...before, ...body }, id));
  }
  if (body.active !== undefined) Object.assign(data, { active: !!body.active, deactivatedAt: body.active ? null : new Date() });
  if (body.unlock) Object.assign(data, { lockedUntil: null, failedLogins: 0 });

  let issued: string | undefined;
  if (body.resetPassword) {
    issued = tempPassword();
    Object.assign(data, { passwordHash: hashPassword(issued), mustChangePassword: true, tempPasswordExpiresAt: tempPasswordExpiry(), lockedUntil: null, failedLogins: 0 });
  }

  const roleChanged = data.role !== undefined && data.role !== before.role;
  if (roleChanged) {
    // PM으로 지정된 프로젝트가 있으면 팀원으로 내릴 수 없다 (PM 지정을 먼저 해제)
    if (data.role === "MEMBER" && (await prisma.projectMember.count({ where: { userId: id, isPm: true } }))) {
      throw new HttpError(400, "PM으로 지정된 프로젝트가 있어 팀원으로 바꿀 수 없습니다. 먼저 PM 지정을 해제하세요.");
    }
    // 시스템 관리자가 직접 정한 역할 — PM 지정 해제 시 자동 회수 대상에서 뺀다
    data.pmAutoGranted = false;
  }

  // 임시 비밀번호 발급·역할 변경·비활성화 시 그 사용자의 기존 로그인 세션 모두 무효
  if (body.resetPassword || body.active === false || roleChanged) {
    data.sessionVersion = { increment: 1 };
  }

  const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
  await audit(admin, {
    entity: "User",
    entityId: id,
    action: body.resetPassword ? "password-reset" : body.active === false ? "deactivate" : body.unlock ? "unlock" : "update",
    data: { before, after: user },
  });
  return NextResponse.json({ user, tempPassword: issued });
});
