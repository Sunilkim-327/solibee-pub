import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { isMove, moveInList, orderUpdates } from "@/lib/reorder";
import { MASTER_EDITORS } from "@/lib/rules";

type Params = { id: string };

/** 분류 수정 (재무 승인): { name?, move?: "up" | "down" } — 분류는 회사 공통 */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(MASTER_EDITORS);
  const before = await prisma.category.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "분류를 찾을 수 없습니다.");
  const body = await readJson<{ name?: unknown; move?: unknown }>(req);
  let changed = false;

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 30) throw new HttpError(400, "분류명은 1~30자로 입력하세요.");
    if (name !== before.name) {
      if (await prisma.category.findFirst({ where: { name, NOT: { id } } })) throw new HttpError(409, `이미 같은 이름의 분류가 있습니다: ${name}`);
      await prisma.category.update({ where: { id }, data: { name } });
      changed = true;
    }
  }

  if (isMove(body.move)) {
    // 순서를 0..n으로 다시 매기고 이웃과 바꾼다
    const all = await prisma.category.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, order: true } });
    const next = moveInList(all, id, body.move);
    if (!next) throw new HttpError(409, "목록이 바뀌어 옮길 수 없습니다. 새로고침 후 다시 시도하세요.");
    {
      // 순서 값이 바뀌는 행만 저장 (보통 이웃 두 행)
      await prisma.$transaction(orderUpdates(next).map(({ id: cid, order }) => prisma.category.update({ where: { id: cid }, data: { order } })));
      changed = true;
    }
  }

  // 바뀐 것이 없으면 기록하지 않는다
  if (!changed) return NextResponse.json(before);
  const after = await prisma.category.findUnique({ where: { id } });
  await audit(user, { entity: "Category", entityId: id, action: "update", data: { before, after } });
  return NextResponse.json(after);
});
