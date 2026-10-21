-- 로그인·비밀번호 확인 실패 기록 (IP·계정별 시도 제한 — Workers 인스턴스 간 공유)
-- 적용: wrangler d1 execute <DB> --remote --file prisma/d1/0003_auth_failures.sql
-- 다시 실행해도 안전 (IF NOT EXISTS). 날짜 칸(at)은 ISO 글자 (예 2026-10-12T03:00:00.000+00:00)
CREATE TABLE IF NOT EXISTS "AuthFailure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "ip" TEXT,
    "subject" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AuthFailure_scope_ip_at_idx" ON "AuthFailure"("scope", "ip", "at");
CREATE INDEX IF NOT EXISTS "AuthFailure_scope_subject_at_idx" ON "AuthFailure"("scope", "subject", "at");
CREATE INDEX IF NOT EXISTS "AuthFailure_at_idx" ON "AuthFailure"("at");
