// 재무 승인 판단 요약 데이터 — 서버 (설계 검토(2026-10-14) P0-3). 계산은 lib/hq-summary.ts 순수함수, 화면은 components/closing/HqSummary.tsx
// 예산 대비 집행 표는 상신 엑셀과 같은 데이터(lib/export.ts loadWorkbookData — 그 달까지 범위)를 그대로 쓴다 (새 집계 코드 없음).
import "server-only";
import { chunkIds } from "./chunk";
import { loadSelfApproval } from "./closing-guard-server";
import { prisma } from "./db";
import { loadWorkbookData } from "./export";
import { expenseChanges, hqBudgetTable, reviewTimeline, type AuditLogLike } from "./hq-summary";
import { hqUserIds } from "./notification-server";

const LOG_SELECT = { id: true, action: true, userId: true, createdAt: true, data: true } as const;
/** 반려 이후 바뀐 지출 목록 상한 */
export const CHANGE_LIMIT = 50;

/** 마감 행 중 검토 이력에 필요한 칸 */
export type ClosingForSummary = { id: string; status: string; reviewedAt: Date | null; lastReviewedAt: Date | null };

/**
 * 고른 달의 판단 요약 데이터: 예산 대비 집행 표(엑셀 예산 시트와 같은 행·열) · 검토 이력(상신·반려·승인 취소·승인 기록) · 반려 이후 바뀐 지출
 * @param groupIds 메인 + 함께 상신하는 서브 (지출 변경 기록 범위)
 * @param approverId 승인할 사람(재무 승인 담당 본인) — 자기 승인 경고 계산용. 승인자가 아니면 null
 */
export async function loadHqSummary(x: { projectId: string; ym: string; groupIds: string[]; closing: ClosingForSummary | null; approverId?: string | null }) {
  const [wb, closingLogs, selfApproval, hqIds] = await Promise.all([
    loadWorkbookData(x.projectId, x.ym),
    x.closing
      ? prisma.auditLog.findMany({
        where: { entity: "MonthlyClosing", entityId: x.closing.id, action: { in: ["submit", "reject", "revoke", "approve"] } },
        orderBy: { createdAt: "desc" }, take: 20, select: LOG_SELECT,
      })
      : ([] as AuditLogLike[]),
    // 자기 승인 경고 (P0-3 ④, 차단 아님): 그 달 본사 지출 중 승인자 본인이 입력한 건 — 승인 라우트와 같은 조회
    loadSelfApproval(x.groupIds, x.ym, x.approverId),
    // 재무 승인 담당이 2명 이상이면 "다른 담당이 승인하는 것이 좋아요" 보조 문구
    x.approverId ? hqUserIds() : ([] as string[]),
  ]);
  const table = hqBudgetTable({ parts: wb.parts, months: wb.months, ym: x.ym, prefixOf: wb.prefixOf });
  const timeline = reviewTimeline(closingLogs);
  // "반려 이후": 지금 반려 상태면 그 반려 시각, 재마감했으면 옮겨 둔 직전 반려 시각, 둘 다 없으면 기록의 마지막 반려·승인 취소
  const lastReject = timeline.find((e) => e.action === "reject" || e.action === "revoke")?.at ?? null;
  const sinceAt = x.closing ? ((x.closing.status === "REJECTED" ? x.closing.reviewedAt : x.closing.lastReviewedAt) ?? lastReject) : null;
  const expenseLogs = sinceAt
    ? await prisma.auditLog.findMany({
      where: { entity: "Expense", projectId: { in: x.groupIds }, createdAt: { gt: sinceAt } },
      orderBy: { createdAt: "desc" }, take: CHANGE_LIMIT, select: LOG_SELECT,
    })
    : [];
  const changes = expenseChanges(expenseLogs, x.ym);
  // 이름: 처리자·결제자(사용자), 항목
  const userIds = [...new Set([...timeline.map((e) => e.byId), ...changes.flatMap((c) => [c.byId, c.payerId ?? ""])].filter(Boolean))];
  const itemIds = [...new Set(changes.flatMap((c) => [c.itemId ?? "", c.itemAfterId ?? ""]).filter(Boolean))];
  const [users, items] = await Promise.all([
    Promise.all(chunkIds(userIds).map((ids) => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }))).then((r) => r.flat()),
    Promise.all(chunkIds(itemIds).map((ids) => prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }))).then((r) => r.flat()),
  ]);
  return {
    table,
    timeline,
    sinceAt,
    changes,
    /** 50건 상한에 걸려 더 있을 수 있음 */
    changesTruncated: expenseLogs.length >= CHANGE_LIMIT,
    /** 자기 승인 경고 — 승인자 본인이 입력한 본사 지출 (없으면 null). otherHq: 다른 재무 승인 담당이 있음 */
    selfApproval: selfApproval ? { ...selfApproval, otherHq: hqIds.filter((id) => id !== x.approverId).length > 0 } : null,
    userName: new Map(users.map((u) => [u.id, u.name])),
    itemName: new Map(items.map((i) => [i.id, i.name])),
  };
}

export type HqSummaryData = Awaited<ReturnType<typeof loadHqSummary>>;
