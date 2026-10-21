-- 상신 가드·재무 승인 판단 요약 (설계 검토(2026-10-14) P0-1·P0-3) — PM 상신 메모, 가드 무시 사유, 직전 반려·승인 취소 사유 보존
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0010_submit_guard.sql
-- 배포 **전에** 적용할 것: 새 코드가 이 열을 읽고 쓴다 (적용 전에 새 코드가 올라가면 마감·상신 화면 조회, 마감·상신·승인 처리가 실패한다)
-- 두 번째 실행은 "duplicate column name" 오류가 나지만 데이터에는 영향 없다
ALTER TABLE "MonthlyClosing" ADD COLUMN "submitNote" TEXT;
ALTER TABLE "MonthlyClosing" ADD COLUMN "submitOverride" TEXT;
ALTER TABLE "MonthlyClosing" ADD COLUMN "lastReviewNote" TEXT;
ALTER TABLE "MonthlyClosing" ADD COLUMN "lastReviewedAt" DATETIME;
ALTER TABLE "MonthlyClosing" ADD COLUMN "lastReviewedBy" TEXT;
