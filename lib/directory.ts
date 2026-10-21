// 조직도 연동 — Soliday(hr.example.com) 부서·임직원 → 앱 부서·사용자
// 매칭 키: 부서 = Soliday 부서 id(externalId) → 부서코드(code), 사용자 = Soliday 임직원 id(externalId) → 이메일
// (Soliday에는 사번이 비어 있어 사번 매칭은 쓰지 않는다.) 성명·직급·이메일·입사일만 저장하고 휴대폰 등은 저장하지 않는다(최소 수집).
import { formatDate } from "./format";

export const DIRECTORY_SOURCE = "soliday";

// ── Soliday 응답 형식 (/api/departments, /api/org/employees) ──
export type SolidayDepartment = {
  id: string;
  departmentCode: string;
  departmentName: string;
  departmentLevel?: number | null;
  departmentOrder?: number | null;
  parentId?: string | null;
  hidden?: boolean;
};
export type SolidayEmployee = {
  id: string;
  fullName: string;
  emailAddress: string;
  employeeNumber?: string | null;
  employeeStatus?: string | null;
  joinDate?: string | null;
  department?: { departmentCode: string; departmentName?: string } | null;
  title?: { titleName?: string | null } | null;
};

// ── 정규화된 원본 ──
export type SrcDept = { externalId: string; code: string; name: string; parentExternalId: string | null; level: number | null; order: number; active: boolean };
export type SrcUser = { externalId: string; name: string; email: string; loginId: string; employeeNo: string | null; deptCode: string | null; position: string | null; joinDate: string | null; status: string; active: boolean };

const ACTIVE_STATUSES = new Set(["ACTIVE", "ON_LEAVE"]); // 휴직자는 계정 유지

/** 응답 본문(배열 또는 {departments}/{employees} 래핑)을 꺼낸다 */
export function unwrap<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  const v = (body as Record<string, unknown> | null)?.[key];
  if (Array.isArray(v)) return v as T[];
  throw new Error(`${key} 목록을 찾을 수 없습니다.`);
}

export function normalizeSoliday(depts: SolidayDepartment[], emps: SolidayEmployee[]): { departments: SrcDept[]; users: SrcUser[] } {
  const departments = depts
    .filter((d) => d.id && d.departmentCode && d.departmentName)
    .map((d, i) => ({
      externalId: d.id,
      code: d.departmentCode.trim(),
      name: d.departmentName.trim(),
      parentExternalId: d.parentId ?? null,
      level: d.departmentLevel ?? null,
      order: typeof d.departmentOrder === "number" ? d.departmentOrder : i,
      active: !d.hidden,
    }));
  const users = emps
    .filter((e) => e.id && e.fullName && e.emailAddress)
    .map((e) => {
      const status = e.employeeStatus ?? "ACTIVE";
      return {
        externalId: e.id,
        name: e.fullName.trim(),
        email: e.emailAddress.trim().toLowerCase(),
        loginId: e.emailAddress.trim().toLowerCase(), // 아이디 = 이메일 주소
        employeeNo: e.employeeNumber?.trim() || null,
        deptCode: e.department?.departmentCode ?? null,
        position: e.title?.titleName?.trim() || null,
        joinDate: e.joinDate ? e.joinDate.slice(0, 10) : null,
        status,
        active: ACTIVE_STATUSES.has(status),
      };
    });
  return { departments, users };
}

// ── 변경 계획 (순수함수) ──
export type ExDept = { id: string; code: string | null; name: string; parentId: string | null; order: number; active: boolean; externalId: string | null; level: number | null };
export type ExUser = {
  id: string;
  name: string;
  email: string | null;
  loginId: string | null;
  employeeNo: string | null;
  departmentId: string | null;
  position: string | null;
  joinDate: Date | null;
  active: boolean;
  externalId: string | null;
  externalSource: string | null;
  employmentStatus: string | null;
};

export type SyncPlan = {
  departments: { create: SrcDept[]; update: { id: string; src: SrcDept; changes: string[] }[]; deactivate: ExDept[] };
  users: { create: SrcUser[]; update: { id: string; src: SrcUser; changes: string[] }[]; deactivate: ExUser[] };
  warnings: string[];
};

