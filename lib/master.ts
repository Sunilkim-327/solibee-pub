import "server-only";
import { cache } from "react";
import { sortPeople } from "./org";
import { partnerLabel } from "./partners";
import { projectRows, type SessionUser } from "./access";
import { allowedFromSources } from "./expenses";
import { currentYearMonth, formatDate, projectMonths, seoulToday, seoulTodayDate } from "./format";
import { isCurrentMember } from "./membership";
import { budgetLinesOf, budgetMonthSums, expenseMonthSums, projectMembersOf } from "./queries";
import { sqlActivePartners, sqlContractChanges, sqlMasterCategories, sqlMemberItemIds, sqlRecentInputs } from "./sql-loaders";
import { PASS_CATEGORY_ID } from "./pass-category";
import { bundleRemaining, budgetKeyMap } from "./budget-bundle";
import { monthBudgets, monthBudgetsByYm } from "./input-budget";
import { inputOpen } from "./month-phase";
import type { Role } from "./types";

import type { InputContext, MasterCategory } from "./dto";
export type { InputContext, MasterCategory };

/** 프로젝트의 분류/항목 (사용 중인 항목만). projectId=null이면 공통 기본 항목. 업체 출입증 분류는 제외 (카드 지출·예산용) */
// 순서 값이 같으면 이름순 (순서 이동 API와 같은 기준). 직접 SQL (lib/sql-loaders — 현황·입력 화면이 매 요청 쓴다)
export const getMaster = cache((projectId: string | null): Promise<MasterCategory[]> => sqlMasterCategories(projectId, PASS_CATEGORY_ID));

// ── 입력 화면 공통 조회 (같은 요청 안에서 한 번만: 입력 항목·잔액·과업 선택지가 함께 쓴다) ──

// 예산 행(예산 행 순서)은 lib/queries budgetLinesOf — 할 일(예산 유무)과 함께 쓴다

/** PM이 팀원에게 노출한 항목 */
const memberItemIdsOf = cache((projectId: string) => sqlMemberItemIds(projectId));

/** 변경계약 과업 (managerId를 주면 그 사람이 담당한 과업만) */
const changesOf = cache((projectId: string, managerId: string | null) => sqlContractChanges(projectId, managerId));

/** 사용자가 입력할 수 있는 항목 id (lib/expenses allowedFromSources와 같은 기준) */
const inputItemIds = cache(async (projectId: string, userId: string, role: Role) => {
  const member = role === "MEMBER";
  const [lines, memberItemIds, changes] = await Promise.all([
    budgetLinesOf(projectId),
    member ? memberItemIdsOf(projectId) : [],
    // 변경계약 과업 담당 PM(팀원 권한): 과업 전용 항목도 입력 가능
    member ? changesOf(projectId, userId) : [],
  ]);
  return allowedFromSources(role, lines, memberItemIds, changes.flatMap((c) => c.items.map((i) => i.itemId)));
});

/** 입력 폼용: 사용자가 쓸 수 있는 항목만 남긴 마스터 (재무 승인이 등록한 예산 항목, 팀원은 PM 노출 항목) */
export async function getInputMaster(user: SessionUser, projectId: string): Promise<MasterCategory[]> {
  const [master, allowed] = await Promise.all([getMaster(projectId), inputItemIds(projectId, user.id, user.role)]);
  return filterMaster(master, allowed);
}

/** 마스터에서 허용 항목만 남기고 빈 분류는 뺀다 (순수함수) */
export function filterMaster(master: MasterCategory[], allowed: string[]): MasterCategory[] {
  const ok = new Set(allowed);
  return master
    .map((c) => ({ ...c, items: c.items.filter((i) => ok.has(i.id)) }))
    .filter((c) => c.items.length > 0);
}

/** ?ym 값이 프로젝트 월이면 사용, 아니면 이번 달(기간 내) 또는 가장 가까운 월 */
export function resolveYm(ym: string | string[] | undefined, months: string[]): string {
  if (typeof ym === "string" && months.includes(ym)) return ym;
  const now = currentYearMonth();
  if (months.includes(now)) return now;
  return now < months[0] ? months[0] : months[months.length - 1];
}

