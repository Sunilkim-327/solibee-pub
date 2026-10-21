import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, route } from "@/lib/access";
import { d1Changes, prisma } from "@/lib/db";
import { confirmStatementSql } from "@/lib/guarded-sql";
import { notify } from "@/lib/notification-server";
import { passNotifications } from "@/lib/notifications";
import { applyConfirmedDefaults, confirmProblem, deductionList, defaultDeductIds, summarizeStatement } from "@/lib/pass-statement";
import { assertPassUnlocked, findStatement, passItems } from "@/lib/pass-statement-server";

type Params = { id: string };

/**
 * 월 확정 — 상태만 CONFIRMED로 바꾼다 (팀원 미확인·확인 안 한 팀원 요청이 있으면 400). 이 프로젝트 PM만.
 * 따로 정하지 않은 줄은 **갱신하지 않는다**: 확정된 내역에서 decision이 비어 있으면 본인 부담(급여 공제)으로 읽는다
 * (lib/pass-statement applyConfirmedDefaults — 모든 읽기 경로가 거친다; 금액 계산은 원래부터 "정하지 않은 건 = 본인 부담").
 * 결정 근거: 예전에는 빈 줄을 전부 DEDUCT로 써 넣었는데, 2026-10 운영에서 이 대량 갱신이 D1 바인딩 한도로 실패해
 * 상태만 CONFIRMED가 되고 1~8월 1,525줄이 빈 값으로 남았다. 확정을 한 문장으로 줄이면 부분 반영이 생길 수 없다.
 */
export const POST = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const st = await findStatement(id);
  const { project, user } = await projectWriter(st.projectId, ["MANAGER"]);
  // 마감(CLOSED 이상)된 달은 확정도 불가 — 확정분이 그 달 정산(본사 집행)에 들어가므로 마감을 해제한 뒤 확정·재마감
  await assertPassUnlocked(st.projectId, st.yearMonth);
  if (st.status === "CONFIRMED") throw new HttpError(409, "이미 확정되었습니다.");
  const lines = await prisma.passStatementLine.findMany({ where: { statementId: id }, select: { id: true, userId: true, decision: true, amount: true, holderName: true, memberClaim: true } });
  const problem = confirmProblem(lines);
  if (problem) throw new HttpError(400, problem);
  const now = new Date();
  // 감사 기록용: 확정 시점에 비어 있던(기본 본인 부담으로 읽히는) 줄 수
  const defaultDeducted = defaultDeductIds(lines).length;
  // 운영(D1): 확정 한 문장 (OPEN일 때만) — 영향 0행이면 읽은 뒤 다른 사람이 먼저 확정한 것
  const changes = await d1Changes([confirmStatementSql(id, user.id, now)]);
  if (changes) {
    if (changes[0] === 0) throw new HttpError(409, "이미 확정되었습니다.");
  } else {
    // 로컬 SQLite: 같은 조건부 갱신
    const res = await prisma.passStatement.updateMany({ where: { id, status: "OPEN" }, data: { status: "CONFIRMED", confirmedBy: user.id, confirmedAt: now } });
    if (res.count === 0) throw new HttpError(409, "이미 확정되었습니다.");
  }
  const items = await passItems(st.projectId);
  const confirmed = applyConfirmedDefaults(lines, "CONFIRMED");
  const s = summarizeStatement(confirmed, items);
  await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: "confirm", data: { ym: st.yearMonth, total: s.total, overtime: s.overtime, deduct: s.deduct, defaultDeducted } });
  // 본인 부담(급여 공제) 금액이 있는 팀원에게 앱 내 알림 — 확정과 같은 기준(deductionList)으로 사람별 합계 (실패해도 확정은 그대로)
  const deductByUser = Object.fromEntries(deductionList(confirmed, items).map((p) => [p.userId, p.amount]));
  await notify(passNotifications({ event: "confirmed", project: { id: st.projectId, name: project.name }, ym: st.yearMonth, statementId: id, userIds: Object.keys(deductByUser), deductByUser }));
  return NextResponse.json({ ok: true });
});
