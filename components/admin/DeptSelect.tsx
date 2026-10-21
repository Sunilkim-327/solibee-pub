"use client";

import { useMemo } from "react";
import { descendantIds } from "@/lib/org";
import { TreePicker } from "../TreePicker";
import type { TreeNode } from "../Tree";

/** 부서 선택 목록에 필요한 최소 필드 */
export type Dept = { id: string; name: string; code: string | null; parentId: string | null; order: number; active: boolean; epsEnabled?: boolean };

const EMPTY = "__empty__";

/**
 * 부서 선택 (사용 중인 부서만, 트리에서 고르기).
 * - empty: 빈 값 선택지 문구, null이면 빈 선택지 없음
 * - exclude: 이 부서와 그 하위는 제외 (상위 부서 선택 시 순환 방지)
 * - epsOnly: 프로젝트 소속 조직 선택 — 체계도 미사용(묶음) 조직은 고를 수 없음
 */
export function DeptSelect({ depts, value, onChange, empty = "부서 없음", className, epsOnly, label, exclude, disabled }: {
  depts: Dept[]; value: string; onChange: (v: string) => void; empty?: string | null; className?: string; epsOnly?: boolean; label?: string;
  exclude?: string; disabled?: boolean;
}) {
  const nodes = useMemo(() => {
    const skip = exclude ? descendantIds(depts, exclude) : null;
    const usable = (d: Dept) => !epsOnly || d.epsEnabled !== false;
    const list = depts.filter((d) => d.active && !skip?.has(d.id));
    const ids = new Set(list.map((d) => d.id));
    const out: TreeNode[] = [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko")).map((d) => ({
      id: d.id,
      // 상위가 빠졌으면(사용 안 함·제외) 최상위로
      parentId: d.parentId && ids.has(d.parentId) ? d.parentId : null,
      label: d.name,
      icon: d.parentId ? "org" : "company",
      disabled: !usable(d),
      muted: !usable(d),
      tag: usable(d) ? null : "묶음",
    }));
    return empty !== null ? [{ id: EMPTY, parentId: null, label: empty, muted: true } as TreeNode, ...out] : out;
  }, [depts, exclude, epsOnly, empty]);

  const cur = depts.find((d) => d.id === value);
  // 기존 select의 크기 클래스(input, py-1.5 등)는 버튼 모양과 맞지 않아 너비 관련만 넘긴다
  const width = (className ?? "").split(/\s+/).filter((c) => /^(w-|min-w-|max-w-|flex-|sm:w-)/.test(c)).join(" ");
  return (
    <TreePicker nodes={nodes} value={value ? value : empty !== null ? EMPTY : null} onPick={(id) => onChange(id === EMPTY ? "" : id)}
      label={cur?.name ?? (value ? "선택" : empty ?? "선택")} title={label ?? "부서 선택"} placeholder="부서 검색"
      icon={cur ? (cur.parentId ? "org" : "company") : undefined} disabled={disabled} className={width} />
  );
}
