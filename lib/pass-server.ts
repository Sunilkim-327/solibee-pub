// 출입증 사용 내역(이전 방식, 조회 전용) — 서버 공통 목록 조회
import "server-only";
import type { SessionUser } from "./access";
import { prisma } from "./db";
import { formatDate } from "./format";
import { canSeeAllPass } from "./pass-statement";

import type { PassUsageRow } from "./dto";
export type { PassUsageRow };

/** 목록: 팀원·상위 PM/조직장 조회(view)는 본인 건, 이 프로젝트 PM·재무 승인·시스템 관리자는 전체. 이전 내역은 수정 불가 */
export async function listPassUsages(user: SessionUser, projectId: string, yearMonth: string) {
  const seesAll = canSeeAllPass(user);
  const rows = await prisma.clientPassUsage.findMany({
    where: { projectId, yearMonth, ...(seesAll ? {} : { userId: user.id }) },
    include: { user: { select: { name: true } }, item: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(
    (r): PassUsageRow => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      date: formatDate(r.date),
      itemId: r.itemId,
      itemName: r.item.name,
      amount: r.amount,
      placeType: r.placeType,
      place: r.place,
      headcount: r.headcount,
      memo: r.memo,
      editable: false,
    }),
  );
}
