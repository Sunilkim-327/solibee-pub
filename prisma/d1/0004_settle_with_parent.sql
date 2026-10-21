-- 서브 프로젝트 '메인과 함께 상신' + 상신 엑셀 구분명 (lib/settle-group.ts)
-- 적용: wrangler d1 execute <DB> --remote --file prisma/d1/0004_settle_with_parent.sql
-- 기존 프로젝트는 settleWithParent = 0(따로 상신), excelPrefix = NULL(항목 이름 그대로) — 기존 데이터·엑셀 출력에 영향 없음.
-- 다시 실행하면 첫 문장에서 "duplicate column"으로 멈춘다 (= 이미 적용된 상태 그대로).
ALTER TABLE "Project" ADD COLUMN "settleWithParent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "excelPrefix" TEXT;
