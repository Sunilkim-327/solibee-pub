// 업체 출입증 분류 — 프로젝트 운영비의 출입증 칸에서 항목을 등록한다 (예: 야근 식사·1일 한도).
// 이 분류의 항목만 출입증 사용분의 "회사 부담" 항목으로 고를 수 있고,
// 개인 법인카드 지출 입력·예산(프로젝트 운영비)에는 나오지 않는다.
export const PASS_CATEGORY_ID = "client-pass";
export const PASS_CATEGORY_NAME = "업체 출입증";

/**
 * 출장비 분류 — 기본 분류(prisma/seed.ts)의 고정 id. 상신 엑셀 월 시트의 '출장비(신청서/보고서 품의 필수)' 구역에 이 분류 지출을 모은다.
 * 분류 이름은 바꿀 수 있어 이름 대신 id로 구분한다 (새로 만든 분류는 cuid라 이 id와 겹치지 않음)
 */
export const TRAVEL_CATEGORY_ID = "trip";
