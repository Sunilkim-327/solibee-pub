import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { ITEM_TEXT_MAX, itemCodeProblem, textInput } from "@/lib/item-code";
import { itemCodeDupMessage, itemNameDupMessage, withItemUnique } from "@/lib/item-unique";
import { parseBundle } from "@/lib/budget-bundle";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";
import { isMove, moveInList, orderUpdates } from "@/lib/reorder";
import { MASTER_EDITORS } from "@/lib/rules";

type Params = { id: string };

/** 항목 수정 (재무 승인): 이름·분류·한도·사용여부 등. 코드는 프로젝트 안에서 유일 */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(MASTER_EDITORS);
  const before = await prisma.item.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "항목을 찾을 수 없습니다.");
  if (before.projectId) assertWritable((await assertProjectRole(user, before.projectId)).user);
  const body = await readJson<{
    name?: string;
    code?: string;
    categoryId?: string;
    /** 공통 항목: 새 프로젝트 기본 포함 */
    isDefault?: boolean;
    /** 출입증 항목: 연결 예산 항목 (null이면 해제) */
    linkedItemId?: string | null;
    /** 같은 프로젝트·같은 분류 안에서 순서 이동 */
    move?: "up" | "down";
    accountCode?: string;
    keywords?: string;
    active?: boolean;
    perPersonLimit?: number | null;
    perCaseLimit?: number | null;
    hardBudget?: boolean;
    needsAttendees?: boolean;
  }>(req);
  const limit = (v: number | null | undefined, label: string) => {
    if (v === undefined) return undefined;
    if (v === null || v === 0) return null;
    if (!Number.isInteger(v) || v < 0) throw new HttpError(400, `${label}는 0 이상의 정수입니다.`);
    return v;
  };
  // 글자 입력: 타입·길이
  const text = (v: unknown, label: string, max: number) => {
    const r = textInput(v, label, max);
    if ("error" in r) throw new HttpError(400, r.error);
    return r.value;
  };
  const name = text(body.name, "항목명", ITEM_TEXT_MAX.name);
  const accountCode = text(body.accountCode, "회계계정", ITEM_TEXT_MAX.accountCode);
  const keywords = text(body.keywords, "키워드", ITEM_TEXT_MAX.keywords);
  if (body.code !== undefined && typeof body.code !== "string") throw new HttpError(400, "항목 코드 값이 올바르지 않습니다.");
  if (body.categoryId !== undefined && typeof body.categoryId !== "string") throw new HttpError(400, "분류 값이 올바르지 않습니다.");
  if (body.linkedItemId !== undefined && body.linkedItemId !== null && typeof body.linkedItemId !== "string") throw new HttpError(400, "연결 항목 값이 올바르지 않습니다.");
  if (body.perPersonLimit !== undefined && body.perPersonLimit !== null && typeof body.perPersonLimit !== "number") throw new HttpError(400, "1인당 한도는 숫자로 입력하세요.");
  if (body.perCaseLimit !== undefined && body.perCaseLimit !== null && typeof body.perCaseLimit !== "number") throw new HttpError(400, "1건 한도는 숫자로 입력하세요.");
  const perPersonLimit = limit(body.perPersonLimit, "1인당 한도");
  const perCaseLimit = limit(body.perCaseLimit, "1건 한도");
  if (body.name !== undefined && !name) throw new HttpError(400, "항목명을 입력하세요.");
  // 중복 앱 검사 — 공통 항목(projectId null)은 DB 유니크가 안 걸리므로 이 검사가 유일한 방어 (schema.prisma Item 주석)
  if (name && (await prisma.item.findFirst({ where: { projectId: before.projectId, name, NOT: { id } } }))) {
    throw new HttpError(409, itemNameDupMessage(name));
  }
  const code = body.code === undefined ? undefined : body.code.trim();
  if (code !== undefined) {
    const p = itemCodeProblem(code);
    if (p) throw new HttpError(400, p);
    const dup = await prisma.item.findMany({ where: { projectId: before.projectId, NOT: { id } }, select: { code: true } });
    if (dup.some((d) => (d.code ?? "").toLowerCase() === code.toLowerCase())) throw new HttpError(409, itemCodeDupMessage(code));
  }
  // 순서 이동: 같은 프로젝트·분류의 항목을 0..n으로 다시 매기고 이웃과 바꾼다
  if (isMove(body.move)) {
    const sib = await prisma.item.findMany({ where: { projectId: before.projectId, categoryId: before.categoryId }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, order: true } });
    const next = moveInList(sib, id, body.move);
    if (!next) throw new HttpError(409, "목록이 바뀌어 옮길 수 없습니다. 새로고침 후 다시 시도하세요.");
    {
      // 순서 값이 바뀌는 행만 저장 (보통 이웃 두 행). 순서 값이 겹쳐 있으면 0..n-1로 다시 매겨진다
      await prisma.$transaction(orderUpdates(next).map((x) => prisma.item.update({ where: { id: x.id }, data: { order: x.order } })));
      await audit(user, { projectId: before.projectId ?? undefined, entity: "Item", entityId: id, action: "move", data: { move: body.move, order: next.map((x) => x.id) } });
    }
    return NextResponse.json({ ok: true, order: next.map((x) => x.id) });
  }
  // 연결 예산 항목: 출입증 항목만, 같은 프로젝트(또는 공통)의 출입증이 아닌 항목만
  if (body.linkedItemId !== undefined && body.linkedItemId !== null) {
    if (before.categoryId !== PASS_CATEGORY_ID) throw new HttpError(400, "연결 예산 항목은 출입증 항목에만 지정합니다.");
    const target = await prisma.item.findUnique({ where: { id: body.linkedItemId }, select: { projectId: true, categoryId: true } });
    if (!target || target.projectId !== before.projectId || target.categoryId === PASS_CATEGORY_ID) throw new HttpError(400, "같은 프로젝트의 예산 항목만 연결할 수 있습니다.");
  }
  const moving = body.categoryId !== undefined && body.categoryId !== before.categoryId;
  if (moving) {
    if (!(await prisma.category.findUnique({ where: { id: body.categoryId } }))) throw new HttpError(400, "분류를 찾을 수 없습니다.");
    // 묶음 예산에 들어 있는 항목은 같은 분류끼리만 묶이므로, 옮기기 전에 묶음에서 빼야 함
    const lines = before.projectId ? await prisma.budgetLine.findMany({ where: { projectId: before.projectId }, select: { itemId: true, bundleItemIds: true } }) : [];
    const inBundle = lines.some((l) => parseBundle(l.bundleItemIds).includes(id) || (l.itemId === id && parseBundle(l.bundleItemIds).length));
    if (inBundle) throw new HttpError(409, `'${before.name}'은(는) 묶음 예산에 들어 있어 분류를 바꿀 수 없습니다. 프로젝트 운영비에서 묶음을 먼저 풀어 주세요.`);
    // 출입증 분류 안팎으로 옮기기: 예산·지출·팀원 항목·출입증 사용에 쓰인 항목은 불가 (예산 대상이 뒤섞임)
    if (before.categoryId === PASS_CATEGORY_ID || body.categoryId === PASS_CATEGORY_ID) {
      const [budget, expenses, members, passLines, passUsages] = await Promise.all([
        prisma.budgetLine.count({ where: { itemId: id } }),
        prisma.expense.count({ where: { itemId: id } }),
        prisma.memberItem.count({ where: { itemId: id } }),
        prisma.passStatementLine.count({ where: { usageItemId: id } }),
        prisma.clientPassUsage.count({ where: { itemId: id } }),
      ]);
      if (budget || expenses || members || passLines || passUsages) {
        throw new HttpError(409, `'${before.name}'은(는) 이미 쓰이고 있어 출입증 분류 안팎으로 옮길 수 없습니다. 새 항목을 만들어 쓰세요.`);
      }
    }
  }
  // 사전 검사와 저장 사이에 같은 이름·코드가 들어오면 DB 유니크 위반(P2002) → 같은 409 문구
  const item = await withItemUnique({ name, code }, () => prisma.item.update({
    where: { id },
    data: {
      ...(name !== undefined && name !== null && { name }),
      ...(code !== undefined && { code }),
      ...(moving && { categoryId: body.categoryId }),
      // 출입증 분류 밖으로 옮기면 연결 예산 항목 해제
      ...(moving && before.categoryId === PASS_CATEGORY_ID && { linkedItemId: null }),
      ...(body.isDefault !== undefined && { isDefault: !!body.isDefault }),
      ...(body.linkedItemId !== undefined && { linkedItemId: body.linkedItemId || null }),
      ...(accountCode !== undefined && { accountCode }),
      ...(keywords !== undefined && { keywords }),
      ...(body.active !== undefined && { active: !!body.active }),
      ...(perPersonLimit !== undefined && { perPersonLimit }),
      ...(perCaseLimit !== undefined && { perCaseLimit }),
      ...(body.hardBudget !== undefined && { hardBudget: !!body.hardBudget }),
      ...(body.needsAttendees !== undefined && { needsAttendees: !!body.needsAttendees }),
    },
  }));
  await audit(user, { projectId: before.projectId ?? undefined, entity: "Item", entityId: id, action: "update", data: { before, after: item } });
  return NextResponse.json(item);
});

