import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { APPROVAL_REF_MAX } from "@/lib/snapshot";
import { str } from "@/lib/validate";

type Params = { id: string };

/** 결재 문서번호(BrityWorks) 수정 — 재무 승인, 승인된 달만: { approvalRef } (빈 값이면 지움) */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(["HQ"]);
  const closing = await prisma.monthlyClosing.findUnique({ where: { id }, select: { projectId: true, status: true, approvalRef: true } });
  if (!closing) throw new HttpError(404, "마감 내역을 찾을 수 없습니다.");
  assertWritable((await assertProjectRole(user, closing.projectId)).user);
  if (closing.status !== "APPROVED") throw new HttpError(409, "결재 문서번호는 승인된 달에만 적을 수 있습니다.");
  const body = await readJson<{ approvalRef?: unknown }>(req);
  const approvalRef = str(body.approvalRef, "결재 문서번호", APPROVAL_REF_MAX) ?? null;
  const updated = await prisma.monthlyClosing.update({ where: { id }, data: { approvalRef }, select: { id: true, approvalRef: true } });
  await audit(user, { projectId: closing.projectId, entity: "MonthlyClosing", entityId: id, action: "approval-ref", data: { before: closing.approvalRef, after: approvalRef } });
  return NextResponse.json(updated);
});
