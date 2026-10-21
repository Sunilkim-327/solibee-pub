import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { NAME_MAX, str } from "@/lib/validate";

/** 조직 전체 목록 (외부 연동 id 포함) — 재무 승인·시스템 관리자만 (다른 화면은 서버에서 필요한 칸만 읽는다) */
export const GET = route(async () => {
  await apiUser(["HQ", "ADMIN"]);
  return NextResponse.json(await prisma.department.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] }));
});

/** 부서 추가 (시스템 관리자) */
export const POST = route(async (req) => {
  const admin = await apiUser(["ADMIN"]);
  const body = await readJson<{ name?: unknown; code?: unknown; parentId?: unknown; epsEnabled?: boolean }>(req);
  const name = str(body.name, "부서명", NAME_MAX, { required: "부서명을 입력하세요." });
  const code = str(body.code, "부서코드", 50) ?? null;
  const parentId = str(body.parentId, "상위 부서", 100) ?? null;
  if (code && (await prisma.department.findUnique({ where: { code } }))) throw new HttpError(409, "이미 사용 중인 부서코드입니다.");
  if (parentId && !(await prisma.department.findUnique({ where: { id: parentId } }))) {
    throw new HttpError(400, "상위 부서를 찾을 수 없습니다.");
  }
  const order = await prisma.department.count({ where: { parentId } });
  const dept = await prisma.department.create({ data: { name, code, parentId, order, epsEnabled: body.epsEnabled ?? true } });
  await audit(admin, { entity: "Department", entityId: dept.id, action: "create", data: dept });
  return NextResponse.json(dept, { status: 201 });
});
