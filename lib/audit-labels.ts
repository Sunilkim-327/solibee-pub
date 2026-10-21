// 접속·변경 기록 화면의 표시 이름과 조회 기간 — 순수함수
import { formatDate, parseDateOnly } from "./format";

/** 작업(action) 표시 이름 */
export const AUDIT_ACTION: Record<string, string> = {
  // 접속·계정
  login: "로그인", logout: "로그아웃", "refresh-reuse": "리프레시 토큰 재사용 감지 (전체 로그아웃)", "login-fail": "로그인 실패", "login-blocked": "잠긴 계정 로그인 시도", locked: "계정 잠김",
  "password-reset": "임시 비밀번호 발급", password: "비밀번호 변경", "password-fail": "비밀번호 변경 실패", deactivate: "계정 비활성화", unlock: "잠금 해제",
  // 공통
  create: "등록", update: "수정", delete: "삭제", replace: "일괄 저장", import: "CSV 일괄 등록", download: "엑셀 다운로드",
  rename: "이름 변경", move: "순서 이동", "import-parent": "메인 항목 가져오기",
  // 마감·상신
  close: "월 마감", reopen: "마감 해제", submit: "상신", approve: "승인", reject: "반려", revoke: "승인 취소", remind: "입력·소명 요청 알림",
  "approval-ref": "결재 문서번호 수정", "snapshot-fail": "상신본·승인본 저장 실패",
  // 프로젝트 생애주기
  "lifecycle-close": "프로젝트 종료", "lifecycle-reopen": "프로젝트 종료 취소", "lifecycle-archive": "프로젝트 보관", "lifecycle-unarchive": "프로젝트 보관 해제",
  "next-round": "다음 연차 생성", "restore-end": "종료일 되돌림",
  // 변경계약
  items: "과업 항목 설정",
  // 출입증
  upload: "업체 내역 올림", "delete-lines": "올린 내역 삭제", reupload: "업체 내역 다시 올림", confirm: "확정", collect: "외부인 수금 기록",
  "assume-external": "외부인 건 PM 사용분으로", "undo-external": "외부인 건 되돌림",
  "accept-claims": "회사 부담 요청 수락", "all-overtime": "전체 회사 부담", "rest-deduct": "나머지 본인 부담", clear: "결정 지우기 (미결정으로)",
  "member:personal": "팀원 · 본인 부담으로 확인 (일괄)", "member:personal-clear": "팀원 · 본인 부담 확인 해제 (일괄)",
  // 조직도 연동
  sync: "조직도 동기화", push: "조직도 수신", "push-link": "연동 토큰 발급",
};

/** 대상(entity) 표시 이름 */
export const AUDIT_ENTITY: Record<string, string> = {
  Auth: "접속", User: "사용자", Department: "부서", Directory: "조직도 연동",
  Project: "프로젝트", ProjectMember: "프로젝트 팀원", ProjectPartner: "협력사", ContractChange: "변경계약",
  Item: "항목", Category: "분류", MemberItem: "팀원 지출 항목",
  Expense: "지출", BudgetLine: "예산", MonthlyClosing: "마감", ClosingSnapshot: "상신본·승인본",
  PassStatement: "출입증 내역", PassImportProfile: "출입증 업체 서식", PassStatementLine: "출입증 사용", ClientPassUsage: "출입증(이전 방식)",
  Reminder: "입력·소명 요청",
  Export: "다운로드",
};

/** 조회 구분 → 대상 목록 */
export const AUDIT_GROUPS: Record<string, string[]> = {
  access: ["Auth"],
  admin: ["User", "Department", "Directory", "Project", "ProjectMember", "ProjectPartner", "ContractChange", "Item", "Category"],
  data: ["Expense", "BudgetLine", "MonthlyClosing", "ClosingSnapshot", "MemberItem", "PassStatement", "PassImportProfile", "PassStatementLine", "ClientPassUsage", "Reminder"],
  download: ["Export"],
};

const own = (m: Record<string, string>, k: string) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined);

export function auditActionLabel(action: string): string {
  const label = own(AUDIT_ACTION, action);
  if (label) return label;
  // 일괄 작업: "bulk:accept-claims" → "일괄 · 회사 부담 요청 수락"
  if (action.startsWith("bulk:")) {
    const rest = action.slice(5);
    return `일괄 · ${own(AUDIT_ACTION, rest) ?? rest}`;
  }
  return action;
}

export const auditEntityLabel = (entity: string) => own(AUDIT_ENTITY, entity) ?? entity;

const KST_MS = 9 * 3600_000;
const DAY_MS = 86400_000;

/** KST 기준 오늘 날짜 "YYYY-MM-DD" */
export const kstToday = (now: Date) => formatDate(new Date(now.getTime() + KST_MS));

/**
 * 조회 기간 (KST 날짜 기준). 잘못된 값은 기본값(오늘까지 30일)으로.
 * from > to 이면 서로 바꾼다.
 */
export function auditRange(fromStr: string | undefined, toStr: string | undefined, now = new Date()) {
  const to = parseDateOnly(toStr) ?? parseDateOnly(kstToday(now))!;
  let from = parseDateOnly(fromStr) ?? new Date(to.getTime() - 30 * DAY_MS);
  let end = to;
  if (from > end) [from, end] = [end, from];
  return {
    fromDay: formatDate(from),
    toDay: formatDate(end),
    // UTC 자정 기준 날짜를 KST 하루 구간으로
    gte: new Date(from.getTime() - KST_MS),
    lte: new Date(end.getTime() + DAY_MS - KST_MS - 1),
  };
}
