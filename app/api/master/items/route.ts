import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route, assertProjectRole, assertWritable } from "@/lib/access";
import { prisma } from "@/lib/db";
import { ITEM_TEXT_MAX, itemCodeProblem, suggestItemCode, textInput } from "@/lib/item-code";
import { itemCodeDupMessage, itemNameDupMessage, withItemUnique } from "@/lib/item-unique";
import { MASTER_EDITORS, defaultNeedsAttendees } from "@/lib/rules";
import { optInt } from "@/lib/validate";

type ItemInput = {
  projectId?: string | null; // 없으면 공통 기본 항목
  categoryId?: string;
  /** 항목 코드 (없으면 분류 코드 + 번호로 자동) */
  code?: string;
  name?: string;
  accountCode?: string;
  keywords?: string;
  /** 1인당 한도 (0·null이면 없음) */
  perPersonLimit?: unknown;
  /** 카드 사용분 참석자 필수 (기본 true) */
  needsAttendees?: unknown;
};

/** 항목 추가 (재무 승인) — 프로젝트별 항목 또는 공통 기본 항목. 코드는 프로젝트 안에서 유일 */
export const POST = route(async (req) => {
  const user = await apiUser(MASTER_EDITORS);
  const body = await readJson<ItemInput>(req);
  if (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== "string") throw new HttpError(400, "프로젝트 값이 올바르지 않습니다.");
  if (body.categoryId !== undefined && typeof body.categoryId !== "string") throw new HttpError(400, "분류를 선택하세요.");
  if (body.code !== undefined && typeof body.code !== "string") throw new HttpError(400, "항목 코드 값이 올바르지 않습니다.");
  const text = (v: unknown, label: string, max: number) => {
    const r = textInput(v, label, max);
    if ("error" in r) throw new HttpError(400, r.error);
    return r.value ?? null;
  };
  const projectId = body.projectId || null;
  if (projectId) assertWritable((await assertProjectRole(user, projectId)).user);
  const name = text(body.name, "항목명", ITEM_TEXT_MAX.name);
  const accountCode = text(body.accountCode, "회계계정", ITEM_TEXT_MAX.accountCode);
  const keywords = text(body.keywords, "키워드", ITEM_TEXT_MAX.keywords);
  if (!name) throw new HttpError(400, "항목명을 입력하세요.");
  const perPersonLimit = optInt(body.perPersonLimit, "1인당 한도", { min: 0 }) || null;
  if (body.needsAttendees !== undefined && typeof body.needsAttendees !== "boolean") throw new HttpError(400, "참석자 필수 값이 올바르지 않습니다.");
  const categoryId = body.categoryId;
  if (!categoryId || !(await prisma.category.findUnique({ where: { id: categoryId } }))) {
    throw new HttpError(400, "분류를 선택하세요.");
  }
  // 중복 앱 검사 — 프로젝트 항목은 DB 유니크(@@unique [projectId,name]·[projectId,code])가 받쳐 주지만,
  // 공통 항목(projectId null)은 SQLite/D1이 NULL을 서로 다르게 보아 제약이 안 걸리므로 이 검사가 유일한 방어다 (없애지 말 것)
  if (await prisma.item.findFirst({ where: { projectId, name } })) throw new HttpError(409, itemNameDupMessage(name));
  const codes = (await prisma.item.findMany({ where: { projectId }, select: { code: true } })).map((i) => i.code ?? "").filter(Boolean);
  const code = body.code?.trim() || suggestItemCode(categoryId, codes);
  const codeProblem = itemCodeProblem(code);
  if (codeProblem) throw new HttpError(400, codeProblem);
  if (codes.some((c) => c.toLowerCase() === code.toLowerCase())) throw new HttpError(409, itemCodeDupMessage(code));
  // 맨 뒤 순서 (개수가 아니라 최댓값 + 1 — 삭제 후 순서 값이 겹쳐 화면·서버 순서가 어긋나지 않게)
  const last = await prisma.item.aggregate({ where: { projectId, categoryId }, _max: { order: true } });
  const order = (last._max.order ?? -1) + 1;
  // 사전 검사와 저장 사이에 같은 이름·코드가 들어오면 DB 유니크 위반(P2002) → 같은 409 문구
  const item = await withItemUnique({ name, code }, () => prisma.item.create({
    data: {
      projectId,
      code,
      // 새 공통 항목은 '새 프로젝트 기본'에서 빠진 상태로 시작 (분류·항목 관리에서 켤 때만 기본 포함)
      isDefault: projectId ? true : false,
      categoryId,
      name,
      accountCode,
      keywords,
      order,
      perPersonLimit,
      needsAttendees: body.needsAttendees !== undefined ? (body.needsAttendees as boolean) : defaultNeedsAttendees(perPersonLimit),
    },
  }));
  await audit(user, { projectId: projectId ?? undefined, entity: "Item", entityId: item.id, action: "create", data: item });
  return NextResponse.json(item, { status: 201 });
});
