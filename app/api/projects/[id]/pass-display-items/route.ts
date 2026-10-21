import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { displayItemsOf, mergeDisplayItems, parseDisplayItems } from "@/lib/pass-statement";
import { getImportProfiles } from "@/lib/pass-statement-server";

type Params = { id: string };

/**
 * 출입증 표시 열 목록 저장 (이 프로젝트 PM): { items: [{key, name, hidden?}] } — 순서대로 화면·엑셀 열.
 * 키는 줄에 저장된 이름표라 바꾸지 않는다(이름만 바뀜). 목록에서 뺀 항목은 숨김으로 남겨 기존 줄의 값은 데이터로 유지
 */
export const PUT = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user, project } = await projectWriter(id, ["MANAGER"]);
  const body = await readJson<{ items?: unknown }>(req);
  const next = parseDisplayItems(body.items);
  if (!next) throw new HttpError(400, "표시 열 목록이 올바르지 않습니다. 이름이 비었거나 겹치는 열이 있습니다.");
  const before = displayItemsOf(project.passDisplayItems, await getImportProfiles(id));
  const items = mergeDisplayItems(before, next);
  await prisma.project.update({ where: { id }, data: { passDisplayItems: JSON.stringify(items) } });
  await audit(user, { projectId: id, entity: "Project", entityId: id, action: "update", data: { passDisplayItems: items } });
  return NextResponse.json({ items });
});