export function planSync(src: { departments: SrcDept[]; users: SrcUser[] }, ex: { departments: ExDept[]; users: ExUser[] }): SyncPlan {
  const warnings: string[] = [];
  const deptByExt = new Map(ex.departments.filter((d) => d.externalId).map((d) => [d.externalId!, d]));
  const deptByCode = new Map(ex.departments.filter((d) => d.code).map((d) => [d.code!, d]));
  const srcByExt = new Map(src.departments.map((d) => [d.externalId, d]));

  const plan: SyncPlan = { departments: { create: [], update: [], deactivate: [] }, users: { create: [], update: [], deactivate: [] }, warnings };

  // 부서: externalId → 부서코드 순으로 매칭
  const matchedDept = new Set<string>();
  for (const d of src.departments) {
    const cur = deptByExt.get(d.externalId) ?? deptByCode.get(d.code);
    if (!cur) {
      plan.departments.create.push(d);
      continue;
    }
    matchedDept.add(cur.id);
    const parentCur = d.parentExternalId ? deptByExt.get(d.parentExternalId) ?? deptByCode.get(srcByExt.get(d.parentExternalId)?.code ?? "") : null;
    const changes: string[] = [];
    if (cur.name !== d.name) changes.push("부서명");
    if (cur.code !== d.code) changes.push("부서코드");
    if (cur.externalId !== d.externalId) changes.push("연동키");
    if (cur.active !== d.active) changes.push(d.active ? "사용" : "사용 중지");
    if (cur.order !== d.order || cur.level !== d.level) changes.push("순서");
    // 상위 부서가 새로 만들어지는 경우(parentCur 없음)도 변경으로 본다
    if ((parentCur?.id ?? null) !== cur.parentId || (d.parentExternalId && !parentCur)) changes.push("상위부서");
    if (changes.length) plan.departments.update.push({ id: cur.id, src: d, changes });
  }
  // 원본에 없는 연동 부서는 사용 중지 (자체 생성 부서는 그대로)
  for (const d of ex.departments) {
    if (!matchedDept.has(d.id) && d.externalId && d.active) plan.departments.deactivate.push(d);
  }

  // 사용자: externalId → 아이디 → 이메일 순으로 매칭
  const userByExt = new Map(ex.users.filter((u) => u.externalId).map((u) => [u.externalId!, u]));
  const userByLogin = new Map(ex.users.filter((u) => u.loginId).map((u) => [u.loginId!.toLowerCase(), u]));
  const userByEmail = new Map(ex.users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]));
  const seenLogin = new Set<string>();
  const seenEmail = new Set<string>();
  const matchedUser = new Set<string>();
  const deptCodeToId = new Map(ex.departments.filter((d) => d.code).map((d) => [d.code!, d.id]));
  for (const u of src.users) {
    if (seenEmail.has(u.email)) {
      warnings.push(`이메일 중복으로 건너뜀: ${u.email}`);
      continue;
    }
    seenEmail.add(u.email);
    if (seenLogin.has(u.loginId)) {
      warnings.push(`아이디 중복으로 건너뜀: ${u.loginId} (${u.name})`);
      continue;
    }
    seenLogin.add(u.loginId);
    const cur = userByExt.get(u.externalId) ?? userByLogin.get(u.loginId) ?? userByEmail.get(u.email);
    // 다른 사람이 이미 쓰는 아이디면 건너뛴다
    const owner = userByLogin.get(u.loginId);
    if (owner && cur && owner.id !== cur.id) {
      warnings.push(`아이디 ${u.loginId}를 다른 계정이 사용 중이라 건너뜀 (${u.name})`);
      continue;
    }
    if (!cur) {
      plan.users.create.push(u);
      continue;
    }
    matchedUser.add(cur.id);
    const changes: string[] = [];
    if (cur.name !== u.name) changes.push("이름");
    if (cur.email !== u.email) changes.push("이메일");
    if (cur.loginId !== u.loginId) changes.push("아이디");
    if (cur.position !== u.position) changes.push("직급");
    if ((cur.joinDate ? formatDate(cur.joinDate) : null) !== u.joinDate) changes.push("입사일");
    if (cur.externalId !== u.externalId) changes.push("연동키");
    if (cur.employmentStatus !== u.status) changes.push("재직상태");
    if (cur.active !== u.active) changes.push(u.active ? "활성화" : "비활성화");
    if (u.employeeNo && cur.employeeNo !== u.employeeNo) changes.push("사번");
    const deptId = u.deptCode ? deptCodeToId.get(u.deptCode) ?? null : null;
    if ((u.deptCode && !deptId) || (deptId && deptId !== cur.departmentId)) changes.push("부서");
    if (changes.length) plan.users.update.push({ id: cur.id, src: u, changes });
  }
  // 이전에 연동됐는데 이번 원본에 없는 사용자 → 비활성화 (퇴사). 앱 자체 계정(시스템 관리자 등)은 건드리지 않는다.
  for (const u of ex.users) {
    if (!matchedUser.has(u.id) && u.externalSource === DIRECTORY_SOURCE && u.active) plan.users.deactivate.push(u);
  }
  return plan;
}

