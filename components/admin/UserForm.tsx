"use client";

import { DateField } from "../DatePicker";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/types";
import { DeptSelect, type Dept } from "./DeptSelect";
import { useConfirm } from "../ConfirmDialog";

/** 사용자 입력값 (빈 문자열 = 미입력) */
export type UserValues = { name: string; loginId: string; employeeNo: string; position: string; joinDate: string; departmentId: string; role: Role };

type UserLike = { name: string; loginId?: string | null; employeeNo?: string | null; position: string | null; joinDate?: string | null; departmentId: string | null; role: Role };

export function userValues(u: UserLike | null, defaultDept = ""): UserValues {
  return {
    name: u?.name ?? "",
    loginId: u?.loginId ?? "",
    employeeNo: u?.employeeNo ?? "",
    position: u?.position ?? "",
    joinDate: u?.joinDate?.slice(0, 10) ?? "",
    departmentId: u ? u.departmentId ?? "" : defaultDept,
    role: u?.role ?? "MEMBER",
  };
}

/** 저장 요청 본문 */
export function userPayload(v: UserValues) {
  return { ...v, employeeNo: v.employeeNo || null, position: v.position || null, joinDate: v.joinDate || null, departmentId: v.departmentId || null };
}

/** PATCH /api/admin/users/:id 응답 (임시 비밀번호 발급 시) */
export type UserPatchResult = { tempPassword?: string; user?: { tempPasswordExpiresAt?: string | null } };

/** 사용자 정보 입력칸 — 이름 · 직급 · 아이디 · 부서 · 입사일 · 사번 · 서비스 권한 */
export function UserFields({ value: v, onChange, depts }: { value: UserValues; onChange: (v: UserValues) => void; depts: Dept[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block"><span className="label">이름 *</span><input className="input" value={v.name} onChange={(e) => onChange({ ...v, name: e.target.value })} /></label>
      <label className="block"><span className="label">직급</span><input className="input" placeholder="예) 책임" value={v.position} onChange={(e) => onChange({ ...v, position: e.target.value })} /></label>
      <label className="block sm:col-span-2"><span className="label">아이디 (회사 이메일) *</span><input className="input" type="email" placeholder="예) hong@example.com" value={v.loginId} onChange={(e) => onChange({ ...v, loginId: e.target.value })} /></label>
      <label className="block"><span className="label">부서</span><DeptSelect depts={depts} value={v.departmentId} onChange={(departmentId) => onChange({ ...v, departmentId })} /></label>
      <div className="block"><span className="label">입사일</span><DateField value={v.joinDate} onChange={(d) => onChange({ ...v, joinDate: d })} clearable /></div>
      <label className="block"><span className="label">사번</span><input className="input" placeholder="선택" value={v.employeeNo} onChange={(e) => onChange({ ...v, employeeNo: e.target.value })} /></label>
      <div className="block sm:col-span-2"><span className="label">서비스 권한</span>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface-muted p-1" role="radiogroup" aria-label="서비스 권한">
          {ROLES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={v.role === r} onClick={() => onChange({ ...v, role: r })}
              className={`rounded-lg py-2 text-sm ${v.role === r ? "bg-surface font-bold shadow-sm" : "text-fg-muted"}`}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
        <span className="mt-1 block text-xs text-fg-subtle">재무회계팀 소속은 기본으로 재무 승인입니다. 프로젝트 PM은 기준 정보에서 PM으로 지정하면 자동 부여됩니다.</span>
      </div>
    </div>
  );
}

export type AccountAction = "resetPassword" | "unlock" | "toggleActive";

/**
 * 계정 동작 버튼 — 임시 비밀번호 발급 · 잠금 해제 · 비활성화/활성화.
 * 파괴적 동작(발급·비활성화)은 확인 후 onAction을 부른다.
 * locked: undefined면 잠금 여부를 몰라 잠금 해제 버튼을 항상 보인다.
 */
export function UserAccountActions({ user, locked, busy, onAction, className = "flex flex-wrap gap-2" }: {
  user: { name: string; active: boolean }; locked?: boolean; busy: boolean; onAction: (a: AccountAction) => void; className?: string;
}) {
  const { confirm, dialog } = useConfirm();
  return (
    <div className={className}>
      {dialog}
      <button className="btn-secondary" disabled={busy || !user.active}
        onClick={async () => (await confirm({ message: `${user.name}님의 임시 비밀번호를 발급할까요? 기존 비밀번호는 사용할 수 없게 됩니다.`, confirmLabel: "발급" })) && onAction("resetPassword")}>
        임시 비밀번호 발급
      </button>
      {locked !== false && <button className="btn-secondary" disabled={busy} onClick={() => onAction("unlock")}>잠금 해제</button>}
      <button className={`btn-ghost ml-auto ${user.active ? "text-status-rejected" : ""}`} disabled={busy}
        onClick={async () => (!user.active || await confirm({ message: `${user.name}님 계정을 비활성화할까요? 즉시 로그아웃됩니다.`, confirmLabel: "비활성화", danger: true })) && onAction("toggleActive")}>
        {user.active ? "계정 비활성화" : "계정 활성화"}
      </button>
    </div>
  );
}

/** 계정 동작별 PATCH 본문 */
export function accountActionPayload(a: AccountAction, active: boolean) {
  return a === "resetPassword" ? { resetPassword: true } : a === "unlock" ? { unlock: true } : { active: !active };
}
