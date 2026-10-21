import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { canManageProjectSettings } from "@/lib/rules";
import { budgetItemIds } from "@/lib/budget-bundle";

type Params = { id: string };

/** 팀원 입력 화면에 노출할 항목 */
export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  await assertProjectRole(await apiUser(), id);
  const rows = await prisma.memberItem.findMany({ where: { projectId: id }, select: { itemId: true } });
  return NextResponse.json(rows.map((r) => r.itemId));
});

/** 팀원 입력 항목 저장 (이 프로젝트 PM): { itemIds } — 재무 승인이 등록한 예산에 있는 항목만 선택 가능 */
export const PUT = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id);
  if (!canManageProjectSettings(user.role)) throw new HttpError(403, "팀원 지출 항목은 이 프로젝트 PM만 설정할 수 있습니다.");
  assertWritable(user);
  const { itemIds } = await readJson<{ itemIds?: string[] }>(req);
  if (!Array.isArray(itemIds)) throw new HttpError(400, "항목 목록이 필요합니다.");
  const budgetItems = new Set(
    budgetItemIds(await prisma.budgetLine.findMany({ where: { projectId: id }, select: { itemId: true, bundleItemIds: true } })),
  );
  if (itemIds.some((x) => typeof x !== "string")) throw new HttpError(400, "항목 목록이 필요합니다.");
  const unique = [...new Set(itemIds)];
  if (unique.length > 500) throw new HttpError(400, "항목은 500개 이하로 지정하세요.");
  const outside = unique.filter((i) => !budgetItems.has(i));
  if (outside.length) throw new HttpError(400, "재무 승인 담당이 등록한 예산에 없는 항목은 선택할 수 없습니다.");
  await prisma.$transaction([
    prisma.memberItem.deleteMany({ where: { projectId: id } }),
    prisma.memberItem.createMany({ data: unique.map((itemId) => ({ projectId: id, itemId })) }),
  ]);
  await audit(user, { projectId: id, entity: "MemberItem", entityId: id, action: "replace", data: unique });
  return NextResponse.json({ ok: true, itemIds: unique });
});
