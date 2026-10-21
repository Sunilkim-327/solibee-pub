// 지출 입력 검증·권한 규칙 (서버 전용)
import "server-only";
import type { Expense } from "@prisma/client";
import { HttpError, canManage, isHqLike, projectRows, type SessionUser } from "./access";
import { isLocked, lockedMonthMessage } from "./closing";
import { memberInputOpen } from "./lifecycle";
import { inputDeadlineProblem, inputOpen } from "./month-phase";
import { prisma, toNumber, type Db as DbClient, type Tx } from "./db";
import { formatDate, formatPeriod, parseDateOnly, parseIntInput, seoulToday, seoulTodayDate, toYearMonth, won } from "./format";
import { checkPolicy, encodeFlags, limitCap, needsJustification, withPaidNote } from "./policy";
import { companySplit } from "./pass-statement";
import { allowedItemIds, allowedPayMethods, canSeeAllRows, requiresAttendees, resolveChangeId } from "./rules";
import { parsePayMethod, type Role } from "./types";
import { budgetItemIds, bundleBudgets, type BundleLine } from "./budget-bundle";
import { closingRows, myPassCompanyLines, passCompanyLines } from "./queries";
import { sqlExpenseList, sqlPassCompanyLines } from "./sql-loaders";
import { applyPassDup } from "./pass-budget";
import { LOCKED_STATUSES } from "./guarded-sql";

export type ExpenseInput = {
  payerId?: string;
  date?: string;
  amount?: number | string;
  payMethod?: string;
  itemId?: string;
  detail?: string;
  headcount?: number | string | null;
  attendees?: string | null;
  hasExternal?: boolean;
  justification?: string | null;
  merchant?: string | null;
  /** 변경계약 과업 (담당 PM은 자동 지정) */
  changeId?: string | null;
};

type Project = { id: string; startDate: Date; endDate: Date };
/** prisma 또는 $transaction 안의 tx */
type Db = DbClient | Tx;

/** DB 없이 검사하는 입력 필드 (날짜·금액·세부내역·대상인원·참석자·소명·가맹점) */
export type ExpenseFields = {
  date: Date;
  yearMonth: string;
  amount: number;
  detail: string;
  headcount: number | null;
  attendees: string | null;
  hasExternal: boolean;
  justification: string | null;
  merchant: string | null;
};

/**
 * 입력 필드 검증 (순수함수)
 * @param period 프로젝트 기간 — 사용일은 시작일 ≤ 사용일 ≤ min(종료일, 오늘)
 * @param today 오늘 (한국 시간 기준 UTC 자정 — 테스트에서 주입)
 */
export function validateExpenseFields(
  input: ExpenseInput,
  period: { startDate: Date; endDate: Date },
  today: Date = seoulTodayDate(),
): { ok: true; value: ExpenseFields } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const date = parseDateOnly(input.date);
  if (!date) return fail("날짜를 YYYY-MM-DD 형식으로 입력하세요.");
  const yearMonth = toYearMonth(date);
  // 기간 밖이면 어느 기간인지 보여 주고, 기간 안의 미래 날짜는 오늘까지만
  if (date < period.startDate || date > period.endDate) return fail(`사용일이 프로젝트 기간(${formatPeriod(period.startDate, period.endDate)}) 밖이에요.`);
  if (date > today) return fail("사용일은 오늘까지만 입력할 수 있어요.");

  const amount = parseIntInput(input.amount);
  if (amount !== null && amount > 100_000_000) return fail("1건 금액은 1억원 이하로 입력하세요.");
  if (amount === null || Number.isNaN(amount) || amount <= 0) return fail("금액은 1원 이상의 정수로 입력하세요.");

  const detail = (input.detail ?? "").trim();
  if (!detail) return fail("세부내역을 입력하세요.");
  if (detail.length > 300) return fail("세부내역은 300자 이내로 입력하세요.");

  const headcount = parseIntInput(input.headcount);
  if (headcount !== null && (Number.isNaN(headcount) || headcount < 1 || headcount > 1000)) return fail("대상인원은 1명 이상 1,000명 이하로 입력하세요.");

  const attendees = (input.attendees ?? "").trim() || null;
  if (attendees && attendees.length > 500) return fail("참석자는 500자 이내로 입력하세요.");

  const justification = (input.justification ?? "").trim() || null;
  if (justification && justification.length > 300) return fail("소명 사유는 300자 이내로 입력하세요.");

  const merchant = (input.merchant ?? "").trim().slice(0, 60) || null;
  return { ok: true, value: { date, yearMonth, amount, detail, headcount, attendees, hasExternal: !!input.hasExternal, justification, merchant } };
}

