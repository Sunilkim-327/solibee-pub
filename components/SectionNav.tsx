"use client";

import { useEffect, useState } from "react";

/**
 * 긴 화면의 섹션 바로가기 (PM 설정 등) — 지금 보고 있는 섹션을 강조한다.
 * 앵커(#id)로 이동하고, 스크롤에 따라 화면 위쪽(상단 바 아래)에 걸친 섹션을 현재로 표시 (IntersectionObserver).
 */
export function SectionNav({ sections, className = "" }: { sections: { id: string; label: string }[]; className?: string }) {
  const [current, setCurrent] = useState<string>(sections[0]?.id ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    // 각 섹션이 보이는 비율을 기억해 두고, 위쪽 띠(상단 바·바로가기 아래 ~40%)에 걸친 섹션 중 가장 앞의 것을 현재로
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting);
      const first = els.find((el) => visible.get(el.id));
      if (first) setCurrent(first.id);
    }, { rootMargin: "-120px 0px -60% 0px", threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);
  return (
    <div className={`seg flex w-full ${className}`}>
      {sections.map((x) => (
        <a key={x.id} href={`#${x.id}`} className="flex-1" aria-current={current === x.id ? "page" : undefined} onClick={() => setCurrent(x.id)}>{x.label}</a>
      ))}
    </div>
  );
}
