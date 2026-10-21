// PM "이번 달 할 일" 계산 — 순수함수 (서버 import 없음)
import type { ClosingStatus } from "./types";
import { isUnexplained } from "./policy";
import { ledgerHref } from "./page-access";
import { inputDeadlineLabel, monthPhase } from "./month-phase";

export type SetupState = {
  /** 재무 승인 담당의 예산 등록 (예산 항목 1개 이상) — 유일한 필수 조건 (예산이 없으면 PM도 입력할 수 없다) */
  hasBudget: boolean;
  /** 팀원 입력 항목 선택 — 선택 (팀원도 입력하는 프로젝트만) */
  hasMemberItems: boolean;
  /** PM 외 팀원 1명 이상 — 선택 (PM만 입력하는 프로젝트도 정상) */
  hasMembers: boolean;
};

/** 입력 시작 준비 완료 = 재무 승인 담당의 예산 등록. 팀원 등록·팀원 지출 항목은 팀원도 입력할 때만 필요한 선택 사항 */
export const setupComplete = (s: SetupState) => s.hasBudget;

export type TodoExpense = {
  payerId: string;
  yearMonth: string;
  isHq: boolean;
  payMethod: string;
  flags: string | null;
  /** 소명 (규정 점검에 걸린 건이라도 소명이 있으면 할 일에서 뺀다 — 마감 체크리스트와 같은 규칙) */
  justification?: string | null;
};

export type TodoInput = {
  /** 기준 월 (이번 달, 기간 밖이면 마지막 달) */
  ym: string;
  /** 실제 이번 달 — 이보다 이전 월이 마감·상신 대상 */
  now: string;
  /** 오늘 "YYYY-MM-DD" (한국) — 있으면 마감 대상은 팀원 입력 기한이 지난 달(마감 대기, lib/month-phase)만, 없으면 지난 달 전부 */
  today?: string;
  /** 프로젝트 기간의 월 목록 */
  months: string[];
  setup: SetupState;
  /** 결제자(isPayer)이면서 PM이 아닌 팀원 중 입력할 수 있는 팀원 (자기에게 열린 지출 항목이 있는 사람 — lib/input-capable) */
  payers: { id: string; name: string }[];
  expenses: TodoExpense[];
  closings: { yearMonth: string; status: ClosingStatus | string; reviewNote: string | null; revoked?: boolean }[];
  /** 출입증: 확정 전 내역 — 회사 부담 요청(미결정) 건수 · 연결 안 된 이름(팀원과 연결되지 않은 줄) 수 (개인카드 정산과 별개) */
  passChecks?: { ym: string; count: number; unmatched?: number }[];
};

export type TodoItem = {
  key: "setup" | "noinput" | "flag" | "rejected" | "toclose" | "tosubmit" | "submitted" | "pass";
  tone: "danger" | "warn" | "info";
  title: string;
  detail?: string;
  href: string;
};

const MAX_NAMES = 5;
const nameList = (names: string[]) =>
  names.length > MAX_NAMES ? `${names.slice(0, MAX_NAMES).join(", ")} 외 ${names.length - MAX_NAMES}명` : names.join(", ");
const monthText = (ym: string) => `${Number(ym.slice(5))}월`;
const monthsText = (yms: string[]) => yms.map(monthText).join(", ");

