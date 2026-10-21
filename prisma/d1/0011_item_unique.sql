-- 항목 이름·코드 유니크 제약 + 감사 로그 사용자 색인 (설계 검토(2026-10-14) P1-8)
-- 적용: wrangler d1 execute opex-db --remote --file prisma/d1/0011_item_unique.sql
-- 다시 실행해도 안전 (IF NOT EXISTS). 색인만 추가하므로 배포 전후 어느 때 적용해도 된다
--
-- ★ 적용 전 중복 점검 — 아래 두 쿼리가 모두 0행이어야 한다 (중복이 있으면 유니크 색인 생성이 실패한다).
--   중복이 나오면 한쪽 항목의 이름·코드를 먼저 바꾼 뒤 적용할 것.
--   wrangler d1 execute opex-db --remote --command "SELECT projectId, name, COUNT(*) c FROM Item GROUP BY projectId, name HAVING c > 1"
--   wrangler d1 execute opex-db --remote --command "SELECT projectId, code, COUNT(*) c FROM Item WHERE code IS NOT NULL GROUP BY projectId, code HAVING c > 1"
--   (참고) 앱 검사는 코드를 대소문자 구분 없이 막는다 — 색인은 대소문자를 구분하므로 아래도 0행이면 더 좋다:
--   wrangler d1 execute opex-db --remote --command "SELECT projectId, lower(code) code, COUNT(*) c FROM Item WHERE code IS NOT NULL GROUP BY projectId, lower(code) HAVING c > 1"
--
-- 주의: SQLite/D1은 유니크 색인에서 NULL을 서로 다른 값으로 보므로 공통 항목(projectId NULL)에는 이 제약이 걸리지 않는다.
--   공통 항목의 중복은 앱 검사(app/api/master/items 라우트)로 막는다. code가 NULL인 항목이 한 프로젝트에 여럿 있어도 된다.
CREATE UNIQUE INDEX IF NOT EXISTS "Item_projectId_name_key" ON "Item"("projectId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "Item_projectId_code_key" ON "Item"("projectId", "code");

-- 사용자별 활동 기록 조회
CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- 변경계약 이월 관계 (ContractChange.carriedFromId → ContractChange.id, ON DELETE SET NULL)
-- SQLite/D1은 기존 표에 외래키를 더할 수 없다 (표 재생성 필요) → FK 없음, Prisma 관계(schema.prisma carriedFrom/carriedTo)와 앱에서 보장.
-- 색인만 추가한다.
CREATE INDEX IF NOT EXISTS "ContractChange_carriedFromId_idx" ON "ContractChange"("carriedFromId");