/** 입력 폼 보조 정보: 항목별 예산 잔액, 참석자 칩(프로젝트 팀원), 최근 입력 */
export async function getInputContext(user: SessionUser, projectId: string): Promise<InputContext> {
  const ym = currentYearMonth();
  const today = seoulTodayDate();
  const [lines, sums, project, members, recent, partners] = await Promise.all([
    budgetLinesOf(projectId),
    // 항목별 집행 합계(전체·이번 달) — 항목·월별 합계(현황의 예산 집계와 같은 조회)에서 더한다.
    // 집행 = 카드 + 출입증 확정분 (서버 검사 buildExpenseData와 같은 기준). 팀원에게는 금액을 보내지 않으므로 카드 합계만 (출입증 조회 생략)
    user.role === "MEMBER" ? expenseMonthSums(projectId) : budgetMonthSums(projectId),
    // 기간: 레이아웃·권한 확인에서 읽은 전체 프로젝트 목록을 다시 쓴다 (추가 조회 없음)
    projectRows().then((rows) => rows.find((p) => p.id === projectId) ?? null),
    // 현재 팀원 — 팀원 전체 조회를 함께 쓴다
    projectMembersOf(projectId).then((list) => list.filter((m) => isCurrentMember(m, today))),
    sqlRecentInputs(projectId, user.id, 20),
    sqlActivePartners(projectId),
  ]);
  // 묶음 예산은 묶음 단위 잔액 (서버 검사 buildExpenseData와 같은 기준)
  const spent: Record<string, number> = {};
  const monthSpent: Record<string, number> = {};
  for (const g of sums) {
    spent[g.itemId] = (spent[g.itemId] ?? 0) + g.amount;
    // 이번 달 항목별 지출 (매월 항목의 이번 달 가용 계산용)
    if (g.yearMonth === ym) monthSpent[g.itemId] = (monthSpent[g.itemId] ?? 0) + g.amount;
  }
  const remaining = bundleRemaining(lines, spent);
  const months = project ? projectMonths(project.startDate, project.endDate) : [];
  const monthCount = months.length;
  const monthly = monthBudgets(lines, monthSpent, monthCount);
  // 달별 가용 (지난달 사용일 입력용) — 팀원에게는 보내지 않는다
  const monthlyByYm = user.role === "MEMBER" ? undefined : monthBudgetsByYm(lines, sums, months);
  // 같은 항목·세부내역은 한 번만 (최근 5개)
  const seen = new Set<string>();
  const recentUnique = recent.filter((r) => {
    const k = `${r.itemId}|${r.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
  return {
    // 팀원에게는 예산 금액(잔액·이번 달 가용·월 배정)을 보내지 않는다 — 초과 여부는 저장할 때 서버가 알려 준다
    remaining: user.role === "MEMBER" ? {} : remaining,
    budgetKeyOf: budgetKeyMap(lines),
    monthly: user.role === "MEMBER" ? {} : monthly,
    ym,
    monthlyByYm,
    // 사용일 범위: 프로젝트 시작 ~ 종료 (오늘까지는 폼에서 자른다)
    period: project ? { start: formatDate(project.startDate), end: formatDate(project.endDate) } : undefined,
    // 팀원 입력 기한이 지난 달 (서버 403 assertInputDeadline과 같은 기준) — 팀원에게만
    deadlinePassedMonths: user.role === "MEMBER" ? deadlinePassedMonths(months, seoulToday()) : [],
    // 참석자 칩: 직급 → 성명 순
    people: sortPeople(members.filter((m) => m.user.role !== "HQ"), (m) => m.user).map((m) => m.user.name),
    partners: partners.map(partnerLabel),
    me: user.name,
    recent: recentUnique,
  };
}

/** 프로젝트 기간의 달 중 오늘 기준 팀원 입력 기한이 지난 달 (미래 달 제외, 순수함수) */
export function deadlinePassedMonths(months: string[], today: string): string[] {
  return months.filter((m) => m <= today.slice(0, 7) && !inputOpen(m, today));
}

/**
 * 입력 폼의 과업 선택지 (변경계약이 있을 때만)
 * - 과업 담당 PM(팀원 권한): 본 과업(팀원 항목) + 담당 과업(과업 전용 항목)
 * - 메인 PM·재무 승인·시스템 관리자: 본 과업 + 모든 변경 과업 (항목 제한 없음)
 */
export async function getInputTasks(user: SessionUser, projectId: string) {
  const member = user.role === "MEMBER";
  const [changes, memberItems] = await Promise.all([
    changesOf(projectId, member ? user.id : null),
    member ? memberItemIdsOf(projectId) : null,
  ]);
  if (!changes.length) return undefined;
  return [
    { id: "", label: "본 과업", itemIds: memberItems },
    ...changes.map((c) => ({ id: c.id, label: `변경 ${c.seq}차 · ${c.title}`, itemIds: member ? c.items.map((i) => i.itemId) : null })),
  ];
}