/**
 * 지출 등록/수정 입력을 검증해 저장할 데이터로 변환한다.
 * 대상 월 마감 여부·예산 잔액·중복을 함께 확인하므로 저장과 같은 트랜잭션(db)에서 호출한다.
 * @param opts.excludeId 수정 중인 지출 (잔액·중복 계산에서 제외)
 * @param opts.payerId 결제자 (수정 시 원래 결제자 — PM이 팀원 건을 고쳐도 그대로). 기본: 입력한 본인
 * @param opts.proxy PM 대신 입력 (결제자 ≠ 입력자) — 팀원 개인 법인카드 건만
 * @param opts.today 오늘 "YYYY-MM-DD" (한국 시간, 테스트에서 주입) — 사용일 상한·팀원 입력 기한 기준
 */
export async function buildExpenseData(
  user: SessionUser,
  project: Project,
  input: ExpenseInput,
  opts: { excludeId?: string; payerId?: string; proxy?: boolean; db?: Db; today?: string } = {},
) {
  const { excludeId, db = prisma, today = seoulToday() } = opts;
  const payerId = opts.payerId ?? user.id;
  for (const k of ["date", "itemId", "changeId", "payMethod", "detail", "attendees", "payerId"] as const) {
    const v = input[k];
    if (v !== undefined && v !== null && typeof v !== "string") throw new HttpError(400, "입력 값이 올바르지 않습니다.");
  }
  const day = parseDateOnly(input.date);
  const member = user.role === "MEMBER";
  // 검사에 필요한 데이터를 한 번에 읽고 (같은 트랜잭션), 검사는 아래에서 기존 순서대로 한다
  const [closing, item, existing, budgetLines, memberItems, changes] = await Promise.all([
    // 그 달 마감 (메인과 함께 상신하는 서브면 메인의 마감도)
    day ? db.monthlyClosing.findFirst({ where: lockedClosingWhere(project.id, [toYearMonth(day)]), select: { status: true } }) : null,
    input.itemId ? db.item.findUnique({ where: { id: input.itemId } }) : null,
    excludeId ? db.expense.findUnique({ where: { id: excludeId }, select: { changeId: true, itemId: true } }) : null,
    db.budgetLine.findMany({ where: { projectId: project.id }, select: { itemId: true, planned: true, bundleItemIds: true }, orderBy: { order: "asc" } }),
    member ? db.memberItem.findMany({ where: { projectId: project.id }, select: { itemId: true } }) : [],
    db.contractChange.findMany({ where: { projectId: project.id }, select: { id: true, managerId: true, items: { select: { itemId: true } } } }),
  ]);
  // 대상 월이 열려 있는지 먼저 확인 (규정 점검 안내보다 우선)
  if (day) assertClosingOpen(closing?.status);

  const fields = validateExpenseFields(input, project, new Date(`${today}T00:00:00.000Z`));
  if (!fields.ok) throw new HttpError(400, fields.error);
  // 팀원은 그 달 입력 기한(다음 달 3일)까지만 — 마감 문구 다음, 규정 점검보다 먼저. PM 대신 입력은 요청자가 PM이라 통과
  assertInputDeadline(user, fields.value.yearMonth, today);
  const { date, amount, headcount, attendees, hasExternal, justification } = fields.value;
  // 한도(1인당 × 인원, 1건)를 넘긴 결제는 한도 금액으로 정산하고 초과분은 본인 부담 — 저장 금액·예산 비교는 정산 금액(charged) 기준,
  // 결제 금액은 세부내역 뒤에 "(결제금액:13,000원)"으로 남긴다 (lib/policy.ts limitCap·withPaidNote)

  // 결제방법: 팀원은 개인식법인카드 고정, 재무 승인 담당은 본사지출
  const methods = allowedPayMethods(user.role);
  const payMethod = methods.length === 1 ? methods[0] : parsePayMethod(input.payMethod);
  if (!payMethod || !methods.includes(payMethod)) throw new HttpError(400, "선택할 수 없는 결제방법입니다.");
  // 대신 입력은 팀원이 개인 법인카드로 결제한 건만 (팀원 정산 대상) — 공용카드·본사는 PM 본인 결제로 입력
  if (opts.proxy && payMethod !== "PERSONAL_CARD") throw new HttpError(400, "다른 팀원 대신 입력할 때는 개인 법인카드 결제만 입력할 수 있습니다.");

  // 항목: 재무 승인 담당이 예산에 등록한 항목(팀원은 그중 PM이 노출한 항목)만. 분류는 항목에서 자동 결정
  const managed = changes.filter((c) => c.managerId === user.id).map((c) => ({ id: c.id, itemIds: c.items.map((i) => i.itemId) }));
  const memberItemIds = memberItems.map((m) => m.itemId);
  const allowed = allowedFromSources(user.role, budgetLines, memberItemIds, managed.flatMap((c) => c.itemIds));
  if (!item || !item.active || item.projectId !== project.id) throw new HttpError(400, "항목을 선택하세요.");
  if (!allowed.includes(item.id)) {
    throw new HttpError(400, member ? "PM이 설정한 항목만 입력할 수 있습니다." : "예산에 등록된 항목만 입력할 수 있습니다.");
  }

  // 변경계약 과업: 담당 PM은 과업 전용 항목으로 입력하면 자동 연결, 메인 PM·재무 승인 담당은 직접 지정
  // 수정 시 항목을 바꾸지 않았으면 기존 과업 유지, 항목을 바꿨으면 규칙을 다시 적용
  const kept = !!existing && !!input.changeId && existing.changeId === input.changeId && existing.itemId === item.id;
  let changeId: string | null = input.changeId ?? null;
  if (!kept) {
    const resolved = resolveChangeId({
      role: user.role,
      itemId: item.id,
      requested: input.changeId,
      managed,
      memberItemIds,
      projectChangeIds: changes.map((c) => c.id),
    });
    if ("error" in resolved) throw new HttpError(400, resolved.error);
    changeId = resolved.changeId;
  }

  // 대상인원·참석자 필수 (카드 사용분, 공용 비용 항목 제외)
  if (requiresAttendees(payMethod, item.needsAttendees)) {
    if (headcount === null) throw new HttpError(400, "대상인원을 입력하세요.");
    if (!attendees) throw new HttpError(400, "참석자를 입력하세요.");
  }

  // 규정 점검 → 위반 시 소명 필수, 강제 통제 항목은 예산 초과 차단
  const cap = limitCap(amount, headcount, item);
  const charged = cap?.cap ?? amount;
  const notThis = excludeId ? { NOT: { id: excludeId } } : {};
  // 예산 잔액은 묶음 단위: 묶인 항목이면 대표 항목의 예산, 지출은 묶음 전체 합계
  const budget = bundleBudgets(budgetLines)(item.id);
  // 집행 = 카드 지출 + 출입증 확정분 (연결 예산 항목이 이 예산(묶음)에 든 출입증 회사 부담) — 예산은 하나 (lib/pass-budget.ts)
  const [spent, passSpent, same, passDup, primary] = await Promise.all([
    db.expense.aggregate({ where: { projectId: project.id, itemId: { in: budget.group }, ...notThis }, _sum: { amount: true } }),
    // 출입증 확정분은 하루 한도 배분(companySplit) 뒤의 회사 부담분 — 집계와 같은 함수로 계산하려고 줄을 읽는다
    budget.planned === null ? [] : db.passStatementLine.findMany({
      where: { decision: "OVERTIME", statement: { projectId: project.id, status: "CONFIRMED" }, usageItem: { is: { linkedItemId: { in: budget.group } } } },
      select: { id: true, userId: true, date: true, amount: true, decision: true, memberClaim: true, usageItemId: true, time: true, usageItem: { select: { id: true, name: true, perPersonLimit: true } } },
    }),
    db.expense.count({ where: { projectId: project.id, payerId, date, amount: charged, ...notThis } }),
    // 출입증 중복 의심: 같은 사람·같은 날 이 항목에 연결된 출입증 회사 부담(결정 또는 요청) 줄 (외부인 대납 제외, 본사 지출은 보지 않음)
    payMethod === "HQ" ? 0 : db.passStatementLine.count({
      where: {
        userId: payerId, date, onBehalfName: null, statement: { projectId: project.id }, usageItem: { is: { linkedItemId: item.id } },
        OR: [{ decision: "OVERTIME" }, { decision: null, memberClaim: "OVERTIME" }],
      },
    }),
    budget.key !== item.id ? db.item.findUnique({ where: { id: budget.key }, select: { name: true, hardBudget: true } }) : null,
  ]);
  const passItemsOf = [...new Map(passSpent.flatMap((l) => (l.usageItem ? [[l.usageItem.id, l.usageItem] as const] : []))).values()];
  const passSplit = companySplit(passSpent, passItemsOf);
  const passSpentAmount = passSpent.reduce((a, l) => a + (passSplit.get(l.id)?.company ?? l.amount), 0);
  const remainingBefore = budget.planned === null ? null : budget.planned - toNumber(spent._sum.amount) - passSpentAmount;
  // 강제 통제: 입력 항목 또는 묶음 대표 항목이 강제 통제면
  const hard = item.hardBudget || !!primary?.hardBudget;
  const budgetName = primary ? `${primary.name} 묶음` : item.name;
  if (hard && remainingBefore !== null && charged > remainingBefore) {
    // 팀원에게는 예산 금액을 알리지 않는다
    throw new HttpError(400, member
      ? `${budgetName}은(는) 예산 잔액을 넘어 입력할 수 없습니다. PM에게 요청하세요.`
      : `${budgetName}은(는) 잔액 ${won(Math.max(0, remainingBefore))}원을 넘을 수 없는 항목입니다. 재무 승인 담당에게 예산 조정을 요청하세요.`);
  }
  const checked = checkPolicy({ amount, headcount, date, hasExternal, item, remainingBefore, budgetName, sameEntries: same, passDuplicate: passDup > 0 });
  // 팀원 화면에는 예산 잔액 금액을 보이지 않는다 — 금액 대신 다음 일(입력 후 PM 검토)을 알린다.
  // 폼이 점검 목록 위에 "소명 사유를 적어야 입력돼요"를 이미 보이므로 여기서 반복하지 않는다 (components/ExpenseForm.tsx)
  const flags = member ? checked.map((f) => (f.code === "OVER_BUDGET" ? { ...f, message: `${budgetName} 예산 잔액을 넘어요. 입력하면 PM이 검토해요.` } : f)) : checked;
  if (needsJustification(flags) && !justification) {
    throw new HttpError(422, "규정 점검에 걸린 항목이 있어요. 소명 사유를 적으면 입력돼요.", { flags });
  }

  return {
    ...fields.value,
    amount: charged,
    detail: cap ? withPaidNote(fields.value.detail, amount) : fields.value.detail,
    flags: encodeFlags(flags),
    justification: flags.length ? justification : null,
    payerId,
    payMethod,
    isHq: payMethod === "HQ",
    itemId: item.id,
    changeId,
  };
}

