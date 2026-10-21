-- 리프레시 토큰 회전 기록 (재사용 = 탈취 탐지 → 그 사용자 전체 로그아웃)
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0005_refresh_tokens.sql
-- 다시 실행해도 안전 (IF NOT EXISTS). 날짜 칸은 ISO 글자 (예 2026-10-14T03:00:00.000+00:00)
-- 배포 전에 적용할 것: 적용 전에 새 코드가 올라가면 로그인·재발급이 실패한다. 이미 발급된 옛 형식 토큰(jti 없음)은 첫 재발급 때 새 계열로 등록된다.
CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "jti" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME,
    "exp" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX IF NOT EXISTS "RefreshToken_exp_idx" ON "RefreshToken"("exp");
