import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, readJson, route } from "@/lib/access";
import { NEEDS_NOTE } from "@/lib/closing";
import { countUnexplained, loadSelfApproval } from "@/lib/closing-guard-server";
import { applyClosingTransition } from "@/lib/closing-server";
import { prisma } from "@/lib/db";
import { notify, projectPmIds } from "@/lib/notification-server";
import { closingNotifications } from "@/lib/notifications";
import { settleGroup } from "@/lib/settle-server";
import { APPROVAL_REF_MAX } from "@/lib/snapshot";
import { str } from "@/lib/validate";

type Params = { id: string };

/**
 * 승인/반려/승인 취소 (재무 승인): { decision: "approve" | "reject" | "revoke", note, approvalRef? } — 반려·승인 취소는 사유 필수
 * 승인: 결재 문서번호(approvalRef, 선택)를 함께 저장하고, 전환 뒤 승인본 스냅샷을 만든다 (실패해도 승인은 그대로 — 응답 snapshot:false)
 * 승인 가드 (P0-3 ②): 소명 없는 규정 점검 건이 있으면 note(사유) 없이는 409 APPROVE_BLOCKED — 사유를 적으면 승인되고 감사 기록 override에 남는다
 * 자기 승인 (P0-3 ④, 2026-10-15 결정: 차단 아님): 그 달 본사 지출 중 승인자 본인이 입력한 건이 있으면 감사 기록 selfApproval{count, amount}에 남긴다 — 화면은 경고만
 */
const APPROVE_BLOCKED = "APPROVE_BLOCKED";
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const user = await apiUser(["HQ"]);
  const closing = await prisma.monthlyClosing.findUnique({ where: { id } });
  if (!closing) throw new HttpError(404, "상신 내역을 찾을 수 없습니다.");
  assertWritable((await assertProjectRole(user, closing.projectId)).user);

  const { decision, note, approvalRef: rawRef } = await readJson<{ decision?: string; note?: unknown; approvalRef?: unknown }>(req);
  if (decision !== "approve" && decision !== "reject" && decision !== "revoke") throw new HttpError(400, "승인 또는 반려를 선택하세요.");
  const reviewNote = str(note, "사유", 500) ?? null;
  if (NEEDS_NOTE.includes(decision) && !reviewNote) throw new HttpError(400, decision === "revoke" ? "승인 취소 사유를 입력하세요." : "반려 사유를 입력하세요.");
  const approvalRef = decision === "approve" ? str(rawRef, "결재 문서번호", APPROVAL_REF_MAX) : undefined;
  const group = await settleGroup(closing.projectId);
  // 소명 없는 건이 있는 달의 승인은 사유 필수 (재무 승인이 알고 승인했다는 기록)
  let override: { unexplained: number } | undefined;
  let selfApproval: { count: number; amount: number } | null = null;
  if (decision === "approve") {
    const [unexplained, self] = await Promise.all([countUnexplained(group.ids, closing.yearMonth), loadSelfApproval(group.ids, closing.yearMonth, user.id)]);
    if (unexplained > 0) {
      if (!reviewNote) throw new HttpError(409, `소명 없는 규정 점검 ${unexplained}건이 있습니다. 그래도 승인하려면 사유를 적으세요.`, { code: APPROVE_BLOCKED, unexplained });
      override = { unexplained };
    }
    selfApproval = self;
  }

  const { closing: updated, from, to } = await applyClosingTransition({
    projectId: closing.projectId,
    yearMonth: closing.yearMonth,
    action: decision,
    role: user.role,
    stamp: { reviewedAt: new Date(), reviewedBy: user.id, reviewNote, ...(approvalRef !== undefined ? { approvalRef } : {}) },
  });
  await audit(user, {
    projectId: closing.projectId,
    entity: "MonthlyClosing",
    entityId: id,
    action: decision,
    data: { from, to, note: reviewNote, ...(approvalRef ? { approvalRef } : {}), ...(override ? { override } : {}), ...(selfApproval ? { selfApproval } : {}) },
  });
  let snapshot: { id: string; version: number } | false | undefined;
  if (decision === "approve") {
    try {
      const { createClosingSnapshot } = await import("@/lib/snapshot-server");
      const snap = await createClosingSnapshot({ closingId: id, projectId: closing.projectId, ym: closing.yearMonth, kind: "APPROVE", userId: user.id });
      snapshot = { id: snap.id, version: snap.version };
    } catch (e) {
      console.error(`[closing approve ${id}] 승인본 저장 실패`, e);
      snapshot = false;
      await audit(user, { projectId: closing.projectId, entity: "ClosingSnapshot", entityId: id, action: "snapshot-fail", data: { kind: "APPROVE", error: (e as Error).message?.slice(0, 300) } });
    }
  }
  // PM(메인 + 함께 상신하는 서브의 PM)에게 앱 내 알림 — 반려·승인 취소는 사유를 본문에 (실패해도 검토 결과는 그대로)
  await notify(closingNotifications({
    action: decision, project: { id: closing.projectId, name: group.self?.name ?? "" }, ym: closing.yearMonth, note: reviewNote,
    actorId: user.id, actorName: user.name, pmIds: await projectPmIds(group.ids), hqIds: [],
  }));
  return NextResponse.json(snapshot === undefined ? updated : { ...updated, snapshot });
});
