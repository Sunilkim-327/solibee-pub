-- 영수증 첨부 범위 제외 (2026-10-14 결정 — 증빙은 법인카드 내역으로 갈음): Expense.receiptUrl 열 삭제
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0008_drop_receipt_url.sql
-- 배포가 끝난 뒤에 적용할 것 (옛 코드가 이 열을 읽는다 — 배포 전에 지우면 옛 코드의 지출 조회가 실패한다)
-- 적용 전 확인: SELECT COUNT(*) FROM "Expense" WHERE "receiptUrl" IS NOT NULL; → 0이어야 한다 (코드에서 쓴 적이 없어 0)
-- 두 번 실행하면 "no such column" 오류가 나지만 데이터에는 영향 없다
ALTER TABLE "Expense" DROP COLUMN "receiptUrl";