/**
 * 사용자가 입력할 수 있는 항목 id (순수함수): 재무 승인이 등록한 예산 항목(묶음 포함) — 팀원은 그중 PM 노출 항목 + 담당 과업 전용 항목
 * @param changeItemIds 팀원 권한 과업 담당 PM이 맡은 변경계약 과업의 전용 항목
 */
export function allowedFromSources(role: Role, lines: BundleLine[], memberItemIds: string[], changeItemIds: string[]): string[] {
  // 묶음으로 예산에 들어간 항목도 입력 가능
  return allowedItemIds(role, budgetItemIds(lines), role === "MEMBER" ? [...memberItemIds, ...changeItemIds] : []);
}

/** 마감 상태면 403 */
function assertClosingOpen(status: string | null | undefined) {
  if (isLocked(status)) throw new HttpError(403, lockedMonthMessage(status));
}

/**
 * 팀원 입력 기한(다음 달 3일, lib/month-phase) 지난 달의 등록·수정·삭제 금지 (403, 화면 안내와 같은 문구).
 * 이 프로젝트에서의 역할이 팀원(MEMBER)일 때만 — PM·재무 승인·시스템 관리자의 대신 입력·수정은 그대로.
 * 마감 검사(assertClosingOpen) 뒤에 부른다 — 마감된 달은 마감 문구가 먼저.
 * @param today 오늘 "YYYY-MM-DD" (테스트에서 주입)
 */
