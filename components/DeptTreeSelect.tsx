"use client";
// 조직 고르기 (주소의 ?dept= 로 거르는 화면용) — 고르면 바로 그 조직(하위 포함)으로 걸러 본다
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TreePicker } from "./TreePicker";
import type { TreeNode } from "./Tree";

export type DeptOption = { id: string; name: string; parentId: string | null; order: number; count: number };

const ALL = "__all__";

/** total: 전체 프로젝트 수 (조직 미지정 포함) */
export function DeptTreeSelect({ depts, value, total, param = "dept" }: { depts: DeptOption[]; value: string | null; total: number; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const cur = depts.find((d) => d.id === value) ?? null;
  const nodes: TreeNode[] = [
    { id: ALL, parentId: null, label: "전체 조직", icon: "company", count: total },
    ...[...depts].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko")).map((d) => ({
      id: d.id, parentId: d.parentId, label: d.name, icon: "org" as const, count: d.count || null, muted: d.count === 0,
    })),
  ];

  function pick(id: string) {
    const next = new URLSearchParams(search.toString());
    if (id === ALL) next.delete(param); else next.set(param, id);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
      <TreePicker nodes={nodes} value={value ?? ALL} onPick={pick} label={cur?.name ?? "전체 조직"} title="조직" placeholder="조직 검색"
        icon={cur ? "org" : "company"} side={`${cur ? cur.count : total}개`} className="font-semibold"
        hint="숫자는 하위 조직 포함 프로젝트 수" />
    </div>
  );
}
