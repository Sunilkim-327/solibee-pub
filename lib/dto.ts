// 서버 → 클라이언트 컴포넌트로 넘기는 데이터 모양 (순수 타입, 런타임 코드 없음).
// 클라이언트 컴포넌트는 서버 모듈(lib/expenses·master·pass-server·orgchart) 대신 여기서 타입을 가져온다.
import type { PayMethod, Role } from "./types";

/** 지출 목록 행 (lib/expenses listExpenses) */
export type ExpenseRow = {
  id: string;
  payerId: string;
  payerName: string;
  /** 결제자 직급 (결제자 목록 정렬용) */
  payerPosition: string | null;
  date: string;
  amount: number;
  payMethod: PayMethod;
  categoryId: string;
  categoryName: string;
  itemId: string;
  itemName: string;
  detail: string;
  headcount: number | null;
  attendees: string | null;
  isHq: boolean;
  yearMonth: string;
  editable: boolean;
  projectId: string;
  projectName: string;
  hasExternal: boolean;
  flags: string | null;
  justification: string | null;
  merchant: string | null;
  changeId: string | null;
  /** 변경계약 과업 표시 (예: 변경 1차) */
  changeLabel: string | null;
  /** 대신 입력: 결제자가 아닌 사람이 입력했으면 입력한 사람 이름 (본인 입력이면 null) */
  enteredByName: string | null;
};

/** 분류/항목 마스터 (lib/master getMaster·getInputMaster) */
export type MasterCategory = {
  id: string;
  name: string;
  items: {
    id: string;
    name: string;
    keywords: string | null;
    accountCode: string | null;
    perPersonLimit: number | null;
    perCaseLimit: number | null;
    hardBudget: boolean;
    /** 카드 사용분 참석자·대상인원 필수 (공용 비용 항목은 false) */
    needsAttendees: boolean;
  }[];
};

/** 지출 입력 보조 정보 (lib/master getInputContext) */
export type InputContext = {
  /** 항목별 예산 잔액 (묶음이면 묶음 공동 잔액 — 묶인 항목 모두 같은 값) */
  remaining: Record<string, number>;
  /** 항목 → 예산 집계 키 (같은 묶음이면 같은 키). 수정 시 원래 금액을 되돌려 더할지 판단용 */
  budgetKeyOf: Record<string, string>;
  /** 매월 항목의 이번 달 월 예산·사용 (묶음이면 묶음 합계, 비정기 항목은 키 없음) — lib/input-budget monthBudgets */
  monthly?: Record<string, { budget: number; spent: number }>;
  /** monthly 기준 월 (YYYY-MM) */
  ym?: string;
  /** 프로젝트 기간 (YYYY-MM-DD) — 사용일 달력 범위 (서버 validateExpenseFields와 같은 기준) */
  period?: { start: string; end: string };
  /** 팀원 입력 기한(다음 달 3일, lib/month-phase)이 지난 달 (YYYY-MM, 프로젝트 기간 중 미래 아닌 달) — 팀원에게만, PM·재무 승인은 빈 배열. 폼은 마감된 달(lockedMonths)과 같은 방식으로 날짜 선택을 막는다 */
  deadlinePassedMonths?: string[];
  /** 프로젝트 기간의 달별 monthly — 지난달 사용일을 적을 때 그 달 기준 가용을 보이기 위해 (lib/input-budget monthBudgetsByYm) */
  monthlyByYm?: Record<string, Record<string, { budget: number; spent: number }>>;
  /** 프로젝트 팀원 이름 (재무 승인 제외) */
  people: string[];
  /** 로그인한 사람 이름 — 팀원 새 입력의 기본 참석자 */
  me: string;
  /** 협력 인력 표기 "홍길동(○○테크)" — 참석자 칩 (팀 전체에는 넣지 않음) */
  partners: string[];
  /** 내 최근 입력 (같은 항목·세부내역은 한 번만, 최대 5개) */
  recent: { itemId: string; detail: string; attendees: string | null; headcount: number | null; hasExternal: boolean; amount: number }[];
};

/** 출입증 사용 행 (lib/pass-server) */
export type PassUsageRow = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  itemId: string;
  itemName: string;
  amount: number;
  placeType: string;
  place: string | null;
  headcount: number | null;
  memo: string | null;
  editable: boolean;
};

/** 조직도 (lib/orgchart) */
export type OrgPerson = {
  id: string;
  name: string;
  /** 로그인 아이디 — 시스템 관리자 화면에서만 전달 (그 외에는 키 자체가 없음) */
  loginId?: string | null;
  position: string | null;
  /** 입사일 YYYY-MM-DD — 시스템 관리자에게만 */
  joinDate?: string | null;
  role: Role;
  departmentId: string | null;
  active: boolean;
  /** 사번 — 시스템 관리자에게만 */
  employeeNo?: string | null;
  external: boolean; // Soliday 등 외부 조직도에서 연동된 사용자
  projects: { name: string; isPm: boolean }[];
};
export type OrgDept = {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  order: number;
  depth: number;
  path: string;
  active: boolean;
  headId: string | null;
  headName: string | null;
  /** 프로젝트 체계도(EPS) 사용 — false면 프로젝트를 둘 수 없음 */
  epsEnabled: boolean;
};
export type OrgProject = {
  id: string;
  name: string;
  code: string | null;
  departmentId: string | null;
  parentId: string | null;
  period: [string, string];
  /** 표시용 기간 (일자까지) */
  dates: string;
  pms: string[];
  memberCount: number;
  /** 조회 권한이 있는 프로젝트만 금액·열기 제공 */
  accessible: boolean;
  planned: number | null;
  spent: number | null;
};

/** 출입증 내역 줄 (lib/pass-statement-server) */
export type PassLineRow = {
  /** 업체 (올릴 때 쓴 업체 서식, 없으면 업체 미지정) */
  vendor: string | null;
  id: string;
  /** 날짜 열이 없는 업체 양식이면 null */
  date: string | null;
  holderName: string;
  holderKey: string | null;
  place: string | null;
  amount: number;
  userId: string | null;
  userName: string | null;
  memberClaim: string | null;
  memberNote: string | null;
  decision: string | null;
  /** 회사 부담 항목 (팀원 요청 또는 PM 결정) */
  usageItemId: string | null;
  usageItemName: string | null;
  decisionSource: string | null;
  time: string | null;
  cardNo: string | null;
  empNo: string | null;
  company: string | null;
  item: string | null;
  sheetName: string | null;
  placeType: string | null;
  /** 외부인 사용 → PM 사용분 처리 시 실제 사용한 사람 */
  onBehalfName: string | null;
  collectFrom: string | null;
  collectedAt: string | null;
  collectNote: string | null;
  /** 업체 양식의 표시 열 (설정 순서) */
  extra: { label: string; value: string }[];
  /** 수량 (업체 파일의 수량 열이 2 이상일 때만, 아니면 null) — 줄 제목에 '2개'로 붙는다 */
  qty: number | null;
  /** 보조 연결 키 */
  keys: string[];
};

/** 출입증 내역 (월) */
export type PassStatementInfo = {
  id: string;
  yearMonth: string;
  fileName: string;
  uploadedAt: string;
  uploadedByName: string | null;
  status: "OPEN" | "CONFIRMED";
  confirmedAt: string | null;
  confirmedByName: string | null;
};
