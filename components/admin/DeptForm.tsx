"use client";

import { DeptSelect, type Dept } from "./DeptSelect";
import type { ConfirmOptions } from "../ConfirmDialog";

/** 부서 입력값. order·epsEnabled는 값이 있을 때만 입력칸을 보이고 저장한다 */
export type DeptValues = { name: string; code: string; parentId: string; order?: string; epsEnabled?: boolean };

/** 저장 요청 본문 */
export function deptPayload(v: DeptValues) {
  return {
    name: v.name,
    code: v.code || null,
    parentId: v.parentId || null,
    ...(v.order !== undefined ? { order: Number(v.order) || 0 } : {}),
    ...(v.epsEnabled !== undefined ? { epsEnabled: v.epsEnabled } : {}),
  };
}

/** 사용 중지 전 확인 (다시 사용은 확인 없이) */
export async function confirmDeptToggle(d: { name: string; active: boolean }, confirm: (o: ConfirmOptions) => Promise<boolean>) {
  return !d.active || confirm({ message: `'${d.name}' 부서를 사용 중지할까요?`, confirmLabel: "사용 중지", danger: true });
}

/**
 * 부서 정보 입력칸 — 부서명 · 부서코드 · 상위 부서 · (순서) · (children: 조직장 등) · (체계도 사용)
 * selfId: 수정 중인 부서 (상위 부서 후보에서 자신과 하위 제외)
 */
export function DeptFields({ value: v, onChange, depts, selfId, className = "grid gap-3", children }: {
  value: DeptValues; onChange: (v: DeptValues) => void; depts: Dept[]; selfId?: string; className?: string; children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block"><span className="label">부서명 *</span><input className="input" value={v.name} onChange={(e) => onChange({ ...v, name: e.target.value })} /></label>
      <label className="block"><span className="label">부서코드</span><input className="input" placeholder="선택" value={v.code} onChange={(e) => onChange({ ...v, code: e.target.value })} /></label>
      <label className="block"><span className="label">상위 부서</span>
        <DeptSelect depts={depts} exclude={selfId} value={v.parentId} onChange={(parentId) => onChange({ ...v, parentId })} empty="(최상위)" /></label>
      {v.order !== undefined && (
        <label className="block"><span className="label">순서</span>
          <input className="input tabular text-right" inputMode="numeric" value={v.order} onChange={(e) => onChange({ ...v, order: e.target.value.replace(/[^\d]/g, "") })} /></label>
      )}
      {children}
      {v.epsEnabled !== undefined && (
        <label className="flex items-start gap-2 rounded-xl bg-surface-muted px-3 py-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={v.epsEnabled} onChange={(e) => onChange({ ...v, epsEnabled: e.target.checked })} />
          <span><b>프로젝트 체계도에서 사용</b><br /><span className="text-xs text-fg-muted">끄면 이 조직에 프로젝트를 둘 수 없습니다. 조직도에는 그대로 보입니다.</span></span>
        </label>
      )}
    </div>
  );
}
