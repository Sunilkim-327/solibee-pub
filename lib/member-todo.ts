// 지출 입력 화면의 안내 배너(팀원·PM 공통) — 순수함수 (서버 import 없음)
// 우선순위: 반려·승인 취소 > 소명 필요 > 출입증 확인 > 입력 기한 지남 > 입력 기한 D-5. 한 번에 보이는 수는 maxShown까지, 나머지는 한 줄로 묶는다.
// 기한은 팀원 입력 기한(다음 달 3일, lib/month-phase) — 월말이 아니다.
import { ledgerHref, passCheckHref } from "./page-access";
import { monthsLabel, ymKo } from "./format";
import { inputDeadlineLabel } from "./month-phase";

/** 반려·승인 취소된 달 (팀원에게 사유와 함께 알림) */
export type RejectedMonth = { ym: string; note: string | null; revoked: boolean };

export type MemberNoticeInput = {
  /** 내 지출 내역의 달 (이번 달, 또는 아직 마감 전인 지난달) */
  ym: string;
  /** 그 달 내 지출 건수 — 0건일 때만 기한 독촉 */
  count: number;
  /** 그 달 소명 없는 규정 점검 건수 */
  unexplained: number;
  rejected: RejectedMonth[];
  /** 출입증 확인할 달 (팀원: 아직 열어 보지 않은 확정 전 달 / PM: 확정 전 달) */
  passMonths: string[];
  passName: string;
  /** PM 화면 — 출입증은 월 확정이 할 일이라 출입증 정산으로 보낸다 */
  pm?: boolean;
  /** 입력 기한까지 남은 날 (lib/month-phase daysToDeadline; 지났으면 음수, 앞으로의 달 등 안 따지면 null) */
  dDay: number | null;
  /** 입력할 수 있는 사람인지 — 아니면(지출 항목이 없는 팀원, PM이 입력) 기한 독촉을 하지 않는다 */
  canInput?: boolean;
};

export type MemberNotice = {
  key: "rejected" | "flag" | "pass" | "overdue" | "deadline";
  tone: "danger" | "warn" | "info";
  /** 굵은 제목 */
  title: string;
  /** 제목 뒤 한 줄 (선택) */
  detail?: string;
  /** 접힌 줄에 쓰는 짧은 이름 */
  short: string;
  href: string;
  /** 오른쪽 이동 글자 */
  action: string;
};

/** 기한 D-n 독촉을 시작하는 남은 날 */
export const DEADLINE_DAYS = 5;

const monthText = (ym: string) => `${Number(ym.slice(5))}월`;

/** 안내 목록 (우선순위 순, 자르기 전) */
export function buildMemberNotices(input: MemberNoticeInput): MemberNotice[] {
  const { ym, count, unexplained, rejected, passMonths, passName, pm = false, dDay, canInput = true } = input;
  const items: MemberNotice[] = [];

  for (const r of [...rejected].sort((a, b) => a.ym.localeCompare(b.ym))) {
    const what = r.revoked ? "승인 취소됨" : "반려";
    items.push({
      key: "rejected", tone: "danger",
      title: `${ymKo(r.ym)} ${what}`,
      detail: `${r.note ? `사유: ${r.note} · ` : ""}PM이 다시 상신하기 전에 내 지출을 확인하세요.`,
      short: `${monthText(r.ym)} ${what}`,
      href: ledgerHref(r.ym), action: `${monthText(r.ym)} 내역 확인 ›`,
    });
  }

  if (unexplained > 0) {
    items.push({
      key: "flag", tone: "warn",
      title: `소명 필요 ${unexplained}건`, detail: `${monthText(ym)} 규정 점검 건 — 수정에서 사유를 적으세요.`,
      short: `소명 필요 ${unexplained}건`, href: ledgerHref(ym, { check: "unexplained" }), action: "소명하기 ›",
    });
  }

  const pass = [...new Set(passMonths)].sort();
  if (pass.length) {
    items.push(pm
      ? {
          key: "pass", tone: "info",
          title: `${passName} 월 확정 전 ${pass.length}개월`, detail: monthsLabel(pass),
          short: `${passName} 확정 전 ${pass.length}개월`, href: `/pass?ym=${pass[0]}`, action: "출입증 정산 ›",
        }
      : {
          key: "pass", tone: "info",
          title: `${monthsLabel(pass)} ${passName} 사용 내역이 올라왔어요`, detail: "업무로 쓴 건에 '업무 사용'을 표시하세요. 표시 없으면 본인 부담(급여 공제).",
          short: `${passName} 확인 ${pass.length}개월`, href: passCheckHref(pass[0]), action: "확인 ›",
        });
  }

  // 기한 독촉 — 그 달에 아직 한 건도 입력하지 않은 사람에게만 (입력한 사람에게 매일 보이지 않게)
  if (canInput && count === 0 && dDay !== null) {
    if (dDay < 0 && !pm) {
      // 기한이 지난 달(마감 대기)은 팀원이 입력할 수 없다 — 빠진 건은 PM이 대신 입력
      items.push({
        key: "overdue", tone: "warn",
        title: `${monthText(ym)} 입력 기한(${inputDeadlineLabel(ym)})이 지났어요`, detail: "빠진 건은 PM에게 알려 주세요.",
        short: `${monthText(ym)} 기한 지남`, href: "", action: "",
      });
    } else if (dDay >= 0 && dDay <= DEADLINE_DAYS) {
      items.push({
        key: "deadline", tone: "warn",
        title: dDay === 0 ? "오늘이 입력 기한" : `입력 기한까지 D-${dDay}`, detail: `${monthText(ym)} 지출 0건 — ${inputDeadlineLabel(ym)}까지 입력하세요.`,
        short: dDay === 0 ? "오늘 입력 기한" : `입력 기한 D-${dDay}`, href: "", action: "",
      });
    }
  }

  return items;
}

/** 보일 것 maxShown개 + 접힌 나머지 */
export function splitNotices<T>(items: T[], maxShown: number): { shown: T[]; rest: T[] } {
  const n = Math.max(0, maxShown);
  return { shown: items.slice(0, n), rest: items.slice(n) };
}

/** 레이아웃에 전 화면 공통 알림(종료 대기)이 있으면 1개, 없으면 2개 */
export const maxNotices = (layoutAlert: boolean) => (layoutAlert ? 1 : 2);
