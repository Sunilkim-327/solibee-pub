-- 앱 내 알림 표 (설계 검토(2026-10-14) P1-2 ②) — 상신·승인·반려·승인 취소, 입력·소명 요청, 출입증 확인·확정 알림
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0007_notifications.sql
-- 다시 실행해도 안전 (IF NOT EXISTS). 날짜 칸은 ISO 글자 (예 2026-10-14T03:00:00.000+00:00)
-- 배포 전에 적용할 것: 새 코드가 이 표를 읽는다 (적용 전에 새 코드가 올라가면 알림 목록·상신·승인 뒤 알림 저장이 실패한다)
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "projectId" TEXT,
    "yearMonth" TEXT,
    "key" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_key_key" ON "Notification"("userId", "key");
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
