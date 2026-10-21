import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { wouldCycle } from "@/lib/org";
import { NAME_MAX, optInt, str } from "@/lib/validate";

type Params = { id: string };

/** 부서 수정 (시스템 관리자): 이름·코드·상위부서·정렬·사용여부·조직장·체계도 사용 */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const admin = await apiUser(["ADMIN"]);
  const before = await prisma.department.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "부서를 찾을 수 없습니다.");
  const body = await readJson<{ name?: unknown; code?: unknown; parentId?: unknown; order?: unknown; active?: boolean; headId?: unknown; epsEnabled?: boolean }>(req);
  const headId = str(body.headId, "조직장", 100);
  const parentId = str(body.parentId, "상위 부서", 100);
  if (headId) {
    const head = await prisma.user.findUnique({ where: { id: headId }, select: { active: true } });
    if (!head?.active) throw new HttpError(400, "조직장은 활성 사용자만 지정할 수 있습니다.");
  }

  const name = body.name === undefined ? undefined : str(body.name, "부서명", NAME_MAX, { required: "부서명을 입력하세요." });
  const code = str(body.code, "부서코드", 50);
  if (code && (await prisma.department.findFirst({ where: { code, NOT: { id } } }))) throw new HttpError(409, "이미 사용 중인 부서코드입니다.");
  if (parentId !== undefined) {
    const all = await prisma.department.findMany({ select: { id: true, name: true, parentId: true, order: true } });
    if (wouldCycle(all, id, parentId)) throw new HttpError(400, "자기 자신이나 하위 부서 아래로 옮길 수 없습니다.");
  }
  if (body.active === false) {
    const users = await prisma.user.count({ where: { departmentId: id, active: true } });
    if (users) throw new HttpError(409, `소속 임직원 ${users}명을 먼저 다른 부서로 옮기세요.`);
  }

  const dept = await prisma.department.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code }),
      ...(parentId !== undefined && { parentId }),
      ...(body.order !== undefined && { order: optInt(body.order, "정렬 순서") ?? 0 }),
      ...(body.active !== undefined && { active: !!body.active }),
      ...(headId !== undefined && { headId }),
      ...(body.epsEnabled !== undefined && { epsEnabled: !!body.epsEnabled }),
    },
  });
  await audit(admin, { entity: "Department", entityId: id, action: "update", data: { before, after: dept } });
  return NextResponse.json(dept);
});
