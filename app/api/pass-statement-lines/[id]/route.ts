import { NextResponse } from "next/server";
import { HttpError, assertInputOpen, audit, projectWriter, readJson, route } from "@/lib/access";
import { d1Changes, prisma } from "@/lib/db";
import { guardedPassLineUpdate } from "@/lib/guarded-sql";

/** 목록을 n개씩 (쿼리당 값 100개 제한) */
const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
import { decisionSourceOf, externalAssignment, holderMapKey, linePatchProblem, type LinePatch } from "@/lib/pass-statement";
import { applyOvertime, assertPassUnlocked, findLine, loadLineRow, passDisplayItems, passItems, passMembers } from "@/lib/pass-statement-server";

type Params = { id: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);

/**
 * 출입증 내역 줄 수정
 * - 팀원(본인 줄, OPEN): { memberClaim: "OVERTIME"|null, usageItemId?(회사 부담 요청 항목), memberNote } — 표시 없음(null) = 본인 부담(기본값). 옛 값 "PERSONAL"은 더 받지 않는다(403 "표시 값이 올바르지 않습니다")
 * - PM·재무 승인·시스템 관리자(OPEN): { decision: "OVERTIME"|"DEDUCT"|null, usageItemId?(회사 부담 항목), userId } — 팀원 지정 시 카드번호(없으면 이름) 매핑을 기억하고 같은 사람의 미확인 줄에도 적용
 * - 이 프로젝트 PM(OPEN): { external: true, collectFrom? } 외부인 사용 → 내 사용분(본인 부담), { external: false } 되돌림
 * - PM·재무 승인·시스템 관리자(확정 후에도): { collected: boolean, collectNote, collectFrom } 외부인 수금 기록
 */
