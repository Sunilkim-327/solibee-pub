import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectAccess, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDate, parseDateOnly } from "@/lib/format";
import { copyItems } from "@/lib/items";
import { nextRoundName, nextRoundPeriod, seriesBaseName } from "@/lib/lifecycle";
import { parseBundle } from "@/lib/budget-bundle";
import { NAME_MAX, str, strArray } from "@/lib/validate";

type Params = { id: string };

/** 다음 연차 기본값 (화면 미리 채우기) */
export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const user = await apiUser(["HQ", "ADMIN"]);
  const p = await assertProjectAccess(user, id);
  const period = nextRoundPeriod(p.startDate, p.endDate);
  const changes = await prisma.contractChange.findMany({ where: { projectId: id }, orderBy: { seq: "asc" }, select: { id: true, seq: true, title: true, endDate: true } });
  return NextResponse.json({
    name: nextRoundName(p.name, p.round),
    startDate: formatDate(period.startDate),
    endDate: formatDate(period.endDate),
    // 본계약 종료 후에도 이어지는 과업 = 이월 후보
    changes: changes.map((c) => ({ id: c.id, label: `변경 ${c.seq}차 · ${c.title}`, endDate: formatDate(c.endDate), carryOver: c.endDate > p.endDate })),
  });
});

type Body = { name?: unknown; startDate?: string; endDate?: string; copyBudget?: boolean; carryChangeIds?: unknown };

/**
 * 다음 연차 만들기 (재무 승인·시스템 관리자) — 연차별 계약을 새 프로젝트로.
 * 항목·한도, 팀원 입력 항목, 팀원·PM, 출입증 설정을 복사하고, 선택하면 예산과 이월 과업도 이어받는다.
 * 별도 계약 서브 프로젝트는 연속 사업으로 묶여 기간이 겹치는 연차에 자동으로 취합된다.
 */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(["HQ", "ADMIN"]);
  const src = await assertProjectAccess(user, id);
  const body = await readJson<Body>(req);
  const name = str(body.name, "프로젝트명", NAME_MAX) || nextRoundName(src.name, src.round);
  const carryChangeIds = strArray(body.carryChangeIds, "이월 과업", 200);
  const def = nextRoundPeriod(src.startDate, src.endDate);
  const startDate = body.startDate ? parseDateOnly(body.startDate) : def.startDate;
  const endDate = body.endDate ? parseDateOnly(body.endDate) : def.endDate;
  if (!startDate || !endDate || endDate < startDate) throw new HttpError(400, "기간을 올바르게 입력하세요.");
  if (startDate <= src.endDate) throw new HttpError(400, "다음 연차는 이전 연차 종료일 이후에 시작해야 합니다.");
  const round = (src.round ?? 1) + 1;
  if (src.seriesId && (await prisma.project.findFirst({ where: { seriesId: src.seriesId, round } }))) {
    throw new HttpError(409, `이미 ${round}차 프로젝트가 있습니다.`);
  }
  const carry = await prisma.contractChange.findMany({
    where: { projectId: id, id: { in: carryChangeIds } },
    include: { items: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    // 동시에 만든 경우 대비: 트랜잭션 안에서 다시 확인
    const fresh = await tx.project.findUniqueOrThrow({ where: { id }, select: { seriesId: true, round: true } });
    if ((fresh.round ?? 1) + 1 !== round) throw new HttpError(409, "이전 연차 정보가 바뀌었습니다. 새로고침 후 다시 시도하세요.");
    if (fresh.seriesId && (await tx.project.findFirst({ where: { seriesId: fresh.seriesId, round }, select: { id: true } }))) {
      throw new HttpError(409, `이미 ${round}차 프로젝트가 있습니다.`);
    }
    // 연속 사업 묶음 (처음이면 만들고 이전 연차를 1차로)
    let seriesId = fresh.seriesId;
    if (!seriesId) {
      seriesId = (await tx.projectSeries.create({ data: { name: seriesBaseName(src.name) } })).id;
      await tx.project.update({ where: { id }, data: { seriesId, round: src.round ?? 1 } });
    }
    // 다음 연차에는 현재 팀원만 이어간다 (이전 팀원 제외)
    const members = await tx.projectMember.findMany({ where: { projectId: id, leftAt: null } });
    const p = await tx.project.create({
      data: {
        name, startDate, endDate, fiscalStart: startDate.getUTCMonth() + 1,
        departmentId: src.departmentId, parentId: src.parentId, seriesId, round,
        clientPassEnabled: src.clientPassEnabled, clientPassName: src.clientPassName,
        // 상신 엑셀 구분명(운영_)·함께 상신 설정도 이어간다 — 서브는 같은 연속 사업이면 그 달이 든 연차와 함께 상신된다
        excelPrefix: src.excelPrefix, settleWithParent: src.settleWithParent,
        members: { create: members.map((m) => ({ userId: m.userId, isPm: m.isPm, isPayer: m.isPayer })) },
      },
    });
    const itemMap = await copyItems(tx, p.id, id);
    const mapItem = (itemId: string) => itemMap.get(itemId) ?? itemId;
    const memberItems = await tx.memberItem.findMany({ where: { projectId: id } });
    if (memberItems.length) await tx.memberItem.createMany({ data: memberItems.map((m) => ({ projectId: p.id, itemId: mapItem(m.itemId) })) });

    // 이월 과업: 새 연차의 변경 과업으로 (기간은 새 연차 안으로 맞춤)
    const changeMap = new Map<string, string>();
    for (const [i, c] of carry.entries()) {
      const nc = await tx.contractChange.create({
        data: {
          projectId: p.id, seq: i + 1, title: `(이월) ${c.title}`, signedAt: c.signedAt, amountDelta: 0,
          startDate, endDate: c.endDate < startDate ? startDate : c.endDate > endDate ? endDate : c.endDate,
          managerId: c.managerId, carriedFromId: c.id, note: `${src.name} 변경 ${c.seq}차에서 이월`,
          items: { create: c.items.map((it) => ({ itemId: mapItem(it.itemId) })) },
        },
      });
      changeMap.set(c.id, nc.id);
    }

    if (body.copyBudget) {
      const lines = await tx.budgetLine.findMany({ where: { projectId: id }, orderBy: { order: "asc" } });
      // 본 과업 예산 + 이월 과업 예산만 (이월하지 않은 변경 과업 예산은 제외)
      const keep = lines.filter((l) => !l.changeId || changeMap.has(l.changeId));
      await tx.budgetLine.createMany({
        data: keep.map((l) => ({
          projectId: p.id, itemId: mapItem(l.itemId), detail: l.detail, unitPrice: l.unitPrice, periods: l.periods,
          planned: l.planned, order: l.order, changeId: l.changeId ? changeMap.get(l.changeId)! : null,
          bundleItemIds: l.bundleItemIds ? JSON.stringify(parseBundle(l.bundleItemIds).map(mapItem)) : null,
        })),
      });
    }
    return p;
  });
  await audit(user, { projectId: created.id, entity: "Project", entityId: created.id, action: "next-round", data: { from: id, name, startDate, endDate, copyBudget: !!body.copyBudget, carryChangeIds } });
  return NextResponse.json(created, { status: 201 });
});
