import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, projectWriter, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { budgetItemIds } from "@/lib/budget-bundle";

type Params = { id: string };

/**
 * 변경계약 과업 담당 PM의 입력 항목 (팀원 입력 항목과 별도) — 메인 PM·재무 승인·시스템 관리자
 * 항목은 재무 승인이 등록한 예산 항목 중에서만 고른다.
 */
export const PUT = route<Params>(async (req, { params }) => {
  const { id } = await params;
  await apiUser(); // 로그인 확인을 먼저 (없는 id인지 비로그인으로 알 수 없게)
  const change = await prisma.contractChange.findUnique({ where: { id } });
  if (!change) throw new HttpError(404, "변경계약을 찾을 수 없습니다.");
  const { user } = await projectWriter(change.projectId, ["MANAGER", "HQ", "ADMIN"], { allowAdmin: true });
  const { itemIds } = await readJson<{ itemIds?: unknown }>(req);
  if (!Array.isArray(itemIds) || itemIds.some((x) => typeof x !== "string")) throw new HttpError(400, "항목 목록이 필요합니다.");
  const budgetItems = new Set(budgetItemIds(await prisma.budgetLine.findMany({ where: { projectId: change.projectId }, select: { itemId: true, bundleItemIds: true } })));
  const ids = [...new Set(itemIds as string[])];
  if (ids.length > 500) throw new HttpError(400, "항목은 500개 이하로 지정하세요.");
  if (ids.some((i) => !budgetItems.has(i))) throw new HttpError(400, "재무 승인 담당이 등록한 예산 항목만 선택할 수 있습니다.");
  await prisma.$transaction([
    prisma.changeItem.deleteMany({ where: { changeId: id } }),
    prisma.changeItem.createMany({ data: ids.map((itemId) => ({ changeId: id, itemId })) }),
  ]);
  await audit(user, { projectId: change.projectId, entity: "ContractChange", entityId: id, action: "items", data: { itemIds: ids } });
  return NextResponse.json({ ok: true, itemIds: ids });
});