export function assertInputDeadline(user: Pick<SessionUser, "role">, yearMonth: string, today: string = seoulToday()) {
  if (user.role !== "MEMBER") return;
  const problem = inputDeadlineProblem(yearMonth, today);
  if (problem) throw new HttpError(403, problem);
}

/** 운영(D1) 조건부 쓰기가 마감 때문에 거절됐을 때 — 지금 상태로 안내 문구 */
export async function lockedMonthError(projectId: string, ...yearMonths: string[]) {
  const rows = await prisma.monthlyClosing.findMany({ where: lockedClosingWhere(projectId, yearMonths), select: { status: true } });
  return new HttpError(403, lockedMonthMessage(rows.find((r) => isLocked(r.status))?.status ?? "CLOSED"));
}

/**
 * 마감 이후 등록·수정·삭제 금지 (403). 저장과 같은 트랜잭션에서 확인하도록 db를 받는다.
 * user를 주면 팀원 입력 기한도 이어서 확인한다 (마감 문구 → 기한 문구 순)
 */
export async function assertMonthOpen(projectId: string, yearMonth: string, db: Db = prisma, user?: Pick<SessionUser, "role">, today: string = seoulToday()) {
  const c = await db.monthlyClosing.findFirst({ where: lockedClosingWhere(projectId, [yearMonth]), select: { status: true } });
  assertClosingOpen(c?.status);
  if (user) assertInputDeadline(user, yearMonth, today);
}

