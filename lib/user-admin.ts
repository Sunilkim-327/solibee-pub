// 시스템 관리자 사용자 목록 — 계정 상태·필터·임시 비밀번호 CSV (순수함수, 클라이언트에서도 사용)
import { descendantIds, type Dept } from "./org";

export type AccountStatus = "INACTIVE" | "LOCKED" | "NOT_ISSUED" | "TEMP" | "TEMP_EXPIRED" | "IN_USE";

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  NOT_ISSUED: "미발급",
  TEMP: "임시 비밀번호",
  TEMP_EXPIRED: "임시 만료",
  LOCKED: "잠김",
  INACTIVE: "비활성",
  IN_USE: "사용 중",
};

export const ACCOUNT_STATUSES: AccountStatus[] = ["NOT_ISSUED", "TEMP", "TEMP_EXPIRED", "LOCKED", "INACTIVE", "IN_USE"];

type DateLike = string | Date | null | undefined;
const time = (d: DateLike) => (d == null ? null : new Date(d).getTime());

export type AccountLike = {
  active: boolean;
  mustChangePassword: boolean;
  lockedUntil: DateLike;
  tempPasswordExpiresAt: DateLike;
};

/**
 * 계정 상태
 * - 비활성 > 잠김 > 비밀번호 상태 순으로 판단
 * - 미발급: 첫 로그인 전인데 임시 비밀번호를 발급한 적 없음 (조직도 연동 계정은 만료 시각이 epoch 0)
 */
export function accountStatus(u: AccountLike, now: Date = new Date()): AccountStatus {
  if (!u.active) return "INACTIVE";
  const locked = time(u.lockedUntil);
  if (locked !== null && locked > now.getTime()) return "LOCKED";
  if (u.mustChangePassword) {
    const exp = time(u.tempPasswordExpiresAt);
    if (exp === null || exp <= 0) return "NOT_ISSUED";
    return exp > now.getTime() ? "TEMP" : "TEMP_EXPIRED";
  }
  return "IN_USE";
}

export type UserFilter = { q?: string; deptId?: string; role?: string; status?: AccountStatus | ""; includeInactive?: boolean };

/** 사용자 목록 필터 — 부서는 하위 부서 포함 */
export function filterUsers<
  U extends AccountLike & { name: string; loginId: string | null; employeeNo: string | null; departmentId: string | null; role: string },
>(users: U[], depts: Dept[], f: UserFilter, now: Date = new Date()): U[] {
  const q = f.q?.trim().toLowerCase();
  const inDept = f.deptId ? descendantIds(depts, f.deptId) : null;
  return users.filter((u) => {
    const status = accountStatus(u, now);
    // 상태 필터로 '비활성'을 고르면 비활성 포함 여부와 관계없이 표시
    if (f.status) {
      if (status !== f.status) return false;
    } else if (!f.includeInactive && !u.active) return false;
    if (f.role && u.role !== f.role) return false;
    if (inDept && !(u.departmentId && inDept.has(u.departmentId))) return false;
    if (q && !`${u.name} ${u.loginId ?? ""} ${u.employeeNo ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// 엑셀이 수식으로 읽는 첫 글자(= + - @ 탭 CR)는 작은따옴표를 붙여 글자로 (CSV 수식 주입 방지)
const csvCell = (raw: string) => {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** 임시 비밀번호 전달용 CSV (엑셀에서 한글이 깨지지 않도록 UTF-8 BOM) */
export function tempPasswordCsv(rows: { name: string; loginId: string; tempPassword: string; expiresAt?: string | null }[]): string {
  const header = ["이름", "아이디(이메일)", "임시 비밀번호", "만료 시각"];
  const lines = rows.map((r) =>
    [r.name, r.loginId, r.tempPassword, r.expiresAt ? formatDateTime(r.expiresAt) : ""].map(csvCell).join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** YYYY-MM-DD HH:mm (로컬 시각) */
export function formatDateTime(d: string | Date): string {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

export const BULK_RESET_MAX = 200;

export type ProjectSetupInput = {
  budgetLines: number;
  members: { isPm: boolean }[];
};
export type SetupIssue = "NO_BUDGET" | "NO_PM";
export const SETUP_ISSUE_LABEL: Record<SetupIssue, string> = {
  NO_BUDGET: "예산 미등록",
  NO_PM: "PM 미지정",
};

/**
 * 프로젝트 시작 준비 미비 항목 — 예산과 PM만 (PM이 입력할 수 있으면 운영 가능).
 * 팀원 등록·팀원 지출 항목은 팀원도 입력하는 프로젝트만 필요한 선택 사항이라 '준비 필요'로 세지 않는다 (PM만 입력하는 프로젝트도 정상)
 */
export function projectSetupIssues(p: ProjectSetupInput): SetupIssue[] {
  const out: SetupIssue[] = [];
  if (p.budgetLines === 0) out.push("NO_BUDGET");
  if (!p.members.some((m) => m.isPm)) out.push("NO_PM");
  return out;
}
