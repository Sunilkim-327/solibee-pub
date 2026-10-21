import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { vendorNameProblem } from "@/lib/pass-statement";

type Params = { id: string; vendorId: string };

async function findVendor(projectId: string, vendorId: string) {
  const v = await prisma.passImportProfile.findUnique({ where: { id: vendorId }, select: { id: true, projectId: true, vendorName: true } });
  if (!v || v.projectId !== projectId) throw new HttpError(404, "업체 서식을 찾을 수 없습니다.");
  return v;
}

/** 업체 서식 이름 바꾸기 (이 프로젝트 PM): { vendorName } — 이 업체로 올린 출입증 내역 줄의 업체 이름도 함께 바꾼다 (다시 올리기 교체 범위가 이어지게) */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id, vendorId } = await params;
  const { user } = await projectWriter(id, ["MANAGER"]);
  const v = await findVendor(id, vendorId);
  const { vendorName } = await readJson<{ vendorName?: unknown }>(req);
  const name = typeof vendorName === "string" ? vendorName.trim() : "";
  if (name === v.vendorName) return NextResponse.json({ ok: true });
  const others = (await prisma.passImportProfile.findMany({ where: { projectId: id, NOT: { id: vendorId } }, select: { vendorName: true } })).map((x) => x.vendorName);
  const problem = vendorNameProblem(name, others);
  if (problem) throw new HttpError(problem.startsWith("이미") ? 409 : 400, problem);
  await prisma.$transaction([
    prisma.passImportProfile.update({ where: { id: vendorId }, data: { vendorName: name } }),
    prisma.passStatementLine.updateMany({ where: { vendor: v.vendorName, statement: { projectId: id } }, data: { vendor: name } }),
  ]);
  await audit(user, { projectId: id, entity: "PassImportProfile", entityId: vendorId, action: "rename", data: { from: v.vendorName, to: name } });
  return NextResponse.json({ ok: true });
});

/** 업체 서식 삭제 (이 프로젝트 PM) — 서식만 지운다. 이미 올린 출입증 내역 줄은 그대로 (업체 이름도 유지) */
export const DELETE = route<Params>(async (_req, { params }) => {
  const { id, vendorId } = await params;
  const { user } = await projectWriter(id, ["MANAGER"]);
  const v = await findVendor(id, vendorId);
  await prisma.passImportProfile.delete({ where: { id: vendorId } });
  await audit(user, { projectId: id, entity: "PassImportProfile", entityId: vendorId, action: "delete", data: { vendor: v.vendorName } });
  return NextResponse.json({ ok: true });
});
