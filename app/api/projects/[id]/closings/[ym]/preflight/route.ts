import { NextResponse } from "next/server";
import { HttpError, projectWriter, route } from "@/lib/access";
import { SUBMIT_NOTE_MAX, SUBMIT_REASON_MAX, SUBMIT_REASON_MIN, canOverrideBlockers } from "@/lib/closing";
import { loadSubmitGuard } from "@/lib/closing-guard-server";
import { isYearMonth } from "@/lib/format";
import { settleGroup } from "@/lib/settle-server";
import { settleWithParentMessage } from "@/lib/settle-group";

type Params = { id: string; ym: string };

/**
 * 상신 전 확인 (PM) — 미완료 항목(blockers)·체크리스트. 상신 버튼이 먼저 부르고, 미완료 항목이 있으면 사유를 받아 상신한다 (P0-1)
 * 응답: { blockers:[{code,message}], overridable(검증 불일치가 있으면 false), checks, summary:{ok,text}, reasonMin, reasonMax, noteMax }
 */
export const GET = route<Params>(async (_req, { params }) => {
  const { id, ym } = await params;
  if (!isYearMonth(ym)) throw new HttpError(400, "월 형식이 올바르지 않습니다.");
  const { project } = await projectWriter(id, ["MANAGER"]);
  const group = await settleGroup(id);
  if (group.parent) throw new HttpError(403, settleWithParentMessage((group.parentFor(ym) ?? group.parent).name));
  const g = await loadSubmitGuard(project, group, ym);
  return NextResponse.json({
    blockers: g.blockers, overridable: !g.blockers.length || canOverrideBlockers(g.blockers), checks: g.checks, summary: g.summary,
    reasonMin: SUBMIT_REASON_MIN, reasonMax: SUBMIT_REASON_MAX, noteMax: SUBMIT_NOTE_MAX,
  });
});
