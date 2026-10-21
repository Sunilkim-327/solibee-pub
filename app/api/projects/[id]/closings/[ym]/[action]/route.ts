import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { HttpError, SMALL_JSON_MAX_BYTES, audit, projectWriter, readBodyLimited, route } from "@/lib/access";
import { REOPEN_REASON_MAX, SUBMIT_NOTE_MAX, futureMonthProblem, submitOverrideProblem, type BlockerCode, type ClosingAction } from "@/lib/closing";
import { loadSubmitGuard } from "@/lib/closing-guard-server";
import { applyClosingTransition } from "@/lib/closing-server";
import { prisma } from "@/lib/db";
import { currentYearMonth, isYearMonth, projectMonths } from "@/lib/format";
import { hqUserIds, notify } from "@/lib/notification-server";
import { closingNotifications } from "@/lib/notifications";
import { getSettlement } from "@/lib/reports";
import { str } from "@/lib/validate";
import { settleGroup } from "@/lib/settle-server";
import { settleWithParentMessage } from "@/lib/settle-group";
import { closeDriftMessage, type CloseStamp } from "@/lib/snapshot";
import { sqlLastClosingLogData } from "@/lib/sql-loaders";

type Params = { id: string; ym: string; action: string };

const PM_ACTIONS: ClosingAction[] = ["close", "submit", "reopen"];

/** 본문이 없어도 되는 POST (마감·마감 해제·상신 기본) — JSON이면 읽고, 비어 있으면 {} */
async function optionalJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return {};
  const text = await readBodyLimited(req, SMALL_JSON_MAX_BYTES);
  if (!text.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new HttpError(400, "잘못된 요청 형식입니다."); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "잘못된 요청 형식입니다.");
  return parsed as Record<string, unknown>;
}

/**
 * 월 마감(close) / 상신(submit) / 마감 해제(reopen) — PM
 * - 마감: 감사 기록 data에 그 시점 총합계·본사·출입증 회사 부담을 남긴다 (상신 전 변경 감지의 기준)
 * - 상신: 마감 때 총합계와 지금 다시 계산한 총합계가 다르면 409 (마감 해제 후 다시 마감). 전환 뒤 상신본 스냅샷 저장 —
 *   스냅샷 저장에 실패해도 상신은 되돌리지 않고 응답에 snapshot:false (조건부 갱신이라 되돌리기 어렵다 — 감사 기록에 남긴다)
 * - 상신 가드 (P0-1): 출입증 확정 전·미연결, 소명 없음, 서브 미처리가 있으면 409 SUBMIT_BLOCKED — body { overrideReason }(10~300자)을 적으면 통과하고
 *   MonthlyClosing.submitOverride에 남긴다. 검증 불일치(INVALID)는 사유로도 못 넘긴다. body { note }는 상신 메모(선택, 300자)
 * - 마감(반려 뒤 재마감): 반려·승인 취소 사유를 lastReviewNote/At/By로 옮긴 뒤 reviewNote를 비운다 (재무 승인 화면 검토 이력에 남게)
 * - 마감 해제: body { reason } 필수 (300자) — 감사 기록 data.reason에 남는다
 */