/**
 * 지출을 잠그는 마감 행 조건: 그 프로젝트의 마감(CLOSED 이상) + 메인과 함께 상신하는 서브면 그 달 메인(같은 연속 사업의 연차 포함)의 마감.
 * D1 조건부 쓰기(lib/guarded-sql monthOpenSql)와 같은 기준
 */
export function lockedClosingWhere(projectId: string, yearMonths: string[]) {
  // 상위(메인)가 다시 함께 상신하는 서브가 아닐 때만 (한 단계 — lib/settle-group settleParentIds)
  const asParentOfChild = { children: { some: { id: projectId, settleWithParent: true } }, NOT: { parentId: { not: null }, settleWithParent: true } };
  return {
    yearMonth: { in: yearMonths },
    status: { in: [...LOCKED_STATUSES] },
    OR: [{ projectId }, { project: asParentOfChild }, { project: { series: { is: { projects: { some: asParentOfChild } } } } }],
  };
}

/**
 * 대신 입력 결제자 확인 — PM(조회 전용 제외)만, 이 프로젝트의 재직 중인 팀원이며 사용일에 철수 전이어야 한다.
 * 본인이거나 지정하지 않으면 null (본인 입력)
 */
export async function resolveProxyPayer(user: SessionUser, projectId: string, payerId: unknown, date: unknown, db: Db = prisma): Promise<string | null> {
  if (payerId == null || payerId === "" || payerId === user.id) return null;
  if (typeof payerId !== "string") throw new HttpError(400, "결제자를 다시 선택하세요.");
  if (!canManage(user) || user.readOnly) throw new HttpError(403, "다른 사람 대신 입력은 이 프로젝트 PM만 할 수 있습니다.");
  const m = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: payerId } },
    select: { leftAt: true, isPayer: true, user: { select: { active: true, name: true } } },
  });
  if (!m || !m.isPayer || !m.user.active) throw new HttpError(400, "이 프로젝트 팀원만 결제자로 고를 수 있습니다.");
  const day = typeof date === "string" ? parseDateOnly(date) : null;
  if (m.leftAt && day && day > m.leftAt) throw new HttpError(400, `${m.user.name}님은 ${formatDate(m.leftAt)}에 이전 팀원으로 처리되어 그 뒤 날짜로는 입력할 수 없습니다.`);
  return payerId;
}

/** 개별 지출 수정 권한: PM/시스템 관리자 전체, 팀원 본인 건, 본사 본사집행 건 */
export function canEditExpense(user: SessionUser, e: Pick<Expense, "payerId" | "createdBy" | "isHq">) {
  if (user.readOnly) return false;
  if (canManage(user)) return true;
  if (user.role === "HQ") return e.isHq;
  return e.payerId === user.id || e.createdBy === user.id;
}

/** 목록 조회 범위: 팀원·상위 PM/조직장 조회(view)는 본인 건만, 그 외는 전체 */
function expenseScope(user: SessionUser) {
  return canSeeAllRows(user) && (canManage(user) || isHqLike(user)) ? {} : { OR: [{ payerId: user.id }, { createdBy: user.id }] };
}

