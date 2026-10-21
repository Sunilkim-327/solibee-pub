import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectAccess, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { ymKo } from "@/lib/format";
import { sqlClosingRows } from "@/lib/sql-loaders";
import { PHASE_LABEL, closeBlockerItems, closeBlockers, projectPhase } from "@/lib/lifecycle";

type Params = { id: string };

async function blockerItemsOf(project: Parameters<typeof closeBlockers>[0], id: string) {
  const [closings, used, openPass] = await Promise.all([
    // 메인과 함께 상신하는 서브면 메인의 마감 상태 기준 (lib/sql-loaders sqlClosingRows)
    sqlClosingRows(id),
    prisma.expense.findMany({ where: { projectId: id }, select: { yearMonth: true }, distinct: ["yearMonth"] }),
    prisma.passStatement.findMany({ where: { projectId: id, status: "OPEN" }, select: { yearMonth: true } }),
  ]);
  // 기준일은 한국 시간 오늘 (closeBlockers 기본값)
  return closeBlockerItems(project, closings, used.map((u) => u.yearMonth), undefined, openPass.map((s) => s.yearMonth));
}
const blockerText = (b: Awaited<ReturnType<typeof blockerItemsOf>>) => b.map((x) => (x.months.length ? `${x.label}: ${x.months.map(ymKo).join(", ")}` : x.label));

/** 종료 처리 가능 여부 미리보기 (재무 승인·시스템 관리자): { phase, closed, blockers(글자), items(달·화면 링크용) } */
export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const user = await apiUser(["HQ", "ADMIN"]);
  const project = await assertProjectAccess(user, id);
  const phase = projectPhase(project);
  const items = project.closedAt ? [] : await blockerItemsOf(project, id);
  return NextResponse.json({ phase, closed: !!project.closedAt, blockers: blockerText(items), items });
});

/**
 * 프로젝트 종료·보관 (재무 승인·시스템 관리자)
 * close: 기간 종료 + 지출 있는 월 모두 승인일 때 → 조회 전용
 * reopen: 종료·보관 취소 (수정이 필요할 때)
 * archive / unarchive: 선택 목록에서 숨김·복원 (데이터는 그대로 보존)
 */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(["HQ", "ADMIN"]);
  const project = await assertProjectAccess(user, id);
  const { action } = await readJson<{ action?: string }>(req);
  // 종료·보관 시각 기록용 (단계 판단은 한국 시간 오늘 기준 — projectPhase 기본값)
  const now = new Date();

  let data: { closedAt?: Date | null; closedBy?: string | null; archivedAt?: Date | null };
  if (action === "close") {
    if (project.closedAt) throw new HttpError(400, "이미 종료 처리된 프로젝트입니다.");
    const blockers = blockerText(await blockerItemsOf(project, id));
    if (blockers.length) throw new HttpError(400, `종료 처리할 수 없습니다: ${blockers.join(" / ")}`, { blockers });
    data = { closedAt: now, closedBy: user.id };
  } else if (action === "reopen") {
    if (!project.closedAt && !project.archivedAt) throw new HttpError(400, "종료·보관된 프로젝트가 아닙니다.");
    data = { closedAt: null, closedBy: null, archivedAt: null };
  } else if (action === "archive") {
    if (!project.closedAt) throw new HttpError(400, "종료 처리한 프로젝트만 보관할 수 있습니다.");
    data = { archivedAt: now };
  } else if (action === "unarchive") {
    // 종료 후 1년이 지나 자동 보관된 경우: 종료일을 오늘로 갱신해 다시 1년간 목록에 표시
    data = { archivedAt: null, ...(projectPhase({ ...project, archivedAt: null }) === "ARCHIVED" ? { closedAt: now } : {}) };
  } else throw new HttpError(400, "알 수 없는 작업입니다.");

  const updated = await prisma.project.update({ where: { id }, data });
  const phase = projectPhase(updated);
  await audit(user, {
    projectId: id, entity: "Project", entityId: id, action: `lifecycle-${action}`,
    data: { phase, before: { closedAt: project.closedAt, archivedAt: project.archivedAt }, after: { closedAt: updated.closedAt, archivedAt: updated.archivedAt } },
  });
  return NextResponse.json({ phase, label: PHASE_LABEL[phase] });
});
