-- 출입증: 구분 없이(시트 이름이 구분) 만든 업체 서식으로 올린 내역의 구분 바로잡기 — 운영 D1 보정용 틀
-- (앱에서는 PM 설정 › 출입증 › 업체 ⋯ › 양식 수정으로 구분을 정하면 서식이 교체되고, 확정 전 달의 기존 줄 구분도 함께 바뀐다.
--  이 SQL은 앱으로 고치기 전에 이미 같은 시트·옛 구분 줄과 새 구분 줄이 함께 생긴 경우 등 직접 보정이 필요할 때만)
--
-- 바꿀 값: <프로젝트ID>, <업체>(예: OO푸드), <시트>(구분 없던 설정의 시트 이름 — 옛 구분), <새 구분>(예: 카페)
-- 1) 먼저 확인 (바뀔 줄 수·달·확정 여부)
SELECT s."yearMonth", s."status", l."placeType", COUNT(*) AS "lines", SUM(l."amount") AS "amount"
FROM "PassStatementLine" l JOIN "PassStatement" s ON s."id" = l."statementId"
WHERE s."projectId" = '<프로젝트ID>' AND l."vendor" = '<업체>' AND l."sheetName" = '<시트>'
GROUP BY s."yearMonth", s."status", l."placeType"
ORDER BY s."yearMonth";

-- 같은 달에 옛 구분 줄과 새 구분 줄이 함께 있으면(이중 집계) 어느 쪽을 남길지 먼저 정한다 — 아래 2)는 구분 이름만 바꾼다.
-- 2) 확정 전 달의 옛 구분 줄 → 새 구분 (확정된 달은 바꾸지 않음 — 필요하면 앱에서 확정 취소 후)
UPDATE "PassStatementLine"
SET "placeType" = '<새 구분>'
WHERE "vendor" = '<업체>' AND "sheetName" = '<시트>' AND "placeType" = '<시트>'
  AND "statementId" IN (SELECT "id" FROM "PassStatement" WHERE "projectId" = '<프로젝트ID>' AND "status" = 'OPEN');
