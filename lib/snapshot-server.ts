// 상신본·승인본 스냅샷 — 서버 (설계 검토(2026-10-14) P0-2 ①②). 순수 규칙은 lib/snapshot.ts
// 상신·승인 직후 그 시점의 상신 양식 엑셀(그 달까지 출력 범위)을 만들어 저장하고, 승인·상신된 달의 내려받기는 저장본을 그대로 준다.
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { loadWorkbookData, renderWorkbook, workbookFilenameOf } from "./export";
import { nextSnapshotVersion, type SnapshotKind, type SnapshotMeta } from "./snapshot";

/** 파일 내용 없이 읽는 칸 (목록·화면용 — file은 수백 KB라 목록 조회에서 읽지 않는다) */
export const SNAPSHOT_META_SELECT = { id: true, closingId: true, kind: true, version: true, fileName: true, sha256: true, size: true, createdAt: true, createdBy: true } as const;

export const sha256Hex = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");

/** 스냅샷 요약 JSON (summary 칸) — 화면·감사에서 파일을 열지 않고 볼 값 */
export type SnapshotSummary = {
  ym: string; total: number; byPayer: { id: string; name: string; amount: number }[]; sharedCard: number; hq: number;
  pass: { confirmed: boolean | null; company: number }; budget: { planned: number; spent: number }; groupIds: string[];
};

/**
 * 상신(SUBMIT)·승인(APPROVE) 스냅샷 생성 — 전환이 끝난 뒤 같은 요청에서 호출한다.
 * 엑셀은 현재 데이터로 ym까지 출력(loadWorkbookData + renderWorkbook — 다운로드와 같은 함수), 상태는 전환 뒤 상태로 파일 이름에 넣는다.
 */
export async function createClosingSnapshot(x: { closingId: string; projectId: string; ym: string; kind: SnapshotKind; userId: string }): Promise<SnapshotMeta> {
  const [data, existing, statement] = await Promise.all([
    loadWorkbookData(x.projectId, x.ym),
    prisma.closingSnapshot.findMany({ where: { closingId: x.closingId }, select: { kind: true, version: true } }),
    prisma.passStatement.findUnique({ where: { projectId_yearMonth: { projectId: x.projectId, yearMonth: x.ym } }, select: { status: true } }),
  ]);
  const buffer = await renderWorkbook(data);
  const st = data.monthData[x.ym].st;
  const nameOf = new Map(data.allPayers.map((p) => [p.id, p.name]));
  const summary: SnapshotSummary = {
    ym: x.ym,
    total: st.total,
    byPayer: Object.entries(st.byPayer).map(([id, amount]) => ({ id, name: nameOf.get(id) ?? id, amount })),
    sharedCard: st.sharedCard,
    hq: st.hq,
    pass: { confirmed: statement ? statement.status === "CONFIRMED" : null, company: st.pass },
    budget: { planned: data.parts.reduce((a, p) => a + p.dash.totals.planned, 0), spent: data.parts.reduce((a, p) => a + p.dash.totals.spent, 0) },
    groupIds: data.group.ids,
  };
  const row = await prisma.closingSnapshot.create({
    data: {
      closingId: x.closingId,
      kind: x.kind,
      version: nextSnapshotVersion(existing, x.kind),
      // base64 글자로 저장 (prisma/schema.prisma ClosingSnapshot 주석)
      file: Buffer.from(buffer).toString("base64"),
      fileName: workbookFilenameOf(data),
      sha256: sha256Hex(buffer),
      size: buffer.byteLength,
      summary: JSON.stringify(summary),
      createdBy: x.userId,
    },
    select: SNAPSHOT_META_SELECT,
  });
  return row;
}

/** 마감의 스냅샷 목록 (파일 없이) — 최신이 먼저 */
export async function listSnapshots(closingId: string): Promise<SnapshotMeta[]> {
  return prisma.closingSnapshot.findMany({ where: { closingId }, select: SNAPSHOT_META_SELECT, orderBy: [{ createdAt: "desc" }, { version: "desc" }] });
}

/** 저장된 파일 (base64 → 바이트) + 메타 */
export async function readSnapshotFile(id: string): Promise<(SnapshotMeta & { buffer: Buffer }) | null> {
  const row = await prisma.closingSnapshot.findUnique({ where: { id }, select: { ...SNAPSHOT_META_SELECT, file: true } });
  if (!row) return null;
  const { file, ...meta } = row;
  return { ...meta, buffer: Buffer.from(file, "base64") };
}

/** 어떤 kind의 최신 스냅샷 (파일 포함) — 없으면 null */
export async function latestSnapshotFile(closingId: string, kind: SnapshotKind) {
  const row = await prisma.closingSnapshot.findFirst({ where: { closingId, kind }, select: { ...SNAPSHOT_META_SELECT, file: true }, orderBy: { version: "desc" } });
  if (!row) return null;
  const { file, ...meta } = row;
  return { ...meta, buffer: Buffer.from(file, "base64") };
}
