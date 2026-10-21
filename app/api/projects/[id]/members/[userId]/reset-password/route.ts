import { NextResponse } from "next/server";
import { HttpError, audit, clientIp, projectWriter, route } from "@/lib/access";
import { tempPassword, tempPasswordExpiry } from "@/lib/auth-policy";
import { PM_RESET_LIMITS } from "@/lib/auth-throttle";
import { checkThrottle } from "@/lib/auth-throttle-server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { pmResetProblem } from "@/lib/pm-reset";
import type { Role } from "@/lib/types";

type Params = { id: string; userId: string };

/**
 * PM이 내 프로젝트의 현재 팀원에게 임시 비밀번호를 발급 (시스템 관리자 발급과 같은 효과: 기존 비밀번호·로그인 세션 무효, 24시간 안에 바꿔야 함).
 * 본인·다른 PM·재무 승인·시스템 관리자·이전 팀원·비활성 계정은 시스템 관리자에게 (lib/pm-reset.ts).
 */
export const POST = route<Params>(async (_req, { params }) => {
  const { id, userId } = await params;
  const { user: pm } = await projectWriter(id, ["MANAGER"]);
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, loginId: true, role: true, active: true, memberships: { where: { OR: [{ projectId: id }, { leftAt: null }] }, select: { projectId: true, isPm: true, leftAt: true } } },
  });
  // 대상이 함께 속한 다른 프로젝트 — 모두 이 PM이 PM인 곳이어야 한다 (아무나 팀원으로 넣고 발급해 다른 프로젝트에서 행세하지 못하게)
  const mine = new Set((await prisma.projectMember.findMany({ where: { userId: pm.id, isPm: true, leftAt: null }, select: { projectId: true } })).map((m) => m.projectId));
  const others = (target?.memberships ?? []).filter((m) => m.projectId !== id && !m.leftAt);
  const problem = pmResetProblem(pm.id, target && { ...target, role: target.role as Role, member: target.memberships.find((m) => m.projectId === id) ?? null, pmElsewhere: others.some((m) => m.isPm), outsideMine: others.some((m) => !mine.has(m.projectId)) });
  if (problem) throw new HttpError(target ? 400 : 404, problem);
  // PM당 15분 10회 — 반복 발급으로 팀원 로그인을 계속 끊는 일 방지 (발급 자체가 시도이므로 성공해도 지우지 않는다)
  if (await checkThrottle("pm-reset", await clientIp(), pm.id, PM_RESET_LIMITS)) {
    throw new HttpError(429, "임시 비밀번호 발급이 너무 잦습니다. 15분 후 다시 시도하세요.");
  }

  const issued = tempPassword();
  const expiresAt = tempPasswordExpiry();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(issued), mustChangePassword: true, tempPasswordExpiresAt: expiresAt, lockedUntil: null, failedLogins: 0, sessionVersion: { increment: 1 } },
  });
  await audit(pm, { projectId: id, entity: "User", entityId: userId, action: "password-reset", data: { by: "pm", projectId: id, name: target!.name } });
  return NextResponse.json({ name: target!.name, loginId: target!.loginId ?? "", tempPassword: issued, expiresAt: expiresAt.toISOString() });
});
