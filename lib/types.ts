export const ROLES = ["MEMBER", "MANAGER", "HQ", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  MEMBER: "팀원",
  MANAGER: "프로젝트 PM",
  HQ: "재무 승인",
  ADMIN: "시스템 관리자",
};

export const PAY_METHODS = ["PERSONAL_CARD", "SHARED_CARD", "HQ"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

/** 화면 표시용 결제방법 이름 */
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  PERSONAL_CARD: "개인 법인카드",
  SHARED_CARD: "공용 법인카드",
  HQ: "본사",
};

/** 엑셀 출력용 결제방법 값 — 기존 상신 양식(데이터 유효성 목록)과 같아야 한다 */
export const PAY_METHOD_EXCEL_LABEL: Record<PayMethod, string> = {
  PERSONAL_CARD: "개인식법인카드",
  SHARED_CARD: "공용법인카드",
  HQ: "본사지출",
};

export const CLOSING_STATUSES = ["DRAFT", "CLOSED", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export type ClosingStatus = (typeof CLOSING_STATUSES)[number];

export const CLOSING_LABEL: Record<ClosingStatus, string> = {
  DRAFT: "작성중",
  CLOSED: "마감",
  SUBMITTED: "상신",
  APPROVED: "승인",
  REJECTED: "반려",
};

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** DB 문자열 → 역할 (알 수 없으면 null) */
export const parseRole = (v: unknown): Role | null => (isOneOf(ROLES, v) ? v : null);
/** DB 문자열 → 결제방법 (알 수 없으면 null) */
export const parsePayMethod = (v: unknown): PayMethod | null => (isOneOf(PAY_METHODS, v) ? v : null);
/** DB 문자열 → 마감 상태 (없거나 알 수 없으면 작성중) */
export const parseClosingStatus = (v: unknown): ClosingStatus => (isOneOf(CLOSING_STATUSES, v) ? v : "DRAFT");
