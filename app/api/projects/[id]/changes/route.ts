import { NextResponse } from "next/server";
import { apiUser, assertProjectRole, assertWritable, audit, readJson, route } from "@/lib/access";
import { prisma, toNumber } from "@/lib/db";
import { validateChange, type ChangeInput } from "@/lib/changes";
import { formatDate } from "@/lib/format";
import { canSeeAllRows } from "@/lib/rules";

type Params = { id: string };

/** 변경계약 목록 — 메인 PM·재무 승인·시스템 관리자는 전체, 담당 PM(과 상위 조회)은 자기 과업 */
export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id);
  const seesAll = canSeeAllRows(user);
  const changes = await prisma.contractChange.findMany({
    where: { projectId: id, ...(seesAll ? {} : { managerId: user.id }) },
    include: { manager: { select: { id: true, name: true } }, items: { select: { itemId: true } } },
    orderBy: { seq: "asc" },
  });
  const [planned, spent] = await Promise.all([
    prisma.budgetLine.groupBy({ by: ["changeId"], where: { projectId: id, changeId: { not: null } }, _sum: { planned: true } }),
    prisma.expense.groupBy({ by: ["changeId"], where: { projectId: id, changeId: { not: null } }, _sum: { amount: true } }),
  ]);
  const p = new Map(planned.map((x) => [x.changeId, toNumber(x._sum.planned)]));
  const s = new Map(spent.map((x) => [x.changeId, toNumber(x._sum.amount)]));
  return NextResponse.json(changes.map((c) => ({
    ...c,
    signedAt: formatDate(c.signedAt), startDate: formatDate(c.startDate), endDate: formatDate(c.endDate),
    extendedFrom: c.extendedFrom ? formatDate(c.extendedFrom) : null,
    itemIds: c.items.map((i) => i.itemId), planned: p.get(c.id) ?? 0, spent: s.get(c.id) ?? 0,
  })));
});

/** 변경계약 등록 (재무 승인·시스템 관리자) */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const sessionUser = await apiUser(["HQ", "ADMIN"]);
  const { project, user } = await assertProjectRole(sessionUser, id);
  assertWritable(user, { allowAdmin: true });
  const body = await readJson<ChangeInput>(req);
  const data = await validateChange(project, body);

  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.contractChange.aggregate({ where: { projectId: id }, _max: { seq: true } });
    // 과업이 본계약 종료일을 넘으면 본계약 기간 연장 (기록은 extendedFrom에)
    const extend = data.endDate > project.endDate;
    if (extend) await tx.project.update({ where: { id }, data: { endDate: data.endDate } });
    // 담당 PM은 프로젝트 팀원이어야 한다 → 아니면 팀원으로 추가
    if (data.managerId) {
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: id, userId: data.managerId } },
        create: { projectId: id, userId: data.managerId, isPayer: true },
        update: { leftAt: null }, // 이전 팀원이면 과업 담당으로 복귀
      });
    }
    return tx.contractChange.create({
      data: { ...data, projectId: id, seq: (last._max.seq ?? 0) + 1, extendedFrom: extend ? project.endDate : null },
    });
  });
  await audit(sessionUser, { projectId: id, entity: "ContractChange", entityId: created.id, action: "create", data: body });
  return NextResponse.json(created, { status: 201 });
});
