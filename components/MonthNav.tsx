"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ymKo } from "@/lib/format";
import { lastYmCookieString } from "@/lib/page-ctx";
import { watchSoftNav } from "./NavWatchdog";

/**
 * ?ym= 쿼리로 월을 이동하는 선택기 — 월 단위 화면 공통, PageHeader의 month 자리에 둔다.
 * 보고 있는 달을 쿠키(last-ym, 1년)에 남겨 다른 월 화면을 ?ym= 없이 열어도 같은 달로 열린다 (lib/page-ctx-server wantedYm).
 */
export function MonthNav({ months, value }: { months: string[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const idx = months.indexOf(value);
  useEffect(() => {
    const c = lastYmCookieString(value);
    if (c) document.cookie = c;
  }, [value]);
  const go = (ym: string) => {
    const q = new URLSearchParams(params);
    q.set("ym", ym);
    router.push(`${path}?${q}`);
    watchSoftNav(`${path}?${q}`);
  };
  return (
    <div className="flex w-full items-center gap-1 sm:w-auto">
      <button className="btn-secondary px-2.5" disabled={idx <= 0} onClick={() => go(months[idx - 1])} aria-label="이전 달">‹</button>
      <select className="input min-w-0 flex-1 py-1.5 sm:text-sm font-semibold sm:w-36 sm:flex-none" aria-label="월 선택" value={value} onChange={(e) => go(e.target.value)}>
        {/* 최근 달이 위로 (목록은 오래된 달부터라 ‹ › 버튼은 그 순서를 쓴다) */}
        {[...months].reverse().map((m) => (
          <option key={m} value={m}>{ymKo(m)}</option>
        ))}
      </select>
      <button className="btn-secondary px-2.5" disabled={idx < 0 || idx >= months.length - 1}
        onClick={() => go(months[idx + 1])} aria-label="다음 달">›</button>
    </div>
  );
}
