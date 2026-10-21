// 마스터 관리 화면 공용 타입
import type { AdminUser } from "../AdminDirectory";
import type { ProjectPhase } from "@/lib/lifecycle";

export type Item = {
  id: string;
  projectId: string | null;
  code: string | null;
  name: string;
  accountCode: string | null;
  keywords: string | null;
  active: boolean;
  perPersonLimit: number | null;
  perCaseLimit: number | null;
  hardBudget: boolean;
  /** 카드 사용분 참석자 필수 (공용 지출 항목은 false) */
  needsAttendees: boolean;
  /** 공통 항목: 새 프로젝트 기본 포함 */
  isDefault: boolean;
};
export type Category = { id: string; name: string; items: Item[] };
/** PM 후보·팀원 표시용 사람 (계정 관리 정보는 넘기지 않는다 — app/(dashboard)/master/data.ts loadPeople) */
export type User = Pick<AdminUser, "id" | "name" | "loginId" | "role" | "position" | "departmentId" | "active">;
export type Project = {
  id: string;
  name: string;
  code: string | null;
  departmentName: string | null;
  departmentId: string | null;
  startDate: string;
  endDate: string;
  parentId: string | null;
  /** 상위(메인) 프로젝트와 함께 상신 (lib/settle-group.ts) */
  settleWithParent: boolean;
  /** 상신 엑셀 구분명 (예: 운영·대응) */
  excelPrefix: string | null;
  depth: number;
  members: { userId: string; isPayer: boolean; isPm: boolean }[];
  phase: ProjectPhase;
  phaseLabel: string;
  seriesName: string | null;
  round: number | null;
  closed: boolean;
  archived: boolean;
  budgetItems: { id: string; name: string }[];
  budgetLineCount: number;
  passEnabled: boolean;
  passName: string | null;
};
