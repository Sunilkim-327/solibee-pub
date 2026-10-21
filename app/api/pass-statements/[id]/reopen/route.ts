import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { assertPassUnlocked, findStatement } from "@/lib/pass-statement-server";

type Params = { id: string };

/**
 * 확정 취소 (이 프로젝트 PM·재무 승인): { reason } — 사유 필수 (이미 전달한 본인 부담(급여 공제) 엑셀이 무효가 되므로 기록).
 * 마감(CLOSED 이상)된 달은 불가 — 마감 해제(또는 재무 승인 반려·승인 취소) 뒤에 확정을 취소한다.
 * 줄은 손대지 않는다: 확정 때 빈 값이던 줄은 읽을 때만 본인 부담으로 채우므로(applyConfirmedDefaults) OPEN이 되면 자동으로 다시 미결정이 된다
 */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const st = await findStatement(id);
  const { user } = await projectWriter(st.projectId, ["MANAGER", "HQ"]);
  await assertPassUnlocked(st.projectId, st.yearMonth);
  if (st.status !== "CONFIRMED") throw new HttpError(409, "확정된 출입증 내역이 아닙니다.");
  const { reason } = await readJson<{ reason?: unknown }>(req);
  const why = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  if (!why) throw new HttpError(400, "확정 취소 사유를 입력하세요.");
  const res = await prisma.passStatement.updateMany({ where: { id, status: "CONFIRMED" }, data: { status: "OPEN", confirmedBy: null, confirmedAt: null } });
  if (res.count === 0) throw new HttpError(409, "확정된 출입증 내역이 아닙니다.");
  await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: "reopen", data: { ym: st.yearMonth, reason: why, confirmedBy: st.confirmedBy, confirmedAt: st.confirmedAt } });
  return NextResponse.json({ ok: true });
});
