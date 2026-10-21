// 상신 가드·체크리스트 입력 조회 — 서버 (설계 검토(2026-10-14) P0-1). 판정은 lib/closing.ts submitBlockers · lib/closing-checklist.ts closingChecklist (순수함수)
// 상신 라우트(beforeWrite)·preflight 라우트·승인 라우트(소명 없음 검사)가 같은 조회를 쓴다 — "안내"와 "차단"이 한 소스.
import "server-only";
import { submitBlockers, type Blocker, type PassStatementState, type SubmitGuardInput } from "./closing";
import { closingChecklist, checklistSummary, type CheckItem } from "./closing-checklist";
import { prisma } from "./db";
import { formatDate } from "./format";
import { selfApprovalWarning, type SelfApproval } from "./hq-summary";
import { inputMemberIds } from "./input-capable";
import { servedInMonth } from "./membership";
import { applyPassDup } from "./pass-budget";
import { isUnexplained, needsReview } from "./policy";
import { passCompanyLines, projectMembersOf } from "./queries";
import { getPayers, getSettlement } from "./reports";
import { partLabel } from "./settle-group";
import { PASS_PAY_METHOD } from "./settlement";
import { sqlInputSources } from "./sql-loaders";

type GroupProject = { id: string; name: string; excelPrefix: string | null; clientPassEnabled: boolean };
type Group = { ids: string[]; kids: GroupProject[] };

/** 그 달 지출 (가드·체크리스트·정산 검증이 한 번의 조회를 함께 쓴다) */
const MONTH_EXPENSE_SELECT = {
  id: true, projectId: true, payerId: true, payMethod: true, isHq: true, itemId: true, date: true, amount: true, yearMonth: true, flags: true, justification: true,
  payer: { select: { name: true } },
} as const;

/**
 * 그 달의 출입증 상태(구분별)·소명 없는 건·정산 검증 → 상신 가드 입력 + 체크리스트
 * @param project 메인 프로젝트 (clientPassEnabled·excelPrefix·name)
 * @param group 함께 상신 묶음 (lib/settle-server settleGroup — kids에 clientPassEnabled 포함)
 */
export async function loadSubmitGuard(project: GroupProject, group: Group, ym: string) {
  const all = [project, ...group.kids];
  const passProjects = all.filter((p) => p.clientPassEnabled);
  const monthExpenses = prisma.expense.findMany({ where: { projectId: { in: group.ids }, yearMonth: ym }, select: MONTH_EXPENSE_SELECT });
  const [statements, passLines, expenses, settlement, payers, inputTargets] = await Promise.all([
    passProjects.length ? prisma.passStatement.findMany({ where: { projectId: { in: passProjects.map((p) => p.id) }, yearMonth: ym }, select: { projectId: true, status: true } }) : [],
    passCompanyLines(group.ids.join(",")),
    monthExpenses,
    // 정산 검증 (같은 지출 조회를 함께 쓴다 — 다시 읽지 않음)
    getSettlement(group.ids, ym, monthExpenses.then((list) => list.map((e) => ({ ...e, payerName: e.payer.name })))),
    getPayers(group.ids.length > 1 ? group.ids : project.id),
    Promise.all([projectMembersOf(group.ids.join(",")), sqlInputSources(group.ids)]).then(([members, sources]) => inputMemberIds(members, sources)),
  ]);
  const monthLines = passLines.filter((l) => l.yearMonth === ym);
  // 출입증 상태 — 출입증 쓰는 프로젝트(구분)마다 (메인 상신이 서브 출입증도 잠근다)
  const statusOf = new Map(statements.map((s) => [s.projectId, s.status === "CONFIRMED" ? "CONFIRMED" as const : "OPEN" as const]));
  const passStatements: PassStatementState[] | null = passProjects.length
    ? passProjects.map((p) => ({
      projectId: p.id, label: partLabel(p), status: statusOf.get(p.id) ?? "NONE",
      unlinked: monthLines.filter((l) => l.projectId === p.id && l.decision === "OVERTIME" && !l.linkedItemId).length,
    }))
    : null;
  // 규정 점검: 출입증 중복 의심은 지금 출입증 결정 기준으로 다시 계산 (현황·마감 화면과 같은 기준)
  const checked = applyPassDup(expenses.map((e) => ({ ...e, date: formatDate(e.date) })), monthLines);
  const unexplainedOf = (projectId: string) => checked.filter((e) => e.projectId === projectId && isUnexplained(e)).length;
  const unexplainedAll = checked.filter(isUnexplained).length;
  const input: SubmitGuardInput = {
    ym,
    passStatements,
    // 서브가 있으면 메인 것만 — 서브 소명은 서브 항목(SUB_NOT_READY)으로 (그 프로젝트 PM이 처리)
    unexplainedCount: group.kids.length ? unexplainedOf(project.id) : unexplainedAll,
    subReady: group.kids.length
      ? group.kids.map((k) => { const n = unexplainedOf(k.id); return { name: partLabel(k), ready: n === 0, detail: n ? `소명 없는 규정 점검 ${n}건 (${k.name} PM이 소명)` : undefined }; })
      : undefined,
    settlementInvalid: !settlement.isValid,
  };
  const blockers = submitBlockers(input);
  const checks: CheckItem[] = closingChecklist({
    ym, isValid: settlement.isValid,
    payers: payers.filter((p) => servedInMonth(p, ym) && inputTargets.has(p.id)),
    expenses: checked.filter((e) => e.payMethod !== PASS_PAY_METHOD).map((e) => ({ payerId: e.payerId, flags: e.flags, justification: e.justification })),
    pass: passStatements,
  });
  return { input, blockers, checks, summary: checklistSummary(checks), settlement, unexplained: unexplainedAll, flagged: checked.filter((e) => needsReview(e.flags)).length, passStatements };
}

/** 소명 없는 규정 점검 건수만 (승인 라우트) — 묶음 전체, 출입증 중복 의심 재계산 포함 */
export async function countUnexplained(groupIds: string[], ym: string): Promise<number> {
  const [expenses, passLines] = await Promise.all([
    prisma.expense.findMany({ where: { projectId: { in: groupIds }, yearMonth: ym }, select: { id: true, projectId: true, payerId: true, isHq: true, itemId: true, date: true, flags: true, justification: true } }),
    passCompanyLines(groupIds.join(",")),
  ]);
  const checked = applyPassDup(expenses.map((e) => ({ ...e, date: formatDate(e.date) })), passLines.filter((l) => l.yearMonth === ym));
  return checked.filter(isUnexplained).length;
}

/**
 * 자기 승인 경고 (승인 라우트·판단 요약 공통, P0-3 ④ — 차단 아님): 그 달 본사 지출 중 승인자 본인이 입력한 건수·금액. 없으면 null
 * 묶음 전체(메인 + 함께 상신하는 서브). 판정은 lib/hq-summary.ts selfApprovalWarning
 */
export async function loadSelfApproval(groupIds: string[], ym: string, approverId: string | null | undefined): Promise<SelfApproval | null> {
  if (!approverId) return null;
  const hqExpenses = await prisma.expense.findMany({ where: { projectId: { in: groupIds }, yearMonth: ym, isHq: true }, select: { isHq: true, createdBy: true, amount: true } });
  return selfApprovalWarning(hqExpenses, approverId);
}

export type { Blocker };