export const PATCH = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const line = await findLine(id);
  const { project, user } = await projectWriter(line.statement.projectId);
  const patch = await readJson<LinePatch>(req);
  // 팀원 표시(회사 부담·본인 부담 요청)는 지출 입력과 같은 마감 기준
  if (patch.memberClaim !== undefined || patch.memberNote !== undefined) assertInputOpen(project, user);
  const problem = linePatchProblem(user, line, line.statement.status, patch);
  if (problem) throw new HttpError(403, problem);
  const projectId = line.statement.projectId;
  // 외부인 수금 기록(금액에 영향 없음)만 빼고, 마감(CLOSED 이상)된 달은 바꿀 수 없다
  const collectOnly = Object.keys(patch).every((k) => k === "collectFrom" || k === "collectNote" || k === "collected");
  const needsItems = patch.usageItemId !== undefined || patch.decision === "OVERTIME" || patch.memberClaim === "OVERTIME";
  const userId = patch.userId === undefined ? undefined : patch.userId === null || patch.userId === "" ? null : String(patch.userId);
  // 마감 상태·고를 수 있는 항목·이 달 팀원·표시 열 목록은 서로 무관 — 한 번에 읽는다 (응답 줄 변환에 쓰는 표시 열도 여기서)
  const [, items, members, displayItems] = await Promise.all([
    collectOnly ? null : assertPassUnlocked(projectId, line.statement.yearMonth),
    needsItems ? passItems(projectId) : null,
    userId ? passMembers(projectId, line.statement.yearMonth) : null,
    passDisplayItems(projectId),
  ]);

  // 회사 부담 항목: 이 프로젝트에서 고를 수 있는 항목만 (하나뿐이면 자동)
  let itemId: string | null | undefined;
  if (items) {
    const want = patch.usageItemId === undefined ? line.usageItemId : (patch.usageItemId as string | null) || null;
    if (want && !items.some((i) => i.id === want)) throw new HttpError(400, "이 프로젝트에서 고를 수 없는 항목입니다.");
    itemId = want ?? (items.length === 1 ? items[0].id : null);
  }

  const data: Record<string, unknown> = {};
  if (patch.memberClaim !== undefined) {
    data.memberClaim = patch.memberClaim;
    // 팀원 요청 항목은 PM이 아직 정하지 않았을 때만 바꾼다
    if (!line.decision) data.usageItemId = patch.memberClaim === "OVERTIME" ? itemId ?? null : null;
  }
  if (patch.memberNote !== undefined) data.memberNote = text(patch.memberNote);
  if (patch.decision !== undefined) {
    data.decision = patch.decision;
    // 회사 부담이면 항목, 본인 부담이면 없음, 미정으로 되돌리면 팀원 요청 항목 유지
    data.usageItemId = patch.decision === "OVERTIME" ? itemId ?? null : patch.decision === null && line.memberClaim === "OVERTIME" ? line.usageItemId : null;
    data.decisionSource = patch.decision ? decisionSourceOf(user) : null;
    data.decidedBy = patch.decision ? user.id : null;
    data.decidedAt = patch.decision ? new Date() : null;
  }
  if (patch.usageItemId !== undefined && patch.decision === undefined && patch.memberClaim === undefined) data.usageItemId = itemId ?? null;
  if (patch.external === true) {
    Object.assign(data, externalAssignment(line, user.id, text(patch.collectFrom)), { decidedBy: user.id, decidedAt: new Date() });
  } else if (patch.external === false) {
    Object.assign(data, { userId: null, onBehalfName: null, collectFrom: null, collectedAt: null, collectNote: null, decision: null, usageItemId: null, decisionSource: null, decidedBy: null, decidedAt: null });
  }
  if (patch.collectFrom !== undefined && patch.external !== true) data.collectFrom = text(patch.collectFrom) ?? line.onBehalfName;
  if (patch.collectNote !== undefined) data.collectNote = text(patch.collectNote);
  if (patch.collected !== undefined) data.collectedAt = patch.collected ? new Date() : null;

  if (userId !== undefined) {
    if (userId) {
      // 이 달 출입증 내역 기간에 근무한 팀원 (이전 팀원 포함)
      const member = (members ?? []).some((m) => m.userId === userId);
      if (!member) throw new HttpError(400, "이 달에 근무한 프로젝트 팀원만 지정할 수 있습니다. 팀원이 아니면 '외부인 사용'으로 처리하세요.");
    }
    data.userId = userId;
    // 다른 팀원으로 바뀌면 이전 팀원의 표시는 지운다
    if (line.userId && line.userId !== userId) { data.memberClaim = null; data.memberNote = null; }
  }

  // 운영(D1): 확정 전 출입증 내역에서만 바뀌어야 하는 수정(결정·요청·팀원 지정)은 '출입증 내역이 확정 전일 때만' 한 문장으로
  // (수금 기록처럼 확정 후에도 되는 것만 바꿀 때는 조건 없음)
  const d1 = process.env.DB_TARGET === "d1";
  const needsOpen = !collectOnly;
  const alsoMapped = await prisma.$transaction(async (tx) => {
    // 읽은 뒤 출입증 내역이 확정·확정 취소됐으면 그 상태로 다시 확인
    const fresh = await tx.passStatement.findUniqueOrThrow({ where: { id: line.statementId }, select: { status: true } });
    if (fresh.status !== line.statement.status) {
      const again = linePatchProblem(user, line, fresh.status, patch);
      if (again) throw new HttpError(409, again);
    }
    if (d1) {
      const [n] = (await d1Changes([guardedPassLineUpdate([id], data, needsOpen)]))!;
      if (!n) throw new HttpError(409, "출입증 내역이 방금 확정되었습니다. 새로고침 후 확인하세요.");
    }
    let mapped = 0;
    if (userId !== undefined) {
      const key = holderMapKey(line);
      if (userId) {
        await tx.passHolder.upsert({
          where: { projectId_holderKey: { projectId, holderKey: key } },
          create: { projectId, holderKey: key, userId },
          update: { userId },
        });
        // 같은 출입증 내역에서 같은 카드번호(없으면 이름)의 미확인 줄도 함께 지정
        const same = await tx.passStatementLine.findMany({
          where: { statementId: line.statementId, userId: null, onBehalfName: null, id: { not: id } },
          select: { id: true, holderName: true, cardNo: true },
        });
        const ids = same.filter((s) => holderMapKey(s) === key).map((s) => s.id);
        if (ids.length) {
          mapped = d1
            ? (await d1Changes(chunk(ids, 90).map((part) => guardedPassLineUpdate(part, { userId }, true))))!.reduce((a, n) => a + n, 0)
            : (await tx.passStatementLine.updateMany({ where: { id: { in: ids } }, data: { userId } })).count;
        }
      } else {
        await tx.passHolder.deleteMany({ where: { projectId, holderKey: key } });
      }
    }
    if (!d1) await tx.passStatementLine.update({ where: { id }, data });
    return mapped;
  });
  const autoDecided = patch.userId !== undefined ? await applyOvertime(line.statementId) : 0;
  // 바뀐 줄 (팀원·항목 이름 포함) — 직접 SQL 한 번
  const updated = await loadLineRow(id, displayItems);
  await audit(user, {
    projectId, entity: "PassStatementLine", entityId: id,
    action: patch.external === true ? "assume-external" : patch.external === false ? "undo-external" : "update",
    data: {
      before: { userId: line.userId, memberClaim: line.memberClaim, memberNote: line.memberNote, decision: line.decision, usageItemId: line.usageItemId, onBehalfName: line.onBehalfName, collectedAt: line.collectedAt },
      after: data, alsoMapped, autoDecided,
    },
  });
  return NextResponse.json({ line: updated, alsoMapped, autoDecided });
});