import type { ExpenseRow } from "./dto";
export type { ExpenseRow };

/** 지출 목록과 함께 쓰는 출입증 회사 부담 줄 (요청 안에서 같은 조회를 함께 쓴다) */
function passLinesFor(user: SessionUser, ids: string[], own: boolean, yearMonth?: string) {
  if (!own) return passCompanyLines(ids.join(","));
  return yearMonth ? myPassCompanyLines(ids.join(","), user.id, yearMonth) : sqlPassCompanyLines(ids, { userId: user.id });
}

/**
 * 지출 목록 — projectId 배열이면 하위 프로젝트까지 취합 (하위 건은 조회만)
 * recent: 내가 입력한 건을 월과 상관없이 최근 입력 순으로 take건 (과거 자료를 몰아서 입력할 때 확인·삭제용)
 * home: 지금 보고 있는 프로젝트 (그 프로젝트 건만 수정 가능 — 기본은 첫 프로젝트). 구분 필터로 서브만 볼 때도 수정은 각 프로젝트에서
 */
export async function listExpenses(user: SessionUser, projectId: string | string[], yearMonth?: string, recent?: { take: number }, home?: string) {
  const ids = Array.isArray(projectId) ? projectId : [projectId];
  const homeId = home ?? ids[0];
  // 마감(CLOSED 이상)된 달은 수정 불가로 표시 (수정·삭제 API의 403과 같은 기준). 마감 행은 요청 안에서 화면과 함께 쓴다
  // 직접 SQL (lib/sql-loaders.ts) — 조건·정렬은 예전 Prisma 조회와 같다. 결제자·대신 입력자 이름은 한 번에 읽는다
  const own = Object.keys(expenseScope(user)).length > 0;
  const [list, closings, projects, passLines] = await Promise.all([
    sqlExpenseList({ projectIds: ids, yearMonth, ownUserId: own ? user.id : undefined, recent: recent ? { userId: user.id, take: recent.take } : undefined }),
    closingRows(homeId),
    projectRows(),
    // 출입증 중복 의심은 지금 출입증 결정 기준으로 다시 계산 (결정이 나중에 바뀔 수 있다) — 본인 건만 보면 본인 줄만
    passLinesFor(user, ids, own, yearMonth),
  ]);
  const lockedMonths = new Set(closings.filter((c) => isLocked(c.status)).map((c) => c.yearMonth));
  // 팀원은 입력 기한(다음 달 3일)이 지난 달도 수정 불가 (수정·삭제 API의 403과 같은 기준 — lib/month-phase inputOpen)
  const today = seoulToday();
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const rows = list.rows.map((e) => ({
    ...e,
    payer: list.users.get(e.payerId)!,
    item: list.items.get(e.itemId)!,
    project: projectOf.get(e.projectId)!,
    change: e.changeId ? list.changes.get(e.changeId) ?? null : null,
  }));
  // 대신 입력 표시: 결제자가 아닌 사람이 입력한 건의 입력자 이름
  const enteredBy = new Map([...list.users].map(([id, u]) => [id, u.name]));
  return applyPassDup(rows.map(
    (e): ExpenseRow => ({
      id: e.id,
      payerId: e.payerId,
      payerName: e.payer.name,
      payerPosition: e.payer.position,
      date: formatDate(e.date),
      amount: e.amount,
      payMethod: parsePayMethod(e.payMethod) ?? "PERSONAL_CARD",
      categoryId: e.item.categoryId,
      categoryName: e.item.categoryName,
      itemId: e.itemId,
      itemName: e.item.name,
      detail: e.detail,
      headcount: e.headcount,
      attendees: e.attendees,
      isHq: e.isHq,
      yearMonth: e.yearMonth,
      editable: canEditExpense(user, e) && e.projectId === homeId && !lockedMonths.has(e.yearMonth) && (user.role !== "MEMBER" || (memberInputOpen(e.project) && inputOpen(e.yearMonth, today))),
      projectId: e.projectId,
      projectName: e.project.name,
      hasExternal: e.hasExternal,
      flags: e.flags,
      justification: e.justification,
      merchant: e.merchant,
      changeId: e.changeId,
      changeLabel: e.change ? `변경 ${e.change.seq}차 · ${e.change.title}` : null,
      enteredByName: e.createdBy !== e.payerId ? enteredBy.get(e.createdBy) ?? "다른 사람" : null,
    }),
  ), passLines);
}
