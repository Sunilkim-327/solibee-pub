-- 성능 점검(2026-10) 색인 4개 — 팀원 출입증 조회, 할 일 건수, 규정 점검 건, 마감 검토 기록
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0006_perf_indexes.sql
-- 다시 실행해도 안전 (IF NOT EXISTS). 색인만 추가하므로 배포 전후 어느 때 적용해도 된다
CREATE INDEX IF NOT EXISTS "PassStatementLine_statementId_userId_idx" ON "PassStatementLine"("statementId", "userId");
CREATE INDEX IF NOT EXISTS "PassStatementLine_statementId_decision_memberClaim_idx" ON "PassStatementLine"("statementId", "decision", "memberClaim");
CREATE INDEX IF NOT EXISTS "Expense_projectId_flags_idx" ON "Expense"("projectId", "flags");
CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");
