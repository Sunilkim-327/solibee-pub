import { NextResponse } from "next/server";
import { HttpError, accessibleProjects, apiUser, assertProjectAccess, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { parseDateOnly } from "@/lib/format";
import { copyItems } from "@/lib/items";
import { syncPmRoles } from "@/lib/pm";
import { NAME_MAX, str, strArray } from "@/lib/validate";

export const GET = route(async () => {
  const user = await apiUser();
  return NextResponse.json(await accessibleProjects(user));
});

type Body = {
  name?: unknown;
  code?: unknown;
  departmentId?: unknown;
  startDate?: string;
  endDate?: string;
  memberIds?: unknown;
  /** PM으로 지정할 사용자 — 팀원이면 PM 권한이 자동 부여된다 */
  pmId?: unknown;
  /** 상위 프로젝트 (서브 프로젝트로 만들 때) */
  parentId?: unknown;
  /** 항목 시작 방법: "template"(공통 기본 항목, 기본값) | "none"(빈 상태) | 다른 프로젝트 id(복사) */
  itemSource?: unknown;
  /** template일 때 넣을 공통 항목 id (없으면 '새 프로젝트 기본'으로 표시된 공통 항목) */
  templateItemIds?: string[];
};

/** 프로젝트 생성 (재무 승인·시스템 관리자) — 기간·주관 부서·PM과 항목 구성을 함께 지정 */
export const POST = route(async (req) => {
  const user = await apiUser(["HQ", "ADMIN"]);
  const body = await readJson<Body>(req);
  const name = str(body.name, "프로젝트명", NAME_MAX, { required: "프로젝트명을 입력하세요." });
  const startDate = parseDateOnly(body.startDate);
  const endDate = parseDateOnly(body.endDate);
  if (!startDate || !endDate || endDate < startDate) throw new HttpError(400, "기간(시작일·종료일)을 올바르게 입력하세요.");
  const pmId = str(body.pmId, "PM", 100) ?? null;
  const memberIds = [...new Set([...strArray(body.memberIds, "팀원", 500), ...(pmId ? [pmId] : [])])];
  if (memberIds.length) {
    const users = await prisma.user.findMany({ where: { id: { in: memberIds }, active: true }, select: { role: true } });
    if (users.length !== memberIds.length) throw new HttpError(400, "팀원 중 찾을 수 없거나 비활성인 사용자가 있습니다.");
    if (users.some((u) => u.role === "HQ" || u.role === "ADMIN")) throw new HttpError(400, "재무 승인·시스템 관리자 계정은 팀원으로 추가할 수 없습니다.");
  }
  // 프로젝트는 반드시 회사 조직(부서)에 속한다
  const departmentId = str(body.departmentId, "조직(부서)", 100, { required: "프로젝트가 속할 조직(부서)을 선택하세요." });
  const projDept = await prisma.department.findUnique({ where: { id: departmentId }, select: { active: true, epsEnabled: true, name: true } });
  if (!projDept || !projDept.active) throw new HttpError(400, "조직(부서)을 찾을 수 없습니다.");
  if (!projDept.epsEnabled) throw new HttpError(400, `'${projDept.name}'은(는) 프로젝트 체계도에서 사용하지 않는 조직이라 프로젝트를 둘 수 없습니다. 하위 조직을 선택하세요.`);
  const code = str(body.code, "프로젝트 코드", 50) ?? null;
  if (code && (await prisma.project.findUnique({ where: { code } }))) throw new HttpError(409, "이미 사용 중인 프로젝트 코드입니다.");
  if (pmId) {
    const pm = await prisma.user.findUnique({ where: { id: pmId }, select: { role: true } });
    if (!pm) throw new HttpError(400, "PM으로 지정할 사용자를 찾을 수 없습니다. 다시 검색해서 고르세요.");
    if (pm.role === "HQ" || pm.role === "ADMIN") throw new HttpError(400, "재무 승인·시스템 관리자 계정은 PM으로 지정할 수 없습니다. 팀원이나 프로젝트 PM 권한의 사용자를 고르세요.");
  }
  const parentId = str(body.parentId, "상위 프로젝트", 100) ?? null;
  if (parentId) await assertProjectAccess(user, parentId);
  const source = str(body.itemSource, "항목 시작 방법", 100) || "template";
  if (source !== "template" && source !== "none") await assertProjectAccess(user, source);

  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        name,
        code,
        departmentId,
        startDate,
        endDate,
        fiscalStart: startDate.getUTCMonth() + 1,
        parentId,
        members: { create: memberIds.map((userId) => ({ userId, isPm: userId === pmId })) },
      },
    });
    if (source === "template") {
      // 고른 공통 항목만 (없으면 '새 프로젝트 기본' 공통 항목)
      const picked = Array.isArray(body.templateItemIds) ? body.templateItemIds.filter((x): x is string => typeof x === "string").slice(0, 500) : null;
      const ids = picked
        ? (await tx.item.findMany({ where: { projectId: null, id: { in: picked } }, select: { id: true } })).map((i) => i.id)
        : (await tx.item.findMany({ where: { projectId: null, isDefault: true, active: true }, select: { id: true } })).map((i) => i.id);
      await copyItems(tx, p.id, null, undefined, ids);
    } else if (source !== "none") await copyItems(tx, p.id, source);
    const roleChanges = pmId ? await syncPmRoles(tx, [pmId]) : [];
    return { ...p, roleChanges };
  });
  const itemCount = await prisma.item.count({ where: { projectId: project.id } });
  await audit(user, { projectId: project.id, entity: "Project", entityId: project.id, action: "create", data: { ...body, itemCount } });
  return NextResponse.json({ ...project, itemCount }, { status: 201 });
});
