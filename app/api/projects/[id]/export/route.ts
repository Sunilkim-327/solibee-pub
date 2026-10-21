import { HttpError, apiUser, assertProjectRole, isHqLike, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { buildMonthSheet, buildWorkbook, xlsxDownload } from "@/lib/export";
import { isYearMonth } from "@/lib/format";
import { canSeeAllRows } from "@/lib/rules";
import { servedSnapshotKind } from "@/lib/snapshot";
import { latestSnapshotFile } from "@/lib/snapshot-server";
import { parseClosingStatus } from "@/lib/types";

type Params = { id: string };

/**
 * 엑셀 다운로드
 * - ?ym= : 그 달까지 출력 범위 (그 달 이후 시트는 비움) + 그 달 시트 활성. 승인된 달은 승인본, 상신된 달은 상신본 **저장 파일을 그대로** 내려준다
 *   (헤더 X-Snapshot: approve/v2). 재무 승인·시스템 관리자는 ?live=1 로 현재 데이터 버전(파일 이름 "_수정본_현재")을 받을 수 있다
 * - ?ym=&sheet=month : 그 달 시트 하나만 (기존 통합문서에 옮겨 붙이는 용도) — 현재 데이터로
 * - ym 없음: 전체 (현재 데이터)
 */
export const GET = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id, ["MANAGER", "HQ", "ADMIN"]);
  // 팀원별 정산·참석자 개인정보가 들어 있어 상위 PM·조직장 조회(view)는 받을 수 없음
  if (!canSeeAllRows(user)) throw new HttpError(403, "조회 권한으로는 엑셀을 내려받을 수 없습니다.");
  const sp = new URL(req.url).searchParams;
  const ym = sp.get("ym");
  if (ym && !isYearMonth(ym)) throw new HttpError(400, "ym은 YYYY-MM 형식입니다.");
  const sheet = sp.get("sheet");
  if (sheet === "month" && !ym) throw new HttpError(400, "이 달 시트는 ym(YYYY-MM)을 지정하세요.");
  const live = sp.get("live") === "1";
  if (live && !isHqLike(user)) throw new HttpError(403, "현재 데이터로 다시 만든 엑셀은 재무 승인·시스템 관리자만 받을 수 있습니다.");

  if (sheet === "month" && ym) {
    const { buffer, filename } = await buildMonthSheet(id, ym);
    return xlsxDownload(user, { projectId: id, entityId: id, filename, buffer });
  }

  // 승인·상신된 달: 저장된 승인본·상신본을 그대로 (현재 데이터로 다시 만들지 않는다 — BrityWorks 첨부본과 같은 파일)
  if (ym && !live) {
    const closing = await prisma.monthlyClosing.findUnique({ where: { projectId_yearMonth: { projectId: id, yearMonth: ym } }, select: { id: true, status: true } });
    const kind = closing ? servedSnapshotKind(parseClosingStatus(closing.status)) : null;
    const snap = closing && kind ? await latestSnapshotFile(closing.id, kind) : null;
    if (snap) {
      return xlsxDownload(user, {
        projectId: id, entityId: snap.id, filename: snap.fileName, buffer: snap.buffer,
        data: { snapshotId: snap.id, sha256: snap.sha256, kind: snap.kind, version: snap.version },
        headers: { "X-Snapshot": `${snap.kind.toLowerCase()}/v${snap.version}` },
      });
    }
  }
  const { buffer, filename, status } = await buildWorkbook(id, ym ?? undefined, { live });
  // 참석자 등 개인정보가 포함된 파일 — 다운로드 기록
  return xlsxDownload(user, { projectId: id, entityId: id, filename, buffer, data: status ? { status, live } : undefined });
});