/** PM 할 일 목록 (위험 → 주의 → 안내 순) */
export function buildTodos(input: TodoInput): TodoItem[] {
  const { ym, now, today, months, setup, payers, expenses, closings } = input;
  const items: TodoItem[] = [];
  const statusOf = new Map(closings.map((c) => [c.yearMonth, c]));

  // (a) 시작 준비
  if (!setupComplete(setup)) {
    items.push({ key: "setup", tone: "warn", title: "지출 입력 시작 준비가 덜 됐습니다", detail: "예산 등록 필요", href: "/settings" });
  }

  // (f) 반려된 월 — 사유 확인 후 수정·재마감
  for (const c of closings.filter((x) => x.status === "REJECTED").sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))) {
    items.push({
      key: "rejected", tone: "danger",
      title: `${monthText(c.yearMonth)} ${c.revoked ? "승인 취소됨" : "반려"} — 수정 후 다시 마감·상신`,
      detail: c.reviewNote ? `사유: ${c.reviewNote}` : undefined,
      href: `/closing?ym=${c.yearMonth}`,
    });
  }

  const cur = expenses.filter((e) => e.yearMonth === ym);
  // (c) 규정 점검 건 — 소명이 없는 건만 (소명한 건은 할 일이 끝난 것)
  const flagged = cur.filter(isUnexplained).length;
  if (flagged > 0) items.push({ key: "flag", tone: "warn", title: `소명 없는 ${flagged}건 — 수정에서 소명 입력`, detail: `${monthText(ym)} 규정 점검`, href: ledgerHref(ym, { check: "unexplained" }) });

  // (e) 지난 달 마감·상신 대상: 지출이 있고 팀원 입력 기한이 지난 작성중 월(마감 대기) → 마감, 마감된 월 → 상신
  const hasExpense = new Set(expenses.map((e) => e.yearMonth));
  const past = months.filter((m) => m < now);
  const pendingClose = (m: string) => (today ? monthPhase(m, statusOf.get(m)?.status, today) === "PENDING_CLOSE" : (statusOf.get(m)?.status ?? "DRAFT") === "DRAFT");
  const toClose = past.filter((m) => pendingClose(m) && hasExpense.has(m));
  const toSubmit = past.filter((m) => statusOf.get(m)?.status === "CLOSED");
  // 링크는 그 달로 (여럿이면 가장 오래된 달)
  if (toClose.length) items.push({ key: "toclose", tone: "warn", title: `${monthsText(toClose)} 마감 대기 — 마감하세요`, detail: toClose.length > 1 ? `${toClose.length}개월` : `팀원 입력 기한(${inputDeadlineLabel(toClose[0])}) 지남`, href: `/closing?ym=${toClose[0]}` });
  if (toSubmit.length) items.push({ key: "tosubmit", tone: "warn", title: `상신 대기 ${toSubmit.length}건`, detail: `${monthsText(toSubmit)} 마감됨 — 상신하세요`, href: `/closing?ym=${toSubmit[0]}` });

  // (h) 출입증 확정 전 내역 — 종류별로 하나씩 (달마다 쌓이지 않게), 앞으로의 달 제외, 링크는 가장 오래된 달
  const pass = (input.passChecks ?? []).filter((p) => p.ym <= now).sort((a, b) => a.ym.localeCompare(b.ym));
  const claims = pass.filter((p) => p.count > 0);
  const unmatchedMonths = pass.filter((p) => p.count === 0 && p.unmatched);
  const toConfirm = pass.filter((p) => p.count === 0 && !p.unmatched);
  if (claims.length) {
    items.push({
      key: "pass", tone: "warn", title: `출입증 팀원 요청 ${claims.reduce((a, p) => a + p.count, 0)}건`,
      detail: `${monthsText(claims.map((p) => p.ym))} — 업무 사용 표시를 확인하고 회사 부담 여부 결정`, href: `/pass?ym=${claims[0].ym}`,
    });
  }
  if (unmatchedMonths.length) {
    items.push({
      // 용어집: 업체 파일의 이름이 팀원과 연결되지 않음 = "연결 안 된 이름" (팀원이 하는 확인이 아니라 PM이 연결하는 일)
      key: "pass", tone: "warn", title: `출입증 연결 안 된 이름 ${unmatchedMonths.length}개월`,
      detail: `${monthsText(unmatchedMonths.map((p) => p.ym))} — 가장 오래된 달부터 팀원 지정`, href: `/pass?ym=${unmatchedMonths[0].ym}`,
    });
  }
  if (toConfirm.length) {
    // 팀원 "본인 부담 확인" 단계는 없다 (표시 없음 = 본인 부담) — 출입증 보드 단계(올리기 → 팀원 지정 → 회사 부담 결정 → 확정)와 같은 말로
    items.push({ key: "pass", tone: "info", title: `출입증 확정 전 ${toConfirm.length}개월`, detail: `${monthsText(toConfirm.map((p) => p.ym))} — 팀원 지정·회사 부담 결정 후 월 확정`, href: `/pass?ym=${toConfirm[0].ym}` });
  }

  // (b) 이번 달 입력이 없는 팀원 — 시작 준비가 끝난 뒤에만 (예산이 없으면 아무도 입력할 수 없다). 입력할 수 없는 팀원은 payers에 없다
  const entered = new Set(cur.filter((e) => !e.isHq).map((e) => e.payerId));
  const idle = payers.filter((p) => !entered.has(p.id));
  if (setupComplete(setup) && idle.length > 0) {
    items.push({ key: "noinput", tone: "info", title: `${monthText(ym)} 입력 없는 팀원 ${idle.length}명`, detail: nameList(idle.map((p) => p.name)), href: `/dashboard?ym=${ym}#settle` });
  }

  // (g) 재무 승인 대기
  const submitted = closings.filter((c) => c.status === "SUBMITTED").map((c) => c.yearMonth).sort();
  if (submitted.length) items.push({ key: "submitted", tone: "info", title: `재무 승인 대기 ${submitted.length}건`, detail: monthsText(submitted), href: `/closing?ym=${submitted[0]}` });

  return items;
}
