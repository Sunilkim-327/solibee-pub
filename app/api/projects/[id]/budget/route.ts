import { NextResponse } from "next/server";
import { MONEY_MAX } from "@/lib/format";
import { apiUser, assertProjectRole, assertWritable, audit, HttpError, readJson, route } from "@/lib/access";
import { d1Batch, insertStatements, newRowId, prisma } from "@/lib/db";
import { budgetAuditSummary } from "@/lib/reports";
import { plannedAmount } from "@/lib/settlement";
import { bundleProblem } from "@/lib/budget-bundle";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";
import { BUDGET_EDITORS } from "@/lib/rules";
import { settleGroup } from "@/lib/settle-server";
import { budgetLineDiff, budgetReasonProblem } from "@/lib/snapshot";

type Params = { id: string };

/** 예산 행 (화면과 같이 PM·재무 승인·시스템 관리자만 — 팀원은 볼 수 없음) */
export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  await assertProjectRole(await apiUser(), id, ["MANAGER", "HQ", "ADMIN"]);
  const lines = await prisma.budgetLine.findMany({ where: { projectId: id }, orderBy: { order: "asc" } });
  return NextResponse.json(lines);
});

type LineInput = { itemId?: string; detail?: string; unitPrice?: number; periods?: number; changeId?: string | null; bundleItemIds?: unknown };

/**
 * 예산 일괄 저장 (재무 승인) — 계획금액은 서버에서 월 단가×기간으로 계산. bundleItemIds: 같은 월 단가로 묶은 항목
 * 승인된 달이 있으면(이 프로젝트 또는 함께 상신하는 메인) reason(10~300자) 필수 — 없으면 409 { code: "APPROVED_EXISTS", approvedMonths } (P0-2 ③).
 * 승인본 엑셀은 그대로이고 현재 데이터만 바뀐다. 감사 기록에 사유와 행별 before/after를 남긴다
 */
export const PUT = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(BUDGET_EDITORS); // 재무 승인만 편집
  assertWritable((await assertProjectRole(user, id)).user);
  const { lines, reason } = await readJson<{ lines?: LineInput[]; reason?: unknown }>(req);
  try {
    return await replaceBudget(user, id, lines, reason);
  } catch (e) {
    // 거절 사유를 서버 로그에 남김 (화면에도 같은 메시지)
    if (e instanceof HttpError) console.warn(`[budget PUT ${id}] ${e.status} ${e.message}`);
    throw e;
  }
});

/** 승인된 달 (이 프로젝트 + 함께 상신하는 메인 — 서브 예산 행은 메인 상신 엑셀에 들어간다) */
async function approvedMonthsOf(id: string): Promise<string[]> {
  const group = await settleGroup(id);
  const ids = [id, ...(group.parent ? [group.parent.id] : [])];
  const rows = await prisma.monthlyClosing.findMany({ where: { projectId: { in: ids }, status: "APPROVED" }, select: { yearMonth: true } });
  return [...new Set(rows.map((r) => r.yearMonth))].sort();
}

