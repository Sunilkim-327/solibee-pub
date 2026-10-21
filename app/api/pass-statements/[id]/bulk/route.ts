import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, readJson, route } from "@/lib/access";
import { d1Changes, prisma } from "@/lib/db";
import { chunkIds } from "@/lib/chunk";
import { guardedPassLineUpdate } from "@/lib/guarded-sql";
import { BULK_ACTIONS, bulkDecisions, canAssumeExternal, clearTargets, decisionSourceOf, externalAssignment, type BulkAction } from "@/lib/pass-statement";
import { assertPassUnlocked, findStatement, passItems } from "@/lib/pass-statement-server";

type Params = { id: string };

/**
 * 일괄 처리 — 이 프로젝트 PM
 * - { action: "accept-claims"|"all-overtime"|"rest-deduct", lineIds?, itemId?(all-overtime: 회사 부담 항목) } 결정 (OPEN)
 * - { action: "clear", lineIds } 고른 줄의 결정을 지워 미결정으로 (OPEN) — 일괄 결정·✓의 '되돌리기'
 * - { action: "assume-external", lineIds } 선택한 외부인 건을 내(PM) 사용분으로 (OPEN, PM만)
 * - { action: "collect", lineIds, collected, note? } 외부인 수금 기록 (확정 후에도 가능)
 * 응답: { changed: 바뀐 줄 수, changedIds?: 바뀐 줄 id (결정·지우기 — 되돌리기 대상) }
 */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const st = await findStatement(id);
  const { user } = await projectWriter(st.projectId, ["MANAGER"]);
  const body = await readJson<{ action?: string; lineIds?: unknown; collected?: unknown; note?: unknown; itemId?: unknown }>(req);
  const action = body.action ?? "";
  const ids = Array.isArray(body.lineIds) ? body.lineIds.filter((x): x is string => typeof x === "string").slice(0, 2000) : null;
  const now = new Date();

  if (action === "collect") {
    if (!ids?.length || typeof body.collected !== "boolean") throw new HttpError(400, "수금 기록할 내역을 고르세요.");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : undefined;
    const res = await prisma.passStatementLine.updateMany({
      where: { statementId: id, id: { in: ids }, onBehalfName: { not: null } },
      data: { collectedAt: body.collected ? now : null, ...(note !== undefined ? { collectNote: note } : {}) },
    });
    await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: "bulk:collect", data: { lineIds: ids, collected: body.collected, note } });
    return NextResponse.json({ changed: res.count });
  }

  // 수금 기록 외의 일괄 처리는 마감(CLOSED 이상)된 달에서 불가
  await assertPassUnlocked(st.projectId, st.yearMonth);
  if (st.status !== "OPEN") throw new HttpError(409, "확정된 내역입니다. 바꾸려면 먼저 확정을 취소하세요.");

  if (action === "assume-external") {
    if (!canAssumeExternal(user)) throw new HttpError(403, "외부인 사용분은 이 프로젝트 PM만 본인 사용분으로 처리할 수 있습니다.");
    if (!ids?.length) throw new HttpError(400, "처리할 내역을 고르세요.");
    const lines = await prisma.passStatementLine.findMany({ where: { statementId: id, id: { in: ids } }, select: { id: true, holderName: true, onBehalfName: true } });
    // 같은 외부인(이름)끼리 저장 값이 같으므로 묶어서 한 번에
    const groups = new Map<string, { data: ReturnType<typeof externalAssignment>; ids: string[] }>();
    for (const l of lines) {
      const data = externalAssignment(l, user.id);
      const g = groups.get(data.onBehalfName) ?? { data, ids: [] };
      g.ids.push(l.id);
      groups.set(data.onBehalfName, g);
    }
    // D1 바인딩 한도(100) — 묶음마다 id를 나눠서
    await prisma.$transaction([...groups.values()].flatMap((g) => chunkIds(g.ids).map((chunk) => prisma.passStatementLine.updateMany({
      where: { id: { in: chunk }, statementId: id },
      data: { ...g.data, decidedBy: user.id, decidedAt: now },
    }))));
    await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: "bulk:assume-external", data: { lineIds: lines.map((l) => l.id), names: [...new Set(lines.map((l) => l.holderName))] } });
    return NextResponse.json({ changed: lines.length });
  }

  if (action === "clear") {
    if (!ids?.length) throw new HttpError(400, "결정을 지울 내역을 고르세요.");
    const lines = await prisma.passStatementLine.findMany({ where: { statementId: id, id: { in: ids } }, select: { id: true, decision: true, memberClaim: true } });
    const { keepItem, dropItem } = clearTargets(lines, ids);
    const cleared = { decision: null, decisionSource: null, decidedBy: null, decidedAt: null };
    // 팀원이 회사 부담을 요청한 줄은 요청 항목을 남긴다 (✓ 해제와 같은 값, PATCH decision:null)
    const groups = [{ ids: keepItem.map((l) => l.id), data: cleared }, { ids: dropItem.map((l) => l.id), data: { ...cleared, usageItemId: null } }].filter((g) => g.ids.length);
    // D1 바인딩 한도(100) — 묶음마다 id를 나눠서. 운영(D1)은 '내역이 아직 확정 전일 때만' 조건을 문장 안에 넣는다 (확정과 겹치면 0행)
    const parts = groups.flatMap((g) => chunkIds(g.ids).map((chunk) => ({ chunk, data: g.data })));
    const counts = process.env.DB_TARGET === "d1"
      ? (await d1Changes(parts.map((p) => guardedPassLineUpdate(p.chunk, p.data, true))))!
      : (await prisma.$transaction(parts.map((p) => prisma.passStatementLine.updateMany({ where: { id: { in: p.chunk }, statementId: id, statement: { status: "OPEN" } }, data: p.data })))).map((r) => r.count);
    const changed = counts.reduce((a, n) => a + n, 0);
    const changedIds = [...keepItem, ...dropItem].map((l) => l.id);
    if (changedIds.length && !changed) throw new HttpError(409, "출입증 내역이 방금 확정되었습니다. 새로고침 후 확인하세요.");
    await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: "bulk:clear", data: { count: changed, lineIds: ids } });
    return NextResponse.json({ changed, changedIds: changed === changedIds.length ? changedIds : changedIds.slice(0, changed) });
  }

  if (!BULK_ACTIONS.includes(action as BulkAction)) throw new HttpError(400, "알 수 없는 작업입니다.");
  const lines = await prisma.passStatementLine.findMany({ where: { statementId: id }, select: { id: true, userId: true, memberClaim: true, decision: true, usageItemId: true } });
  const changes = bulkDecisions(lines, action as BulkAction, ids);
  const source = decisionSourceOf(user);
  // 회사 부담 항목: 지정한 항목 → (팀원 요청 인정이면) 팀원이 고른 항목 → 항목이 하나뿐이면 그 항목
  const items = await passItems(st.projectId);
  const itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : null;
  if (itemId && !items.some((i) => i.id === itemId)) throw new HttpError(400, "이 프로젝트에서 고를 수 없는 항목입니다.");
  const only = items.length === 1 ? items[0].id : null;
  const prev = new Map(lines.map((l) => [l.id, l.usageItemId]));
  const itemFor = (lineId: string, decision: string) => (decision === "OVERTIME" ? itemId ?? prev.get(lineId) ?? only : null);
  const groups = new Map<string, { decision: "OVERTIME" | "DEDUCT"; usageItemId: string | null; ids: string[] }>();
  for (const c of changes) {
    const usageItemId = itemFor(c.id, c.decision);
    const k = `${c.decision}|${usageItemId ?? ""}`;
    const g = groups.get(k) ?? { decision: c.decision, usageItemId, ids: [] };
    g.ids.push(c.id);
    groups.set(k, g);
  }
  await prisma.$transaction(
    // D1 바인딩 한도(100) — 묶음마다 id를 나눠서
    [...groups.values()].flatMap((g) => chunkIds(g.ids).map((chunk) =>
      prisma.passStatementLine.updateMany({
        where: { id: { in: chunk }, statementId: id },
        data: { decision: g.decision, usageItemId: g.usageItemId, decisionSource: source, decidedBy: user.id, decidedAt: now },
      }),
    )),
  );
  await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: `bulk:${action}`, data: { count: changes.length, lineIds: ids, itemId } });
  // changedIds: 되돌리기(clear) 대상
  return NextResponse.json({ changed: changes.length, changedIds: changes.map((c) => c.id) });
});
