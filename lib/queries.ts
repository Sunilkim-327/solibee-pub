// 여러 화면에서 함께 쓰는 조회 (서버 전용) — 같은 요청 안에서 한 번만 (React cache), 자주 쓰는 것은 직접 SQL (lib/sql-loaders.ts)
import { cache } from "react";
import { isLocked } from "./closing";
import { sqlBudgetLines, sqlClosingRows, sqlExpenseMonthSums, sqlPassCompanyLines, sqlProjectMembers } from "./sql-loaders";
import { addMonths } from "./format";
import { mergeSpendRows, passBudgetSpend } from "./pass-budget";

/** 프로젝트의 월 마감 행 (같은 요청 안에서 한 번만 — 마감 상태·잠긴 월·할 일이 함께 쓴다) */
export const closingRows = cache((projectId: string) => sqlClosingRows(projectId));

/** 마감(CLOSED 이상)된 월 목록 — 지출 수정·삭제 잠금 표시용 */
export async function getLockedMonths(projectId: string): Promise<string[]> {
  const closings = await closingRows(projectId);
  return closings.filter((c) => isLocked(c.status)).map((c) => c.yearMonth);
}

/**
 * 프로젝트 팀원 전체(이전 팀원 포함) + 사용자 이름·역할·직급·활성 — 결제자 목록·참석자 칩·할 일·PM 이름이 이 한 번의 조회를 함께 쓴다.
 * @param idsKey 프로젝트 id를 쉼표로 이은 값 (요청 캐시 키는 원시값)
 */
export const projectMembersOf = cache((idsKey: string) => sqlProjectMembers(idsKey.split(",")));

/** 예산 행 (예산 행 순서) — 입력 항목·잔액·과업 선택지·할 일(예산 유무)이 함께 쓴다 */
export const budgetLinesOf = cache((projectId: string) => sqlBudgetLines(projectId));

/**
 * 프로젝트별·항목별·월별 지출 합계 (같은 요청 안에서 한 번만) — 예산 집계·입력 잔액은 지출 행 대신 합계로 계산한다.
 * @param idsKey 프로젝트 id를 쉼표로 이은 값 (요청 캐시 키는 원시값)
 */
export const expenseMonthSums = cache((idsKey: string) => sqlExpenseMonthSums(idsKey.split(",")));

/**
 * 출입증 회사 부담 줄 전체 (같은 요청 안에서 한 번만) — 예산 집행 합산(확정분)·확정 전 금액·중복 의심이 함께 쓴다.
 * @param idsKey 프로젝트 id를 쉼표로 이은 값
 */
export const passCompanyLines = cache((idsKey: string) => sqlPassCompanyLines(idsKey.split(",")));

/** 한 사람의 출입증 회사 부담 줄 — 그 달 내역 + 다음 달 내역 (업체 정산 기간이 21일~20일처럼 달을 걸치므로 그 달 사용일이 다음 달 내역에 있을 수 있다) */
export const myPassCompanyLines = cache((idsKey: string, userId: string, ym: string) =>
  sqlPassCompanyLines(idsKey.split(","), { userId, yearMonths: [ym, addMonths(ym, 1)] }));

/**
 * 예산 집행 합계 = 카드 지출 합계 + 출입증 확정분(연결 예산 항목) — 프로젝트·항목·월 행.
 * 예산 진행률·잔액·이번 달 가용·초과 판정이 모두 이 합계를 쓴다 (예산은 하나, 쓰는 방법은 둘).
 */
export const budgetMonthSums = cache(async (idsKey: string) => {
  const [card, pass] = await Promise.all([expenseMonthSums(idsKey), passCompanyLines(idsKey)]);
  return mergeSpendRows(card, passBudgetSpend(pass).confirmedRows);
});
