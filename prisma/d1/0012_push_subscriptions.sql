-- 웹 푸시 구독 표 — 기기(브라우저)마다 하나. 앱 내 알림을 저장할 때 같은 내용을 그 사람의 기기로도 보낸다 (lib/push-server.ts)
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0012_push_subscriptions.sql
-- 다시 실행해도 안전 (IF NOT EXISTS). 배포 전에 적용할 것 (적용 전에는 푸시 켜기가 실패한다. 알림 저장은 영향 없음)
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" DATETIME,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");
