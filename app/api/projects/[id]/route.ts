import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { parseDateOnly, projectMonths, ymKo } from "@/lib/format";
import { wouldCycleProject } from "@/lib/hierarchy";
import { NAME_MAX, str } from "@/lib/validate";
import { EXCEL_PREFIX_MAX, excelPrefixProblem } from "@/lib/settle-group";

type Params = { id: string };

/** 프로젝트 정보 수정 (재무 승인·시스템 관리자): 이름·코드·주관 부서·기간·상위 프로젝트(서브 지정)·메인과 함께 상신·엑셀 구분명 */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(["HQ", "ADMIN"]);
  const { project: before, user: me } = await assertProjectRole(user, id);
  assertWritable(me, { allowAdmin: true });
  const body = await readJson<{ name?: unknown; code?: unknown; departmentId?: unknown; startDate?: string; endDate?: string; parentId?: unknown; settleWithParent?: unknown; excelPrefix?: unknown }>(req);
  const parentId = body.parentId === undefined ? before.parentId : str(body.parentId, "상위 프로젝트", 100) ?? null;
  if (parentId !== before.parentId && parentId) {
    const nodes = await prisma.project.findMany({ select: { id: true, parentId: true } });
    if (wouldCycleProject(nodes, id, parentId)) throw new HttpError(400, "자기 자신이나 하위 프로젝트를 상위로 지정할 수 없습니다.");
  }

  // 메인과 함께 상신 (서브만) + 엑셀 구분명 — 함께 상신하는 서브는 구분명 필수 (메인 항목과 이름이 같아도 상신 엑셀에서 구분되게)
  if (body.settleWithParent !== undefined && typeof body.settleWithParent !== "boolean") throw new HttpError(400, "함께 상신 값이 올바르지 않습니다.");
  const settleWithParent = !!parentId && (body.settleWithParent === undefined ? before.settleWithParent : (body.settleWithParent as boolean));
  const excelPrefix = body.excelPrefix === undefined ? before.excelPrefix : str(body.excelPrefix, "엑셀 구분명", EXCEL_PREFIX_MAX) ?? null;
  if (excelPrefix) {
    const problem = excelPrefixProblem(excelPrefix);
    if (problem) throw new HttpError(400, problem);
  }
  if (settleWithParent && !excelPrefix) throw new HttpError(400, "메인과 함께 상신하려면 엑셀 구분명(예: 대응)을 입력하세요.");
  if (settleWithParent && parentId) {
    const parent = await prisma.project.findUnique({ where: { id: parentId }, select: { excelPrefix: true, settleWithParent: true, parentId: true } });
    if (parent?.parentId && parent.settleWithParent) throw new HttpError(400, "함께 상신하는 서브 프로젝트 아래에는 다시 함께 상신할 수 없습니다. 메인 프로젝트를 상위로 지정하세요.");
    if (parent?.excelPrefix && parent.excelPrefix === excelPrefix) throw new HttpError(400, "메인 프로젝트와 다른 엑셀 구분명을 입력하세요.");
  }

  const name = body.name === undefined ? before.name : str(body.name, "프로젝트명", NAME_MAX, { required: "프로젝트명을 입력하세요." });
  const code = body.code === undefined ? before.code : str(body.code, "프로젝트 코드", 50) ?? null;
  if (code && (await prisma.project.findFirst({ where: { code, NOT: { id } } }))) throw new HttpError(409, "이미 사용 중인 프로젝트 코드입니다.");
  const departmentId = body.departmentId === undefined ? before.departmentId : str(body.departmentId, "조직(부서)", 100) ?? null;
  if (!departmentId) throw new HttpError(400, "프로젝트가 속할 조직(부서)을 선택하세요.");
  if (departmentId !== before.departmentId) {
  const projDept = await prisma.department.findUnique({ where: { id: departmentId }, select: { active: true, epsEnabled: true, name: true } });
  if (!projDept || !projDept.active) throw new HttpError(400, "조직(부서)을 찾을 수 없습니다.");
  if (!projDept.epsEnabled) throw new HttpError(400, `'${projDept.name}'은(는) 프로젝트 체계도에서 사용하지 않는 조직이라 프로젝트를 둘 수 없습니다. 하위 조직을 선택하세요.`);
  }

  const startDate = body.startDate === undefined ? before.startDate : parseDateOnly(body.startDate);
  const endDate = body.endDate === undefined ? before.endDate : parseDateOnly(body.endDate);
  if (!startDate || !endDate || endDate < startDate) throw new HttpError(400, "기간을 올바르게 입력하세요.");
  // 기간을 줄여 이미 입력된 지출·마감 월이 기간 밖으로 나가면 거부
  const months = new Set(projectMonths(startDate, endDate));
  const [used, passUsed, closed, changes] = await Promise.all([
    prisma.expense.findMany({ where: { projectId: id }, select: { yearMonth: true }, distinct: ["yearMonth"] }),
    prisma.clientPassUsage.findMany({ where: { projectId: id }, select: { yearMonth: true }, distinct: ["yearMonth"] }),
    prisma.monthlyClosing.findMany({ where: { projectId: id, status: { not: "DRAFT" } }, select: { yearMonth: true } }),
    prisma.contractChange.findMany({ where: { projectId: id }, select: { seq: true, startDate: true, endDate: true } }),
  ]);
  const outside = (rows: { yearMonth: string }[]) => [...new Set(rows.map((u) => u.yearMonth).filter((m) => !months.has(m)))].sort().map(ymKo).join(", ");
  const keep = "그 달이 들어가도록 기간을 정하세요.";
  if (outside(used)) throw new HttpError(400, `기간 밖에 이미 입력된 지출이 있습니다: ${outside(used)}. ${keep}`);
  if (outside(passUsed)) throw new HttpError(400, `기간 밖에 출입증 사용 내역이 있습니다: ${outside(passUsed)}. ${keep}`);
  if (outside(closed)) throw new HttpError(400, `기간 밖에 마감·상신된 달이 있습니다: ${outside(closed)}. ${keep}`);
  const badChange = changes.find((c) => c.startDate < startDate || c.endDate > endDate);
  if (badChange) throw new HttpError(400, `변경 ${badChange.seq}차 과업 기간이 새 기간을 벗어납니다. 과업 기간을 먼저 조정하세요.`);

  const project = await prisma.project.update({
    where: { id },
    data: { name, code, departmentId, parentId, settleWithParent, excelPrefix, startDate, endDate, fiscalStart: startDate.getUTCMonth() + 1 },
  });
  await audit(user, { projectId: id, entity: "Project", entityId: id, action: "update", data: { before, after: project } });
  return NextResponse.json(project);
});
