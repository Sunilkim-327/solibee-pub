import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { suggestItemCode } from "@/lib/item-code";
import { MASTER_EDITORS } from "@/lib/rules";
import { planImportItems } from "@/lib/settle-group";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";

type Params = { id: string };

/**
 * 메인 항목 가져오기 (재무 승인) — 서브 프로젝트에 상위(메인) 프로젝트의 항목을 같은 항목 코드로 복사한다.
 * - 서브에 같은 코드가 있으면 건너뜀 / 코드가 없는 서브 항목이 같은 분류·이름이면 메인 코드를 붙인다
 * - 코드가 없는 메인 항목에는 분류 코드 + 번호로 코드를 정해 메인에도 저장 (같은 코드 = 같은 항목: 현황 취합·상신 엑셀 구분)
 * - 출입증 항목은 프로젝트별 설정이라 가져오지 않는다. 비활성 메인 항목도 가져오지 않는다
 */
export const POST = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const user = await apiUser(MASTER_EDITORS);
  const { project, user: me } = await assertProjectRole(user, id);
  assertWritable(me);
  if (!project.parentId) throw new HttpError(400, "상위(메인) 프로젝트가 있는 서브 프로젝트에서만 가져올 수 있습니다.");
  const parentId = project.parentId;
  const notPass = { categoryId: { not: PASS_CATEGORY_ID } };
  const [main, child, parent] = await Promise.all([
    prisma.item.findMany({ where: { projectId: parentId, ...notPass }, orderBy: [{ categoryId: "asc" }, { order: "asc" }, { name: "asc" }] }),
    prisma.item.findMany({ where: { projectId: id } }),
    prisma.project.findUnique({ where: { id: parentId }, select: { name: true } }),
  ]);
  const plan = planImportItems(main, child.filter((c) => c.categoryId !== PASS_CATEGORY_ID), suggestItemCode);
  // 새 항목은 분류 안에서 맨 뒤 순서 (메인 순서 그대로 이어서)
  const lastOrder = new Map<string, number>();
  for (const c of child) lastOrder.set(c.categoryId, Math.max(lastOrder.get(c.categoryId) ?? -1, c.order));
  await prisma.$transaction(async (tx) => {
    for (const [itemId, code] of plan.setMainCode) await tx.item.update({ where: { id: itemId }, data: { code } });
    for (const [itemId, code] of plan.setChildCode) await tx.item.update({ where: { id: itemId }, data: { code } });
    for (const it of plan.create) {
      const order = (lastOrder.get(it.categoryId) ?? -1) + 1;
      lastOrder.set(it.categoryId, order);
      await tx.item.create({
        data: {
          projectId: id, code: it.code, categoryId: it.categoryId, name: it.name, accountCode: it.accountCode, keywords: it.keywords,
          perPersonLimit: it.perPersonLimit, perCaseLimit: it.perCaseLimit, hardBudget: it.hardBudget, needsAttendees: it.needsAttendees, order,
        },
      });
    }
  });
  const result = { created: plan.create.length, matched: plan.setChildCode.size, mainCoded: plan.setMainCode.size, parentName: parent?.name ?? "" };
  await audit(user, { projectId: id, entity: "Item", entityId: id, action: "import-parent", data: { parentId, ...result, codes: plan.create.map((c) => c.code) } });
  return NextResponse.json(result);
});
