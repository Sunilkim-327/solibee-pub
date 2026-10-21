import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, audit, projectWriter, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { parseDateOnly } from "@/lib/format";
import { chunkIds } from "@/lib/chunk";
import { syncPmRoles } from "@/lib/pm";

type Params = { id: string };

export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  await assertProjectRole(await apiUser(), id);
  const members = await prisma.projectMember.findMany({
    where: { projectId: id },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  return NextResponse.json(members);
});

/** leftAt: 철수일 "YYYY-MM-DD" (이전 팀원), 비우면 현재 팀원 */
type MemberInput = { userId: string; isPayer: boolean; leftAt?: string | null };

/**
 * 팀원 저장 — 역할 분담
 * - 재무 승인·시스템 관리자: PM 지정만 { pmIds } — 새 PM은 팀원으로 추가, 해제된 PM은 팀원으로 남는다(제외는 PM이).
 *   PM으로 지정된 팀원에게는 PM 권한이 자동 부여된다.
 * - 이 프로젝트의 PM: 팀원 추가·제외·이전 팀원 처리와 결제자 여부만 { members } (PM 지정은 그대로)
 *   지출·출입증 내역이 있는 사람은 제외(삭제)할 수 없다 — 철수일을 넣어 이전 팀원으로 남긴다.
 */
