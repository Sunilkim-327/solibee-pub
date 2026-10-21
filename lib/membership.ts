// 프로젝트 팀원의 이전 팀원 처리(철수일) — 순수함수
// 철수일(leftAt) = 이 프로젝트 마지막 근무일 (UTC 자정 기준 일자). 비어 있으면 현재 팀원.
// 철수일이 지나면 접근·입력·참석자·알림에서 빠지고, 그 기간의 지출 결제자·출입증을 사용한 사람으로만 남는다.

import { formatDate, toYearMonth } from "./format";

type Tenure = { leftAt: Date | null };

/** 오늘(한국 시간 일자) 기준 현재 팀원인지 — 철수일 당일까지는 현재 팀원 */
export const isCurrentMember = (m: Tenure, today: Date) => !m.leftAt || m.leftAt >= today;

/** Prisma 조건: 현재 팀원만 (projectMember where에 펼쳐 쓴다) */
export const currentMemberWhere = (today: Date) => ({ OR: [{ leftAt: null }, { leftAt: { gte: today } }] });

/** 그 날짜에 근무 중이었는지 (지출 결제자 — 철수일 이후 날짜는 결제자가 될 수 없다) */
export const servedOn = (m: Tenure, day: Date) => !m.leftAt || day <= m.leftAt;

/** 그 달에 근무했는지 (정산표 결제자 열 — 철수한 달까지 표시) */
export const servedInMonth = (m: Tenure, ym: string) => !m.leftAt || toYearMonth(m.leftAt) >= ym;

/** 기간 시작일 이후까지 근무했는지 (출입증 내역 기간과 겹치는지) */
export const servedSince = (m: Tenure, from: string) => !m.leftAt || formatDate(m.leftAt) >= from;

/** 철수일 표시 "~3/31" */
export const leftLabel = (leftAt: Date | string) => {
  const s = typeof leftAt === "string" ? leftAt : formatDate(leftAt);
  return `~${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
};
