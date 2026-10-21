import { NextResponse } from "next/server";
import { HttpError, SMALL_JSON_MAX_BYTES, audit, projectWriter, readJson, route } from "@/lib/access";
import { isLocked, unlockHint } from "@/lib/closing";
import { prisma } from "@/lib/db";
import { isYearMonth, seoulToday, seoulTodayDate } from "@/lib/format";
import { isCurrentMember } from "@/lib/membership";
import { notify } from "@/lib/notification-server";
import { remindNotifications } from "@/lib/notifications";
import { isUnexplained } from "@/lib/policy";
import { strArray } from "@/lib/validate";

type Params = { id: string };

/**
 * 입력·소명 요청 알림 (PM): { kind: "noinput" | "unexplained", ym, userIds } → { created, skipped }
 * 같은 사람에게는 하루 한 번만 (오늘 이미 보낸 사람은 skipped). userIds는 이 프로젝트의 현재 팀원으로 제한
 */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { project, user } = await projectWriter(id, ["MANAGER"]);
  const body = await readJson<{ kind?: unknown; ym?: unknown; userIds?: unknown }>(req, SMALL_JSON_MAX_BYTES);
  const kind = body.kind === "noinput" || body.kind === "unexplained" ? body.kind : null;
  if (!kind) throw new HttpError(400, "요청 종류(미입력·소명)를 지정하세요.");
  const ym = body.ym;
  if (!isYearMonth(ym)) throw new HttpError(400, "월 형식이 올바르지 않습니다.");
  const requested = strArray(body.userIds, "받는 사람", 200);
  if (!requested.length) throw new HttpError(400, "받는 사람을 지정하세요.");
  // 마감 이상인 달은 입력·소명을 바꿀 수 없으니 요청도 보내지 않는다 (화면은 작성중 달에만 버튼을 보여 준다)
  const closing = await prisma.monthlyClosing.findUnique({ where: { projectId_yearMonth: { projectId: id, yearMonth: ym } }, select: { status: true } });
  if (isLocked(closing?.status)) throw new HttpError(409, `${closing?.status === "APPROVED" ? "승인된" : closing?.status === "SUBMITTED" ? "상신된" : "마감된"} 월에는 입력·소명 요청을 보낼 수 없습니다. ${unlockHint(closing?.status)}`);

  // 이 프로젝트의 현재 팀원(철수 전, 활성)만 — 본인은 뺀다
  const today = seoulTodayDate();
  const members = await prisma.projectMember.findMany({
    where: { projectId: id, userId: { in: requested } },
    select: { userId: true, leftAt: true, user: { select: { active: true } } },
  });
  const userIds = members.filter((m) => m.user.active && isCurrentMember(m, today) && m.userId !== user.id).map((m) => m.userId);
  if (!userIds.length) throw new HttpError(400, "받는 사람 중 이 프로젝트의 현재 팀원이 없습니다. 팀원을 다시 고르세요.");

  // 소명 요청: 사람별 소명 없는 규정 점검 건수 (제목에 표시)
  let counts: Record<string, number> | undefined;
  if (kind === "unexplained") {
    const rows = await prisma.expense.findMany({
      where: { projectId: id, yearMonth: ym, payerId: { in: userIds }, flags: { not: null } },
      select: { payerId: true, flags: true, justification: true },
    });
    counts = {};
    for (const e of rows) if (isUnexplained(e)) counts[e.payerId] = (counts[e.payerId] ?? 0) + 1;
  }
  const drafts = remindNotifications({ kind, project: { id, name: project.name }, ym, pmName: user.name, userIds, counts, today: seoulToday() });
  const result = await notify(drafts);
  await audit(user, { projectId: id, entity: "Reminder", entityId: `${id}:${ym}`, action: "remind", data: { kind, ym, userIds, created: result.created, skipped: result.skipped } });
  return NextResponse.json(result);
});
