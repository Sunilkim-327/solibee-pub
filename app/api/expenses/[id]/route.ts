import { NextResponse } from "next/server";
import { HttpError, apiUser, assertInputOpen, assertProjectRole, audit, readJson, route } from "@/lib/access";
import { d1Changes, prisma } from "@/lib/db";
import { assertMonthOpen, buildExpenseData, canEditExpense, lockedMonthError, type ExpenseInput } from "@/lib/expenses";
import { guardedExpenseDelete, guardedExpenseUpdate } from "@/lib/guarded-sql";
import { formatDate } from "@/lib/format";

type Params = { id: string };

/** 수정·삭제 대상 확인 (권한). 월 마감 여부는 저장 트랜잭션 안에서 확인한다 */
async function loadEditable(id: string) {
  const sessionUser = await apiUser();
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) throw new HttpError(404, "지출을 찾을 수 없습니다. 이미 삭제됐을 수 있으니 화면을 새로고침하세요.");
  const { project, user } = await assertProjectRole(sessionUser, expense.projectId);
  assertInputOpen(project, user);
  if (!canEditExpense(user, expense)) throw new HttpError(403, "본인 지출만 수정·삭제할 수 있습니다.");
  return { user, expense, project };
}

/** 수정 (마감 전만 허용, 팀원은 입력 기한 안만) — 일부 필드만 보내면 기존 값과 병합 */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user, expense, project } = await loadEditable(id);
  const patch = await readJson<ExpenseInput>(req);
  const merged: ExpenseInput = {
    payerId: expense.payerId,
    date: formatDate(expense.date),
    amount: expense.amount,
    payMethod: expense.payMethod,
    itemId: expense.itemId,
    detail: expense.detail,
    headcount: expense.headcount,
    attendees: expense.attendees,
    hasExternal: expense.hasExternal,
    justification: expense.justification,
    merchant: expense.merchant,
    changeId: expense.changeId,
    ...patch,
  };
  const { updated, data } = process.env.DB_TARGET === "d1"
    // 운영(D1): 원래 월·옮길 월이 마감되지 않았을 때만 고치는 한 문장 (사이에 마감이 끼어들면 거절)
    ? await (async () => {
      await assertMonthOpen(expense.projectId, expense.yearMonth, undefined, user);
      const data = await buildExpenseData(user, project, merged, { excludeId: id, payerId: expense.payerId });
      const [n] = (await d1Changes([guardedExpenseUpdate(id, { ...data, updatedAt: new Date() }, data.yearMonth)]))!;
      if (!n) throw await lockedMonthError(expense.projectId, expense.yearMonth, data.yearMonth);
      return { data, updated: await prisma.expense.findUniqueOrThrow({ where: { id } }) };
    })()
    : await prisma.$transaction(async (tx) => {
      // 원래 월 → 옮길 월(buildExpenseData) 순으로 마감·팀원 입력 기한 확인
      await assertMonthOpen(expense.projectId, expense.yearMonth, tx, user);
      // PM이 팀원 건을 고쳐도 결제자는 원래 결제자로 유지 (중복 점검도 원래 결제자 기준)
      const data = await buildExpenseData(user, project, merged, { db: tx, excludeId: id, payerId: expense.payerId });
      return { data, updated: await tx.expense.update({ where: { id }, data }) };
    });
  await audit(user, {
    projectId: expense.projectId,
    entity: "Expense",
    entityId: id,
    action: "update",
    data: { before: expense, after: data },
  });
  return NextResponse.json(updated);
});

export const DELETE = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const { user, expense } = await loadEditable(id);
  // 팀원은 입력 기한(다음 달 3일)이 지난 달의 건을 지울 수 없다 (마감된 달은 마감 문구가 먼저)
  if (process.env.DB_TARGET === "d1") {
    await assertMonthOpen(expense.projectId, expense.yearMonth, undefined, user);
    // 운영(D1): 그 달이 마감되지 않았을 때만 지우는 한 문장
    const [n] = (await d1Changes([guardedExpenseDelete(id)]))!;
    if (!n) throw await lockedMonthError(expense.projectId, expense.yearMonth);
  } else {
    await prisma.$transaction(async (tx) => {
      await assertMonthOpen(expense.projectId, expense.yearMonth, tx, user);
      await tx.expense.delete({ where: { id } });
    });
  }
  await audit(user, { projectId: expense.projectId, entity: "Expense", entityId: id, action: "delete", data: expense });
  return NextResponse.json({ ok: true });
});
