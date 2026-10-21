import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, readJson, route } from "@/lib/access";
import { prisma, type Tx } from "@/lib/db";
import { validateChange, type ChangeInput } from "@/lib/changes";
import { originalEndDate, restoredEndDate } from "@/lib/change-extension";

type Params = { id: string };

async function load(id: string, roles?: ("HQ" | "ADMIN" | "MANAGER")[]) {
  const change = await prisma.contractChange.findUnique({ where: { id } });
  if (!change) throw new HttpError(404, "변경계약을 찾을 수 없습니다.");
  const { project, user } = await projectWriter(change.projectId, roles, { allowAdmin: true });
  return { change, project, user };
}

/** 본계약 기간을 연장한 적이 있는 과업만 되돌림 대상 (중간까지만 되돌린 뒤 지출이 없어져 다시 줄이는 경우도 잡는다) */
const setsProjectEnd = (change: { extendedFrom: Date | null }) => !!change.extendedFrom;

/**
 * 과업 삭제·종료일 단축으로 연장 사유가 없어지면 본계약 종료일을 되돌린다 (트랜잭션 안에서).
 * 이미 입력된 지출·출입증 사용·마감 월은 기간 안에 남긴다. 바뀐 종료일(없으면 null)을 돌려준다.
 */
async function restoreProjectEnd(tx: Tx, project: { id: string; endDate: Date }, after: (all: { id: string; endDate: Date }[]) => { endDate: Date }[]) {
  const before = await tx.contractChange.findMany({ where: { projectId: project.id }, select: { id: true, endDate: true, extendedFrom: true } });
  if (!before.some((c) => c.extendedFrom)) return null;
  const lastExpense = await tx.expense.findFirst({ where: { projectId: project.id }, orderBy: { date: "desc" }, select: { date: true } });
  const lastPass = await tx.clientPassUsage.findFirst({ where: { projectId: project.id }, orderBy: { date: "desc" }, select: { date: true } });
  const lastClosing = await tx.monthlyClosing.findFirst({ where: { projectId: project.id, status: { not: "DRAFT" } }, orderBy: { yearMonth: "desc" }, select: { yearMonth: true } });
  const closingMonth = lastClosing ? new Date(`${lastClosing.yearMonth}-01T00:00:00Z`) : null;
  const next = restoredEndDate(project.endDate, before, after(before), [lastExpense?.date ?? null, lastPass?.date ?? null, closingMonth]);
  if (!next) return null;
  await tx.project.update({ where: { id: project.id }, data: { endDate: next } });
  // 원 종료일까지 완전히 되돌렸을 때만 연장 기록 해제. 지출·마감 때문에 중간까지만 돌아갔으면 extendedFrom을 남겨
  // 원 종료일(originalEndDate)을 잃지 않는다 — 나중에 다시 줄이면 그때 원 종료일로 돌아간다
  if (next.getTime() === originalEndDate(project.endDate, before).getTime()) {
    await tx.contractChange.updateMany({ where: { projectId: project.id, extendedFrom: { not: null }, endDate: { lte: next } }, data: { extendedFrom: null } });
  }
  return next;
}

/** 변경계약 수정 (재무 승인·시스템 관리자) */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { change, project, user } = await load(id, ["HQ", "ADMIN"]);
  const body = await readJson<ChangeInput>(req);
  const data = await validateChange(project, body, change);
  const { updated, restoredEnd } = await prisma.$transaction(async (tx) => {
    const extend = data.endDate > project.endDate;
    if (extend) await tx.project.update({ where: { id: project.id }, data: { endDate: data.endDate } });
    if (data.managerId) {
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: data.managerId } },
        create: { projectId: project.id, userId: data.managerId, isPayer: true },
        update: { leftAt: null }, // 이전 팀원이면 과업 담당으로 복귀
      });
    }
    const updated = await tx.contractChange.update({ where: { id }, data: { ...data, ...(extend ? { extendedFrom: change.extendedFrom ?? project.endDate } : {}) } });
    // 연장했던 과업의 종료일을 줄이면 본계약 종료일도 되돌림
    const restoredEnd = !extend && data.endDate < change.endDate && setsProjectEnd(change) ? await restoreProjectEnd(tx, project, (all) => all) : null;
    return { updated: restoredEnd ? await tx.contractChange.findUniqueOrThrow({ where: { id } }) : updated, restoredEnd };
  });
  await audit(user, { projectId: project.id, entity: "ContractChange", entityId: id, action: "update", data: { before: change, after: updated } });
  if (restoredEnd) await audit(user, { projectId: project.id, entity: "Project", entityId: project.id, action: "restore-end", data: { change: id, from: project.endDate, to: restoredEnd } });
  return NextResponse.json(updated);
});

/** 변경계약 삭제 (재무 승인·시스템 관리자) — 이 과업으로 입력된 지출이 있으면 거부. 이 과업으로 연장된 본계약 종료일은 되돌림 */
export const DELETE = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const { change, project, user } = await load(id, ["HQ", "ADMIN"]);
  const used = await prisma.expense.count({ where: { changeId: id } });
  if (used) throw new HttpError(400, `이 과업으로 입력된 지출 ${used}건이 있어 삭제할 수 없습니다.`);
  const lines = await prisma.budgetLine.count({ where: { changeId: id } });
  if (lines) throw new HttpError(400, `이 과업의 증액분 예산 ${lines}행이 있습니다. 프로젝트 운영비에서 먼저 정리하세요.`);
  const restoredEnd = await prisma.$transaction(async (tx) => {
    // 삭제 전 과업 목록으로 원래 종료일을 구한 뒤 삭제
    const next = setsProjectEnd(change) ? await restoreProjectEnd(tx, project, (all) => all.filter((c) => c.id !== id)) : null;
    await tx.contractChange.delete({ where: { id } });
    return next;
  });
  await audit(user, { projectId: project.id, entity: "ContractChange", entityId: id, action: "delete", data: change });
  if (restoredEnd) await audit(user, { projectId: project.id, entity: "Project", entityId: project.id, action: "restore-end", data: { change: id, from: project.endDate, to: restoredEnd } });
  return NextResponse.json({ ok: true, restoredEnd });
});
