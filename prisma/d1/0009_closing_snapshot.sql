-- 상신본·승인본 스냅샷 (설계 검토(2026-10-14) P0-2) — 상신·승인 시점의 상신 양식 엑셀을 보관하고, 승인된 달은 이 파일을 내려준다
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0009_closing_snapshot.sql
-- 다시 실행해도 안전 (IF NOT EXISTS) — 단, ALTER TABLE ADD COLUMN은 두 번째 실행에서 "duplicate column name" 오류가 나지만 데이터에는 영향 없다
-- 배포 **전에** 적용할 것: 새 코드가 이 표와 열을 읽는다 (적용 전에 새 코드가 올라가면 마감·상신 화면 조회, 상신·승인 뒤 스냅샷 저장, 예산 저장이 실패한다)
CREATE TABLE IF NOT EXISTS "ClosingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "closingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "ClosingSnapshot_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "MonthlyClosing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ClosingSnapshot_closingId_kind_version_idx" ON "ClosingSnapshot"("closingId", "kind", "version");
-- BrityWorks 결재 문서번호 (재무 승인 입력, 연동 전까지 수동)
ALTER TABLE "MonthlyClosing" ADD COLUMN "approvalRef" TEXT;
