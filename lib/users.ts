// 사용자 계정 관리 (시스템 관리자) — 생성·CSV 일괄등록 공통 검증
import { HttpError } from "./access";
import { tempPassword, tempPasswordExpiry } from "./auth-policy";
import { prisma } from "./db";
import { formatDate, parseDateOnly } from "./format";
import { loginIdProblem, toLoginId } from "./loginid";
import { hashPassword } from "./password";
import { parseRole, type Role } from "./types";
import { str } from "./validate";

export const USER_SELECT = {
  id: true,
  name: true,
  loginId: true,
  role: true,
  employeeNo: true,
  position: true,
  joinDate: true,
  departmentId: true,
  active: true,
  mustChangePassword: true,
  lockedUntil: true,
  lastLoginAt: true,
  tempPasswordExpiresAt: true,
  authProvider: true,
} as const;

export type UserInput = {
  name?: string;
  /** 아이디 = 회사 이메일 주소 */
  loginId?: string | null;
  role?: string;
  employeeNo?: string | null;
  position?: string | null;
  /** 입사일 YYYY-MM-DD */
  joinDate?: string | Date | null;
  departmentId?: string | null;
};

/** 일괄 등록용: 미리 읽어 둔 기존 아이디·사번·부서 (주면 행마다 DB를 조회하지 않는다) */
export type KnownUsers = { loginIds: Set<string>; employeeNos: Set<string>; departmentIds: Set<string> };

export async function validateUserInput(input: UserInput, existingId?: string, known?: KnownUsers) {
  const name = str(input.name, "이름", 60, { required: "이름을 입력하세요." });
  const position = str(input.position, "직급", 40) ?? null;
  const loginId = toLoginId(input.loginId);
  const employeeNo = input.employeeNo?.trim() || null;
  const idProblem = loginIdProblem(loginId);
  if (idProblem) throw new HttpError(400, idProblem);
  const role = parseRole(input.role);
  if (!role) throw new HttpError(400, `역할이 올바르지 않습니다 (팀원·프로젝트 PM·재무 승인·시스템 관리자 중 하나): ${input.role ?? ""}`);
  if (employeeNo && !/^[A-Za-z0-9-]{2,20}$/.test(employeeNo)) throw new HttpError(400, `사번 형식이 올바르지 않습니다: ${employeeNo}`);
  if (known && !existingId) {
    if (known.loginIds.has(loginId)) throw new HttpError(409, `이미 사용 중인 아이디입니다: ${loginId}`);
    if (employeeNo && known.employeeNos.has(employeeNo)) throw new HttpError(409, `이미 등록된 사번입니다: ${employeeNo}`);
  } else {
    const dup = await prisma.user.findFirst({
      where: {
        OR: [{ loginId }, ...(employeeNo ? [{ employeeNo }] : [])],
        ...(existingId ? { NOT: { id: existingId } } : {}),
      },
    });
    if (dup) throw new HttpError(409, dup.loginId === loginId ? `이미 사용 중인 아이디입니다: ${loginId}` : `이미 등록된 사번입니다: ${employeeNo}`);
  }
  const joinRaw = input.joinDate instanceof Date ? formatDate(input.joinDate) : input.joinDate?.trim() || null;
  const joinDate = joinRaw ? parseDateOnly(joinRaw) : null;
  if (joinRaw && !joinDate) throw new HttpError(400, `입사일 형식이 올바르지 않습니다: ${joinRaw}`);
  if (input.departmentId && !(known && !existingId ? known.departmentIds.has(input.departmentId) : await prisma.department.findUnique({ where: { id: input.departmentId } }))) {
    throw new HttpError(400, "부서를 찾을 수 없습니다.");
  }
  return {
    name,
    loginId,
    role,
    employeeNo,
    position,
    joinDate,
    departmentId: input.departmentId || null,
  };
}

/** 계정 생성 — 임시 비밀번호를 발급하고 첫 로그인 시 변경을 강제한다. 임시 비밀번호는 응답으로 한 번만 보여준다. */
export async function createUser(input: UserInput, known?: KnownUsers) {
  const data = await validateUserInput(input, undefined, known);
  const password = tempPassword();
  const user = await prisma.user.create({
    data: { ...data, passwordHash: hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempPasswordExpiry() },
    select: USER_SELECT,
  });
  return { user, tempPassword: password };
}

/** 간단한 CSV 파서 (따옴표·쉼표 포함 값 지원) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell.trim()), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

// CSV 역할 값 → 역할 코드. 새 라벨(시스템 관리자·재무 승인·프로젝트 PM·팀원)과 옛 값(관리자·재무팀·재무·PM·팀장·프로젝트 팀원)을 모두 받는다
const ROLE_ALIASES: Record<string, Role> = {
  "시스템 관리자": "ADMIN", 관리자: "ADMIN", ADMIN: "ADMIN",
  "재무 승인": "HQ", 재무팀: "HQ", 재무: "HQ", HQ: "HQ", FINANCE: "HQ",
  "프로젝트 PM": "MANAGER", PM: "MANAGER", 팀장: "MANAGER", MANAGER: "MANAGER",
  팀원: "MEMBER", "프로젝트 팀원": "MEMBER", MEMBER: "MEMBER",
};

export function roleFromText(v: string): Role | undefined {
  return ROLE_ALIASES[v.trim().toUpperCase()] ?? ROLE_ALIASES[v.trim()];
}