async function replaceBudget(user: Awaited<ReturnType<typeof apiUser>>, id: string, lines: LineInput[] | undefined, reason: unknown) {
  if (!Array.isArray(lines)) throw new HttpError(400, "예산 행 목록이 필요합니다.");
  if (lines.length > 500) throw new HttpError(400, "예산 행은 500개 이하로 입력하세요.");
  // 승인된 달이 있으면 사유 필수 (409 APPROVED_EXISTS → 화면이 사유를 받아 다시 보낸다)
  const approvedMonths = await approvedMonthsOf(id);
  const problem = budgetReasonProblem(approvedMonths, reason);
  if (problem) throw new HttpError(problem.status, problem.message, problem.extra);
  const changeReason = typeof reason === "string" && reason.trim() ? reason.trim() : null;

  // 출입증 분류 항목은 예산 대상 아님
  const [projectItems, changes, before] = await Promise.all([
    prisma.item.findMany({ where: { projectId: id, categoryId: { not: PASS_CATEGORY_ID } }, select: { id: true, name: true, categoryId: true } }),
    prisma.contractChange.findMany({ where: { projectId: id }, select: { id: true } }),
    // 감사 기록 요약(바뀐 항목)용 기존 행
    prisma.budgetLine.findMany({ where: { projectId: id }, select: { itemId: true, detail: true, unitPrice: true, periods: true, changeId: true, bundleItemIds: true } }),
  ]);
  const itemIds = new Set(projectItems.map((i) => i.id));
  const itemName = new Map(projectItems.map((i) => [i.id, i.name]));
  const itemCategory = new Map(projectItems.map((i) => [i.id, i.categoryId]));
  const changeIds = new Set(changes.map((c) => c.id));
  const data = lines.map((l, order) => {
    const unitPrice = Number(l.unitPrice);
    const periods = Number(l.periods);
    if (!l.itemId || !itemIds.has(l.itemId)) throw new HttpError(400, `${order + 1}행: 항목을 선택하세요.`);
    if (!Number.isInteger(unitPrice) || unitPrice < 0) throw new HttpError(400, `${order + 1}행: 단가는 0 이상의 정수입니다.`);
    if (!Number.isInteger(periods) || periods < 0 || periods > 120) throw new HttpError(400, `${order + 1}행: 기간이 올바르지 않습니다.`);
    if (unitPrice * periods > MONEY_MAX) throw new HttpError(400, `${order + 1}행: 배정 금액이 너무 큽니다 (1조원 이하).`);
    if (l.changeId && !changeIds.has(l.changeId)) throw new HttpError(400, `${order + 1}행: 변경계약 과업을 찾을 수 없습니다.`);
    const bundle = l.bundleItemIds === undefined || l.bundleItemIds === null ? [] : l.bundleItemIds;
    if (!Array.isArray(bundle) || bundle.length > 30 || bundle.some((x) => typeof x !== "string" || !itemIds.has(x))) throw new HttpError(400, `${order + 1}행: 묶음 항목이 올바르지 않습니다.`);
    const extras = [...new Set(bundle as string[])].filter((x) => x !== l.itemId);
    return {
      projectId: id,
      itemId: l.itemId,
      detail: typeof l.detail === "string" ? l.detail.trim().slice(0, 200) : "",
      unitPrice,
      periods,
      planned: plannedAmount(unitPrice, periods),
      order,
      changeId: l.changeId || null,
      bundleItemIds: extras.length ? JSON.stringify(extras) : null,
    };
  });
  const bundleIssue = bundleProblem(data, (x) => itemName.get(x) ?? x, (x) => itemCategory.get(x));
  if (bundleIssue) throw new HttpError(400, bundleIssue);

  // 운영(D1): 기존 행 삭제 + 새 행 추가를 한 번에 원자적으로 (중간 실패로 예산이 비지 않게, 쿼리 수 절약)
  const done = await d1Batch([
    { sql: `DELETE FROM "BudgetLine" WHERE "projectId" = ?`, params: [id] },
    ...insertStatements("BudgetLine", data.map((l) => ({ id: newRowId("b"), ...l }))),
  ]);
  if (!done) {
    await prisma.$transaction([
      prisma.budgetLine.deleteMany({ where: { projectId: id } }),
      prisma.budgetLine.createMany({ data }),
    ]);
  }
  // 전체 행(최대 500행) 대신 요약 + 바뀐 항목의 행별 before/after (승인된 달이 있으면 사유도)
  await audit(user, {
    projectId: id, entity: "BudgetLine", entityId: id, action: "replace",
    data: { ...budgetAuditSummary(before, data), diff: budgetLineDiff(before, data), ...(approvedMonths.length ? { reason: changeReason, approvedMonths } : {}) },
  });
  return NextResponse.json({ ok: true, count: data.length });
}