/**
 * 항목 삭제 (재무 승인) — 삭제/비활성 정책 (설계 검토(2026-10-14) P1-7): "기록이 참조하면 삭제 대신 '사용 안 함', 참조 없을 때만 삭제".
 * 기록성 참조(지출·출입증 사용·출입증 명세 줄·예산 행)가 하나라도 있으면 409 { inUse: true } → 화면이 '사용 안 함'을 안내.
 * 설정성 참조(팀원 입력 항목·변경계약 과업 항목·다른 예산 행의 묶음·출입증 항목의 연결 예산 항목)만 있으면 함께 정리하고 삭제.
 */
export const DELETE = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const user = await apiUser(MASTER_EDITORS);
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) throw new HttpError(404, "항목을 찾을 수 없습니다.");
  if (item.projectId) assertWritable((await assertProjectRole(user, item.projectId)).user);
  // 사용 기록 확인과 삭제를 한 트랜잭션으로 (그 사이 입력된 지출이 있으면 삭제하지 않음)
  const bundled = await prisma.$transaction(async (tx) => {
    const [expenses, passUsages, passLines, budgets] = await Promise.all([
      tx.expense.count({ where: { itemId: id } }),
      tx.clientPassUsage.count({ where: { itemId: id } }),
      tx.passStatementLine.count({ where: { usageItemId: id } }),
      tx.budgetLine.count({ where: { itemId: id } }),
    ]);
    if (expenses || passUsages || passLines || budgets) {
      const what = [expenses && `지출 ${expenses}건`, (passUsages || passLines) && `출입증 사용 ${passUsages + passLines}건`, budgets && `예산 ${budgets}행`].filter(Boolean).join(", ");
      throw new HttpError(409, `'${item.name}'은(는) 사용 기록이 있어 삭제할 수 없습니다 (${what}). 대신 '사용 안 함'으로 바꾸세요.`, { inUse: true });
    }
    const lines = item.projectId ? await tx.budgetLine.findMany({ where: { projectId: item.projectId, bundleItemIds: { contains: id } } }) : [];
    for (const l of lines) {
      const rest = parseBundle(l.bundleItemIds).filter((x) => x !== id);
      await tx.budgetLine.update({ where: { id: l.id }, data: { bundleItemIds: rest.length ? JSON.stringify(rest) : null } });
    }
    await tx.memberItem.deleteMany({ where: { itemId: id } });
    await tx.changeItem.deleteMany({ where: { itemId: id } });
    await tx.item.updateMany({ where: { linkedItemId: id }, data: { linkedItemId: null } });
    await tx.item.delete({ where: { id } });
    return lines;
  });
  await audit(user, { projectId: item.projectId ?? undefined, entity: "Item", entityId: id, action: "delete", data: { item, unbundled: bundled.map((l) => l.id) } });
  return NextResponse.json({ ok: true });
});