export const POST = route<Params>(async (req, { params }) => {
  const { id, ym, action: raw } = await params;
  if (!PM_ACTIONS.includes(raw as ClosingAction)) throw new HttpError(404, "알 수 없는 요청입니다.");
  const action = raw as ClosingAction;
  if (!isYearMonth(ym)) throw new HttpError(400, "월 형식이 올바르지 않습니다.");
  const { project, user } = await projectWriter(id, ["MANAGER"]);
  if (!projectMonths(project.startDate, project.endDate).includes(ym)) throw new HttpError(400, "프로젝트 기간 외 월입니다.");
  const future = futureMonthProblem(action, ym, currentYearMonth());
  if (future) throw new HttpError(409, future);
  // 메인과 함께 상신하는 서브: 단독 마감·상신 불가 (메인 PM이 메인과 함께). 함께 상신 설정 전에 마감한 달의 해제만 허용
  const group = await settleGroup(id);
  if (group.parent && action !== "reopen") {
    throw new HttpError(403, settleWithParentMessage((group.parentFor(ym) ?? group.parent).name));
  }

  const now = new Date();
  const body = action === "submit" || action === "reopen" ? await optionalJson(req) : {};
  const submitNote = action === "submit" ? str(body.note, "상신 메모", SUBMIT_NOTE_MAX) ?? null : null;
  const reopenReason = action === "reopen" ? str(body.reason, "마감 해제 사유", REOPEN_REASON_MAX, { required: "마감 해제 사유를 입력하세요." }) : null;
  /** 마감 시점 요약 (감사 기록 data) — 함께 상신하는 서브 지출 포함 (상신 엑셀 월 시트와 같은 범위) */
  const stamp: { v: CloseStamp | null } = { v: null };
  /** 상신 가드 결과 (감사 기록·응답) */
  const guard: { blockers: BlockerCode[]; reason: string | null } = { blockers: [], reason: null };
  // 전환 시 저장할 값 — beforeWrite에서 읽은 것(직전 반려 사유·가드 무시 기록)을 더한다 (저장은 beforeWrite 뒤)
  const closeStamp: Prisma.MonthlyClosingUpdateManyMutationInput = { closedAt: now, reviewNote: null, reviewedAt: null, reviewedBy: null };
  const submitStamp: Prisma.MonthlyClosingUpdateManyMutationInput = { submittedAt: now, submitNote, submitOverride: null };
  const { closing, from, to } = await applyClosingTransition({
    projectId: id,
    yearMonth: ym,
    action,
    role: user.role,
    stamp: action === "close" ? closeStamp : action === "submit" ? submitStamp : {},
    beforeWrite:
      action === "close"
        ? async () => {
            const [s, prev] = await Promise.all([
              getSettlement(group.ids, ym),
              prisma.monthlyClosing.findUnique({ where: { projectId_yearMonth: { projectId: id, yearMonth: ym } }, select: { reviewNote: true, reviewedAt: true, reviewedBy: true } }),
            ]);
            if (!s.isValid) throw new HttpError(409, "팀원별 + 공용 법인카드 + 본사 합이 총합계와 달라 마감할 수 없습니다. 지출 내역에서 결제방법·본사 구분을 확인하세요.");
            stamp.v = { total: s.total, hq: s.hq, pass: s.pass };
            // 반려·승인 취소 사유는 지우지 않고 옮겨 둔다 (P0-3 검토 이력 보존)
            if (prev?.reviewNote) Object.assign(closeStamp, { lastReviewNote: prev.reviewNote, lastReviewedAt: prev.reviewedAt, lastReviewedBy: prev.reviewedBy });
          }
        : action === "submit"
          ? async () => {
              const row = await prisma.monthlyClosing.findUnique({ where: { projectId_yearMonth: { projectId: id, yearMonth: ym } }, select: { id: true } });
              const [logged, g] = await Promise.all([row ? sqlLastClosingLogData(row.id, "close") : null, loadSubmitGuard(project, group, ym)]);
              // 마감 후 변경 감지: 최근 마감 기록의 총합계 vs 지금 (총합계가 없는 옛 기록은 검사 생략)
              const drift = closeDriftMessage(logged, g.settlement.total);
              if (drift) throw new HttpError(409, drift);
              // 상신 가드: 미완료 항목이 있으면 사유 필수 (검증 불일치는 사유로도 불가)
              const problem = submitOverrideProblem(g.blockers, body.overrideReason);
              if (problem) throw new HttpError(problem.status, problem.message, problem.extra);
              if (g.blockers.length) {
                guard.blockers = g.blockers.map((b) => b.code);
                guard.reason = (body.overrideReason as string).trim();
                submitStamp.submitOverride = JSON.stringify({ reason: guard.reason, blockers: guard.blockers, at: now.toISOString() });
              }
            }
          : undefined,
  });
  await audit(user, {
    projectId: id, entity: "MonthlyClosing", entityId: closing.id, action,
    data: { from, to, ...(stamp.v ?? {}), ...(action === "submit" ? { blockers: guard.blockers, overrideReason: guard.reason, note: submitNote } : {}), ...(reopenReason ? { reason: reopenReason } : {}) },
  });

  let snapshot: { id: string; version: number } | false | undefined;
  if (action === "submit") {
    // 상신본 스냅샷 — 이 시점의 상신 양식 엑셀(그 달까지)
    try {
      const { createClosingSnapshot } = await import("@/lib/snapshot-server");
      const snap = await createClosingSnapshot({ closingId: closing.id, projectId: id, ym, kind: "SUBMIT", userId: user.id });
      snapshot = { id: snap.id, version: snap.version };
    } catch (e) {
      console.error(`[closing submit ${id} ${ym}] 상신본 저장 실패`, e);
      snapshot = false;
      await audit(user, { projectId: id, entity: "ClosingSnapshot", entityId: closing.id, action: "snapshot-fail", data: { kind: "SUBMIT", error: (e as Error).message?.slice(0, 300) } });
    }
    // 재무 승인 담당에게 앱 내 알림 (실패해도 상신은 그대로 — notify가 삼킨다)
    await notify(closingNotifications({ action, project: { id, name: project.name }, ym, actorId: user.id, actorName: user.name, pmIds: [], hqIds: await hqUserIds() }));
  }
  return NextResponse.json(snapshot === undefined ? closing : { ...closing, snapshot });
});
