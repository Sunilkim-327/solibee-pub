import { HttpError, apiUser, assertProjectRole, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { xlsxDownload } from "@/lib/export";
import { canSeeAllRows } from "@/lib/rules";
import { readSnapshotFile } from "@/lib/snapshot-server";

type Params = { id: string; sid: string };

/** 상신본·승인본 스냅샷 파일 내려받기 — 권한은 엑셀 다운로드와 같다 (PM·재무 승인·시스템 관리자, 조회 권한 제외). 감사 기록 Export entityId = 스냅샷 id */
export const GET = route<Params>(async (_req, { params }) => {
  const { id, sid } = await params;
  const me = await apiUser();
  const closing = await prisma.monthlyClosing.findUnique({ where: { id }, select: { projectId: true } });
  if (!closing) throw new HttpError(404, "마감 내역을 찾을 수 없습니다.");
  const { user } = await assertProjectRole(me, closing.projectId, ["MANAGER", "HQ", "ADMIN"]);
  if (!canSeeAllRows(user)) throw new HttpError(403, "조회 권한으로는 엑셀을 내려받을 수 없습니다.");
  const snap = await readSnapshotFile(sid);
  if (!snap || snap.closingId !== id) throw new HttpError(404, "스냅샷을 찾을 수 없습니다.");
  return xlsxDownload(user, {
    projectId: closing.projectId, entityId: snap.id, filename: snap.fileName, buffer: snap.buffer,
    data: { snapshotId: snap.id, sha256: snap.sha256, kind: snap.kind, version: snap.version },
    headers: { "X-Snapshot": `${snap.kind.toLowerCase()}/v${snap.version}` },
  });
});