export const PUT = route<Params>(async (req, { params }) => {
  const { id } = await params;
  // 시스템 관리자는 기준 정보에서 PM 지정(pmIds)만 — 프로젝트 데이터 조회 전용이어도 허용
  const { user } = await projectWriter(id, ["HQ", "ADMIN", "MANAGER"], { allowAdmin: true });
  const body = await readJson<{ members?: MemberInput[]; pmIds?: string[] }>(req);
  const assignsPm = user.role === "HQ" || user.role === "ADMIN";
  const before = await prisma.projectMember.findMany({ where: { projectId: id } });

  let data: { projectId: string; userId: string; isPayer: boolean; isPm: boolean; leftAt: Date | null }[];
  if (assignsPm) {
    if (!Array.isArray(body.pmIds) || body.pmIds.some((x) => typeof x !== "string")) throw new HttpError(400, "PM 목록이 필요합니다.");
    const pmIds = [...new Set(body.pmIds)];
    if (pmIds.length > 20) throw new HttpError(400, "PM은 20명 이하로 지정하세요.");
    const pms = await prisma.user.findMany({ where: { id: { in: pmIds } }, select: { id: true, role: true, active: true } });
    if (pms.length !== pmIds.length || pms.some((u) => !u.active)) throw new HttpError(400, "찾을 수 없거나 비활성인 사용자가 있습니다.");
    if (pms.some((u) => u.role === "HQ" || u.role === "ADMIN")) throw new HttpError(400, "재무 승인·시스템 관리자 계정은 PM으로 지정할 수 없습니다.");
    const pmSet = new Set(pmIds);
    data = [
      // PM으로 지정되면 현재 팀원으로 (철수일 해제)
      ...before.map((m) => ({ projectId: id, userId: m.userId, isPayer: m.isPayer, isPm: pmSet.has(m.userId), leftAt: pmSet.has(m.userId) ? null : m.leftAt })),
      ...pmIds.filter((uid) => !before.some((m) => m.userId === uid)).map((userId) => ({ projectId: id, userId, isPayer: true, isPm: true, leftAt: null })),
    ];
  } else {
    if (!Array.isArray(body.members)) throw new HttpError(400, "팀원 목록이 필요합니다.");
    if (body.members.length > 500) throw new HttpError(400, "팀원은 500명 이하로 지정하세요.");
    const members = [...new Map(body.members.filter((m) => m && typeof m.userId === "string").map((m) => [m.userId, m])).values()];
    const wasPm = new Set(before.filter((m) => m.isPm).map((m) => m.userId));
    if ([...wasPm].some((uid) => !members.some((m) => m.userId === uid))) throw new HttpError(403, "PM은 팀원에서 뺄 수 없습니다. PM 변경은 재무 승인 담당에게 요청하세요.");
    // 변경계약 과업 담당 PM은 팀원에서 뺄 수 없다 (과업 담당을 먼저 바꿈)
    const removed = before.filter((m) => !members.some((x) => x.userId === m.userId)).map((m) => m.userId);
    if (removed.length) {
      const managed = await prisma.contractChange.findFirst({
        where: { projectId: id, managerId: { in: removed } },
        select: { seq: true, title: true, manager: { select: { name: true } } },
        orderBy: { seq: "asc" },
      });
      if (managed) throw new HttpError(400, `${managed.manager?.name ?? "담당자"}은(는) 변경 ${managed.seq}차 과업(${managed.title})의 담당 PM이라 뺄 수 없습니다. 재무 승인 담당에게 담당 변경을 요청하세요.`);
      // 기록이 참조하면 삭제 대신 철수일 — 지출 결제자(Expense.payerId)·출입증 내역 줄(PassStatementLine.userId, 외부인 대신 처리한 줄 포함)·
      // 이전 방식 출입증(ClientPassUsage.userId)이 있는 사람은 삭제하지 않고 이전 팀원으로 남긴다
      const [paid, passed, used] = await Promise.all([
        prisma.expense.findFirst({ where: { projectId: id, payerId: { in: removed } }, select: { payer: { select: { name: true } } } }),
        prisma.passStatementLine.findFirst({ where: { statement: { projectId: id }, userId: { in: removed } }, select: { user: { select: { name: true } } } }),
        prisma.clientPassUsage.findFirst({ where: { projectId: id, userId: { in: removed } }, select: { user: { select: { name: true } } } }),
      ]);
      const who = paid?.payer.name ?? passed?.user?.name ?? used?.user.name;
      if (who) throw new HttpError(400, `${who}님은 이 프로젝트에 지출·출입증 내역이 있어 삭제할 수 없습니다. 대신 [이전 팀원으로] 처리하세요.`);
    }
    const leftOf = new Map<string, Date | null>();
    for (const m of members) {
      if (m.leftAt == null || m.leftAt === "") { leftOf.set(m.userId, null); continue; }
      if (wasPm.has(m.userId)) throw new HttpError(400, "PM은 이전 팀원으로 처리할 수 없습니다. PM 변경은 재무 승인 담당에게 요청하세요.");
      const d = parseDateOnly(m.leftAt);
      if (!d) throw new HttpError(400, "철수일을 YYYY-MM-DD 형식으로 입력하세요.");
      leftOf.set(m.userId, d);
    }
    const leaving = [...leftOf].filter(([, d]) => d).map(([uid]) => uid);
    if (leaving.length) {
      const managed = await prisma.contractChange.findFirst({ where: { projectId: id, managerId: { in: leaving } }, select: { seq: true, manager: { select: { name: true } } } });
      if (managed) throw new HttpError(400, `${managed.manager?.name ?? "담당자"}은(는) 변경 ${managed.seq}차 과업의 담당 PM이라 이전 팀원으로 처리할 수 없습니다. 재무 승인 담당에게 담당 변경을 요청하세요.`);
    }
    const known = new Set(before.map((m) => m.userId));
    const added = members.filter((m) => !known.has(m.userId)).map((m) => m.userId);
    let addable = 0;
    for (const part of chunkIds(added)) addable += await prisma.user.count({ where: { id: { in: part }, active: true, role: { notIn: ["HQ", "ADMIN"] } } });
    if (addable !== added.length) {
      throw new HttpError(400, "찾을 수 없거나 추가할 수 없는 사용자가 있습니다.");
    }
    data = members.map((m) => ({ projectId: id, userId: m.userId, isPayer: !!m.isPayer, isPm: wasPm.has(m.userId), leftAt: leftOf.get(m.userId) ?? null }));
  }

  const changes = await prisma.$transaction(async (tx) => {
    // 남는 사람은 고쳐 쓰고(없으면 추가) 빠진 사람만 지운다 — 운영 DB(D1)는 트랜잭션이 없어 중간에 실패해도
    // 팀원 목록이 통째로 비지 않도록 (전부 지우고 다시 만들지 않음)
    // 바뀐 사람만 쓴다 (D1은 요청당 쿼리 50개 제한)
    const same = (d: (typeof data)[number]) => before.some((b) => b.userId === d.userId && b.isPayer === d.isPayer && b.isPm === d.isPm && (b.leftAt?.getTime() ?? null) === (d.leftAt?.getTime() ?? null));
    for (const d of data.filter((x) => !same(x))) {
      const { projectId, userId, ...rest } = d;
      await tx.projectMember.upsert({ where: { projectId_userId: { projectId, userId } }, create: d, update: rest });
    }
    const keep = data.map((d) => d.userId);
    await tx.projectMember.deleteMany({ where: { projectId: id, userId: { notIn: keep } } });
    // PM 지정·해제에 따라 권한 부여·회수
    return syncPmRoles(tx, [...before.map((m) => m.userId), ...data.map((d) => d.userId)]);
  });
  await audit(user, { projectId: id, entity: "ProjectMember", entityId: id, action: "replace", data: { members: data, roleChanges: changes } });
  return NextResponse.json({ ok: true, roleChanges: changes });
});
