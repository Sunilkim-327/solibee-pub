"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { watchSoftNav } from "./NavWatchdog";

/**
 * 주소의 검색값 하나(scope·part)를 바꿔 같은 화면을 다시 그린다.
 * 서버가 그리는 동안(수백 ms) 누른 칸을 바로 선택 표시하고 본문을 흐리게 해 '눌렸다'는 것을 보여 준다 (반응 없는 것처럼 보여 여러 번 누르지 않게).
 * 스크롤 위치는 그대로 둔다
 */
function useQueryToggle<T extends string | null>(key: string, current: T) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<T>(current);
  useEffect(() => setPicked(current), [current]);
  useEffect(() => {
    const el = document.documentElement;
    if (pending) el.dataset.navPending = "1";
    else delete el.dataset.navPending;
    return () => { delete el.dataset.navPending; };
  }, [pending]);
  const go = (value: T) => {
    if (value === picked && !pending) return;
    setPicked(value);
    const q = new URLSearchParams(params);
    if (value) q.set(key, value);
    else q.delete(key);
    const href = `${path}${q.size ? `?${q}` : ""}`;
    start(() => router.push(href, { scroll: false }));
    watchSoftNav(href);
  };
  return { picked, pending, go };
}

const Spin = () => <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-primary" aria-hidden />;

/** "이 프로젝트만 / 하위 프로젝트 포함" 전환 (?scope=all) */
export function ScopeToggle({ on, childCount }: { on: boolean; childCount: number }) {
  const { picked, pending, go } = useQueryToggle<"all" | null>("scope", on ? "all" : null);
  return (
    <div className="seg" role="group" aria-label="취합 범위" aria-busy={pending}>
      <button type="button" aria-pressed={!picked} onClick={() => go(null)}>
        {pending && !picked && <Spin />}이 프로젝트
      </button>
      <button type="button" aria-pressed={!!picked} onClick={() => go("all")}>
        {pending && picked && <Spin />}하위 포함 ({childCount})
      </button>
    </div>
  );
}

/** 구분 필터 "전체 / 운영 / 대응" (?part=프로젝트 id) — 메인과 함께 상신하는 서브가 있을 때 */
export function PartFilter({ parts, current }: { parts: { id: string; label: string }[]; current: string | null }) {
  const { picked, pending, go } = useQueryToggle<string | null>("part", current);
  return (
    <div className="seg" role="group" aria-label="구분" aria-busy={pending}>
      <button type="button" aria-pressed={!picked} onClick={() => go(null)}>{pending && !picked && <Spin />}전체</button>
      {parts.map((p) => (
        <button key={p.id} type="button" aria-pressed={picked === p.id} onClick={() => go(p.id)} className="max-w-32 truncate">
          {pending && picked === p.id && <Spin />}{p.label}
        </button>
      ))}
    </div>
  );
}

/** 조회 전용 안내 (상위 PM이 하위 프로젝트를 보는 중) */
export function ReadOnlyNotice() {
  return (
    <div className="alert alert-info mb-4">
      <b>조회 전용</b> · 입력·마감·상신은 이 프로젝트 PM이 진행합니다.
    </div>
  );
}
