import { NextResponse } from "next/server";
import { HttpError, apiUser, assertInputOpen, assertProjectRole, audit, readJson, route } from "@/lib/access";
import { d1Changes, newRowId, prisma } from "@/lib/db";
import { guardedExpenseInsert } from "@/lib/guarded-sql";
import { buildExpenseData, lockedMonthError, listExpenses, resolveProxyPayer, type ExpenseInput } from "@/lib/expenses";
import { isYearMonth } from "@/lib/format";

type Params = { id: string };

/** 월별 지출 내역 (?ym=2026-02) */
export const GET = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id);
  const ym = new URL(req.url).searchParams.get("ym");
  if (ym && !isYearMonth(ym)) throw new HttpError(400, "ym은 YYYY-MM 형식입니다.");
  return NextResponse.json(await listExpenses(user, id, ym ?? undefined));
});

/** 지출 입력 — 마감 확인·예산 점검·저장을 한 트랜잭션에서 */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { project, user } = await assertProjectRole(await apiUser(), id);
  assertInputOpen(project, user);
  const input = await readJson<ExpenseInput>(req);
  // 대신 입력: PM이 팀원을 결제자로 지정 (입력자는 PM으로 남는다)
  const proxyPayer = await resolveProxyPayer(user, id, input.payerId, input.date);
  const opts = proxyPayer ? { payerId: proxyPayer, proxy: true } : {};
  // 운영(D1): 트랜잭션이 없으므로 '그 달이 마감되지 않았을 때만 추가'를 한 문장으로 (사이에 마감이 끼어들면 거절)
  const d1 = process.env.DB_TARGET === "d1";
  const { expense, data } = d1
    ? await (async () => {
      const data = await buildExpenseData(user, project, input, opts);
      const now = new Date();
      const newId = newRowId("e");
      const [n] = (await d1Changes([guardedExpenseInsert({ id: newId, ...data, projectId: id, createdBy: user.id, createdAt: now, updatedAt: now })]))!;
      if (!n) throw await lockedMonthError(id, data.yearMonth);
      return { data, expense: await prisma.expense.findUniqueOrThrow({ where: { id: newId } }) };
    })()
    : await prisma.$transaction(async (tx) => {
      const data = await buildExpenseData(user, project, input, { ...opts, db: tx });
      return { data, expense: await tx.expense.create({ data: { ...data, projectId: id, createdBy: user.id } }) };
    });
  await audit(user, { projectId: id, entity: "Expense", entityId: expense.id, action: "create", data });
  return NextResponse.json(expense, { status: 201 });
});
