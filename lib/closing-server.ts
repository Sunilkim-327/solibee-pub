// 월 마감 상태 전환 — 서버 공통 (조건부 갱신으로 동시 처리 경합 차단)
import "server-only";
import type { Prisma } from "@prisma/client";
import { HttpError } from "./access";
import { transition, transitionFailureStatus, type ClosingAction } from "./closing";
import { prisma } from "./db";
import { sqlClosingReviewLogs } from "./sql-loaders";
import { parseClosingStatus, type Role } from "./types";

/**
 * 마감 상태 전환: 현재 상태 확인 → (beforeWrite 추가 점검) → 읽은 상태일 때만 갱신.
 * 그 사이 다른 사람이 먼저 처리했으면 409. 마감 행이 없으면 DRAFT로 먼저 만든다.
 */
export async function applyClosingTransition(opts: {
  projectId: string;
  yearMonth: string;
  action: ClosingAction;
  role: Role;
  /** 전환 시 함께 저장할 값 */
  stamp?: Prisma.MonthlyClosingUpdateManyMutationInput;
  /** 전환 가능 확인 후, 저장 전에 할 점검 (예: 정산 검증) */
  beforeWrite?: () => Promise<void>;
}) {
  const { projectId, yearMonth, action, role } = opts;
  const where = { projectId_yearMonth: { projectId, yearMonth } };
  const existing = await prisma.monthlyClosing.findUnique({ where, select: { status: true } });
  const from = parseClosingStatus(existing?.status);
  const t = transition(from, action, role);
  if (!t.ok) throw new HttpError(transitionFailureStatus(t), t.reason);
  await opts.beforeWrite?.();

  const closing = await prisma.$transaction(async (tx) => {
    // 마감 행이 없을 때만 DRAFT로 먼저 만든다 (있으면 조회 없이 바로 갱신)
    if (!existing) await tx.monthlyClosing.upsert({ where, create: { projectId, yearMonth, status: "DRAFT" }, update: {} });
    const res = await tx.monthlyClosing.updateMany({
      where: { projectId, yearMonth, status: from },
      data: { ...opts.stamp, status: t.next },
    });
    if (res.count === 0) throw new HttpError(409, "다른 사람이 먼저 처리했습니다. 새로고침 후 다시 확인하세요.");
    return tx.monthlyClosing.findUniqueOrThrow({ where });
  });
  return { closing, from, to: t.next };
}

/** 반려 상태 중 승인 취소로 돌아온 달 (yearMonth 집합) — 마감 행 목록에서 */
export async function revokedMonths(closings: { id: string; yearMonth: string; status: string }[]): Promise<Set<string>> {
  const rejected = closings.filter((c) => c.status === "REJECTED");
  const ids = await revokedClosingIds(rejected.map((c) => c.id));
  return new Set(rejected.filter((c) => ids.has(c.id)).map((c) => c.yearMonth));
}

/**
 * 반려 상태인 마감 중 '승인 취소'로 돌아온 것 (상태 값은 둘 다 REJECTED — 마지막 재무 승인 처리 기록으로 구분, 표시용).
 * 반려 상태가 없으면 조회하지 않는다
 */
export async function revokedClosingIds(rejectedIds: string[]): Promise<Set<string>> {
  if (!rejectedIds.length) return new Set();
  // 직접 SQL (현황·입력 화면 할 일이 매 요청 쓴다)
  const logs = await sqlClosingReviewLogs(rejectedIds);
  const last = new Map<string, string>();
  for (const l of logs) if (!last.has(l.entityId)) last.set(l.entityId, l.action);
  return new Set([...last].filter(([, a]) => a === "revoke").map(([id]) => id));
}