export function summarize(plan: SyncPlan) {
  return {
    departments: { create: plan.departments.create.length, update: plan.departments.update.length, deactivate: plan.departments.deactivate.length },
    users: { create: plan.users.create.length, update: plan.users.update.length, deactivate: plan.users.deactivate.length },
    warnings: plan.warnings,
  };
}

/** 재무 승인 권한을 받는 부서 (부서명 기준 — 실제 부서명이라 바꾸지 않는다) */
export const FINANCE_DEPT_NAMES = ["재무회계팀", "재무팀"];

/**
 * 기본 권한: 재무회계팀 소속 → 재무 승인(HQ), 그 외 → 팀원.
 * PM은 직급(팀장 등)과 무관 — 재무 승인 담당이 프로젝트 PM으로 지정하면 PM 권한이 자동 부여된다.
 * 이미 있는 계정의 권한은 연동 때 바꾸지 않는다.
 */
export function defaultRole(x: { position: string | null; deptName: string | null }): "HQ" | "MANAGER" | "MEMBER" {
  if (x.deptName && FINANCE_DEPT_NAMES.includes(x.deptName.trim())) return "HQ";
  return "MEMBER";
}

/**
 * 기본 규칙(직급·부서)과 다른 권한이면 그 권한을 돌려준다 — 조직도 카드에 이것만 표시.
 * 예) PM → "MANAGER", 재무회계팀 소속이 아닌 재무 승인 권한 → "HQ", 시스템 관리자 → "ADMIN".
 * 기본 권한이거나 팀원이면 null (표시하지 않음).
 */
export function nonDefaultRole(x: { role: string; position: string | null; deptName: string | null }): "HQ" | "MANAGER" | "ADMIN" | null {
  if (x.role === "MEMBER" || x.role === defaultRole(x)) return null;
  return x.role as "HQ" | "MANAGER" | "ADMIN";
}

/** 조직 종류별 조직장 직급: 부서명 끝말 → 조직장이 될 직급 */
export const HEAD_RULES = [
  { suffix: "팀", title: "팀장" },
  { suffix: "본부", title: "본부장" },
  { suffix: "그룹", title: "그룹장" },
] as const;
const HEAD_TITLES: readonly string[] = HEAD_RULES.map((r) => r.title);
export const headTitleFor = (deptName: string) => HEAD_RULES.find((r) => deptName.trim().endsWith(r.suffix))?.title ?? null;

export type HeadIssue = { deptId: string; name: string; title: string; leaders: string[] };
export type OrgHeadPlan = {
  assign: { deptId: string; userId: string }[];
  /** 조직장 직급(팀장·본부장·그룹장)인 사람이 없는 조직 */
  noLeader: HeadIssue[];
  /** 조직장 직급인 사람이 2명 이상 — 자동 지정하지 않음 */
  multiple: HeadIssue[];
  /** 조직 종류와 맞지 않는 곳에 있는 조직장 직급 (예: 그룹에 있는 팀장, 실에 있는 본부장) — 자동 지정하지 않음 */
  mismatched: HeadIssue[];
};

/**
 * 조직장 자동 지정: 팀 → 팀장, 본부 → 본부장, 그룹 → 그룹장 (재직 중, 1명일 때만).
 * 이미 조직장이 지정된 조직은 건드리지 않는다.
 */
export function planOrgHeads(
  depts: { id: string; name: string; active: boolean; headId: string | null }[],
  users: { id: string; name: string; position: string | null; departmentId: string | null; active: boolean }[],
): OrgHeadPlan {
  const plan: OrgHeadPlan = { assign: [], noLeader: [], multiple: [], mismatched: [] };
  const byDept = new Map<string, { id: string; name: string; position: string }[]>();
  for (const u of users) {
    const pos = u.position?.trim() ?? "";
    if (!u.active || !u.departmentId || !HEAD_TITLES.includes(pos)) continue;
    byDept.set(u.departmentId, [...(byDept.get(u.departmentId) ?? []), { id: u.id, name: u.name, position: pos }]);
  }
  for (const d of depts) {
    if (!d.active) continue;
    const people = byDept.get(d.id) ?? [];
    const title = headTitleFor(d.name);
    const fit = title ? people.filter((p) => p.position === title) : [];
    const others = people.filter((p) => p.position !== title);
    for (const t of new Set(others.map((o) => o.position))) {
      plan.mismatched.push({ deptId: d.id, name: d.name, title: t, leaders: others.filter((o) => o.position === t).map((o) => o.name) });
    }
    if (!title || d.headId) continue;
    const issue = { deptId: d.id, name: d.name, title, leaders: fit.map((l) => l.name) };
    if (fit.length === 1) plan.assign.push({ deptId: d.id, userId: fit[0].id });
    else if (fit.length === 0) plan.noLeader.push(issue);
    else plan.multiple.push(issue);
  }
  return plan;
}
