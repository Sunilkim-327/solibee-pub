-- 업체 출입증: 업체 서식을 프로젝트당 여러 개(업체별)로, 명세 줄에 업체(vendor) 추가
-- 적용: wrangler d1 execute <DB> --remote --file prisma/d1/0002_pass_vendors.sql
--
-- 순서와 재실행:
--  1) 프로젝트 표시 항목 열·명세 줄 vendor 열 추가 — 맨 앞에 둔다. 이미 적용된 DB에 다시 실행하면 여기서 "duplicate column"으로 멈추고
--     (wrangler는 파일 전체를 한 번에 실행하므로) 뒤 문장은 실행되지 않는다 = 이미 적용된 상태 그대로.
--  2) 업체 서식 표를 다시 만든다 (SQLite는 열을 NOT NULL로 바꾸거나 UNIQUE를 지울 수 없음):
--     업체 이름이 없던 서식은 '업체1'. projectId 하나에 서식 하나였던 UNIQUE를 (projectId, vendorName)으로.
--     새 표를 IF NOT EXISTS로 만들고 INSERT OR IGNORE로 옮기므로 2)~4)만 따로 다시 실행해도 결과가 같다.
--  3) 프로젝트 표시 항목 목록 = 기존 서식의 표시 열 머리글 이름 (비어 있을 때만 채움)
--  4) 기존 명세 줄의 vendor = 그 프로젝트의 (기존 하나뿐인) 서식 업체 이름. 서식이 없는 프로젝트의 줄은 NULL(업체 미지정) 유지.
-- 날짜 칸(updatedAt)은 기존 글자 값(ISO, 예 2026-10-12T03:00:00.000+00:00)을 그대로 옮긴다.

-- 1) 프로젝트 공통 표시 항목 목록 · 명세 줄 업체
ALTER TABLE "Project" ADD COLUMN "passDisplayItems" TEXT;
ALTER TABLE "PassStatementLine" ADD COLUMN "vendor" TEXT;

-- 2) 업체 서식: 업체 이름 필수 + 프로젝트 안에서 업체 이름 UNIQUE
CREATE TABLE IF NOT EXISTS "PassImportProfile_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "periodStartDay" INTEGER NOT NULL DEFAULT 1,
    "sheets" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PassImportProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "PassImportProfile_new" ("id", "projectId", "vendorName", "periodStartDay", "sheets", "updatedBy", "updatedAt")
SELECT "id", "projectId", COALESCE(NULLIF(TRIM("vendorName"), ''), '업체1'), "periodStartDay", "sheets", "updatedBy", "updatedAt"
FROM "PassImportProfile";

DROP TABLE "PassImportProfile";
ALTER TABLE "PassImportProfile_new" RENAME TO "PassImportProfile";
CREATE UNIQUE INDEX IF NOT EXISTS "PassImportProfile_projectId_vendorName_key" ON "PassImportProfile"("projectId", "vendorName");

-- 3) 프로젝트 표시 항목 목록 = 기존 서식의 표시 열 머리글 이름 (시트 순서 → 시트 안 순서, 처음 나온 것만)
--    기존 줄의 표시 항목 이름표(extra의 label = 머리글)와 같은 값이라 8·9월 등 기존 줄이 그대로 이어진다.
--    "#3"처럼 열 번호로 지정한 열은 이름을 알 수 없어 빼고, 화면이 줄의 이름표로 뒤에 붙여 보여 준다.
--    목록 JSON은 이름 배열(앱이 키 = 이름으로 읽음).
UPDATE "Project"
SET "passDisplayItems" = (
    SELECT json_group_array(name) FROM (
        SELECT d.value AS name, MIN(s.key * 1000 + d.key) AS pos
        FROM "PassImportProfile" p, json_each(p."sheets") s, json_each(s.value, '$.displayCols') d
        WHERE p."projectId" = "Project"."id" AND d.value NOT LIKE '#%'
        GROUP BY d.value
        ORDER BY pos
    )
)
WHERE "passDisplayItems" IS NULL
  AND EXISTS (SELECT 1 FROM "PassImportProfile" p WHERE p."projectId" = "Project"."id");

-- 4) 기존 명세 줄의 업체 = 그 프로젝트의 기존 서식 업체 이름 (서식이 없으면 NULL 유지)
UPDATE "PassStatementLine"
SET "vendor" = (
    SELECT p."vendorName"
    FROM "PassStatement" s
    JOIN "PassImportProfile" p ON p."projectId" = s."projectId"
    WHERE s."id" = "PassStatementLine"."statementId"
    ORDER BY p."updatedAt" DESC
    LIMIT 1
)
WHERE "vendor" IS NULL;
