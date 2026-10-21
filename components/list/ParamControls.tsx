"use client";

// 주소 파라미터로 거르는 서버 화면(전체 프로젝트·접속 기록)의 검색·선택 — ListToolbar 슬롯에 끼운다.
// 값을 바꾸면 같은 화면을 다시 그린다 (스크롤 유지, 페이지 커서는 처음으로).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SearchInput } from "./ListToolbar";

function useParamSetter(reset: readonly string[]) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value);
    else q.delete(key);
    for (const r of reset) q.delete(r);
    start(() => router.replace(`${path}${q.size ? `?${q}` : ""}`, { scroll: false }));
  };
  return { set, pending };
}

/** ?q= 검색 (입력 후 300ms 뒤 반영) */
export function ParamSearch({ param = "q", placeholder = "검색", label = "검색", reset = ["cursor"] }: {
  param?: string; placeholder?: string; label?: string;
  /** 검색이 바뀌면 지울 파라미터 (기본: 페이지 커서) */
  reset?: readonly string[];
}) {
  const current = useSearchParams().get(param) ?? "";
  const [v, setV] = useState(current);
  const { set, pending } = useParamSetter(reset);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setV(current), [current]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const onChange = (next: string) => {
    setV(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => set(param, next.trim()), 300);
  };
  return <SearchInput value={v} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} aria-busy={pending || undefined} />;
}

/** ?key= 선택 (빈 값 = 전체) */
export function ParamSelect({ param, value, options, label, reset = ["cursor"], className = "" }: {
  param: string; value: string; options: readonly (readonly [string, string])[]; label: string; reset?: readonly string[]; className?: string;
}) {
  const { set, pending } = useParamSetter(reset);
  return (
    <select className={`input w-auto max-w-full ${className}`} value={value} aria-label={label} aria-busy={pending || undefined} onChange={(e) => set(param, e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
