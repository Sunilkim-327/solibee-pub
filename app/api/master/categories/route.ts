import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { MASTER_EDITORS } from "@/lib/rules";

/** 분류/항목 마스터 — 모든 프로젝트의 항목이 들어 있으므로 재무 승인·시스템 관리자만 */
export const GET = route(async () => {
  await apiUser(["HQ", "ADMIN"]);
  const categories = await prisma.category.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { items: { orderBy: [{ order: "asc" }, { name: "asc" }] } },
  });
  return NextResponse.json(categories);
});

/** 분류 추가 (재무 승인): { name, id?(코드 — 없으면 자동) } */
export const POST = route(async (req) => {
  const user = await apiUser(MASTER_EDITORS);
  const body = await readJson<{ id?: string; name?: string }>(req);
  const name = body.name?.trim();
  if (!name || name.length > 30) throw new HttpError(400, "분류명은 1~30자로 입력하세요.");
  if (await prisma.category.findFirst({ where: { name } })) throw new HttpError(409, `이미 같은 이름의 분류가 있습니다: ${name}`);
  // 코드는 화면에 보이지 않으므로 없으면 자동 (항목 코드 앞자리로 쓰임)
  const id = body.id?.trim() || `cat${Date.now().toString(36)}`;
  if (!/^[a-z0-9-]{2,30}$/.test(id)) throw new HttpError(400, "분류 코드는 영문 소문자·숫자·하이픈 2~30자입니다.");
  if (await prisma.category.findUnique({ where: { id } })) throw new HttpError(409, "이미 존재하는 코드입니다.");
  // 맨 뒤 순서 (개수가 아니라 최댓값 + 1 — 삭제 후 순서 값이 겹치지 않게)
  const last = await prisma.category.aggregate({ _max: { order: true } });
  const category = await prisma.category.create({ data: { id, name, order: (last._max.order ?? -1) + 1 } });
  await audit(user, { entity: "Category", entityId: id, action: "create", data: category });
  return NextResponse.json(category, { status: 201 });
});
