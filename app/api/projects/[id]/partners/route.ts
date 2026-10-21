import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { canManageProjectSettings } from "@/lib/rules";
import { cleanPartners, partnerLabel, referencedPartners } from "@/lib/partners";

type Params = { id: string };

/** 협력 인력 명단 */
export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  await assertProjectRole(await apiUser(), id);
  const rows = await prisma.projectPartner.findMany({ where: { projectId: id }, orderBy: { order: "asc" }, select: { id: true, name: true, company: true, active: true } });
  return NextResponse.json(rows);
});

/**
 * 협력 인력 명단 저장 (이 프로젝트 PM): { partners: [{ id?, name, company, active }] }
 * 빠진 사람: 이 프로젝트 지출의 참석자에 기록이 있으면 삭제하지 않고 active=false로 남기고(기록이 참조하면 비활성), 기록이 없을 때만 삭제.
 * 응답 kept: 삭제 대신 남긴 사람의 표기 목록
 */
export const PUT = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id);
  if (!canManageProjectSettings(user.role)) throw new HttpError(403, "협력 인력은 PM이 관리합니다.");
  assertWritable(user);
  const body = await readJson<{ partners?: unknown }>(req);
  const r = cleanPartners(body.partners);
  if ("error" in r) throw new HttpError(400, r.error);
  const before = await prisma.projectPartner.findMany({ where: { projectId: id }, select: { id: true, name: true, company: true } });
  const known = new Set(before.map((p) => p.id));
  const keep = new Set(r.list.map((p) => p.id).filter((x): x is string => !!x && known.has(x)));
  const dropped = before.filter((p) => !keep.has(p.id));
  // 참석자는 이름 문자열(쉼표 구분)이라 FK가 없다 — 이름이 들어간 지출만 읽어 표기 일치로 판단
  const rows = dropped.length
    ? await prisma.expense.findMany({ where: { projectId: id, OR: dropped.map((p) => ({ attendees: { contains: p.name } })) }, select: { attendees: true } })
    : [];
  const kept = referencedPartners(dropped, rows.map((e) => e.attendees));
  const keptIds = new Set(kept.map((p) => p.id));
  await prisma.$transaction([
    prisma.projectPartner.deleteMany({ where: { projectId: id, id: { notIn: [...keep, ...keptIds] } } }),
    ...kept.map((p, i) => prisma.projectPartner.update({ where: { id: p.id }, data: { active: false, order: r.list.length + i } })),
    ...r.list.map((p, order) =>
      p.id && keep.has(p.id)
        ? prisma.projectPartner.update({ where: { id: p.id }, data: { name: p.name, company: p.company, active: p.active, order } })
        : prisma.projectPartner.create({ data: { projectId: id, name: p.name, company: p.company, active: p.active, order } }),
    ),
  ]);
  const keptLabels = kept.map(partnerLabel);
  await audit(user, { projectId: id, entity: "ProjectPartner", entityId: id, action: "replace", data: { partners: r.list.map(({ name, company, active }) => ({ name, company, active })), kept: keptLabels } });
  return NextResponse.json({ ok: true, kept: keptLabels });
});
