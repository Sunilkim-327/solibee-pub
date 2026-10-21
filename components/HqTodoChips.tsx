"use client";

import { useState } from "react";
import { OpenProjectButton } from "./OpenProjectButton";

export type HqTodoChip = { id: string; href: string; label: string };

/** 재무 승인 할 일 칩 — 많으면 앞 limit개만 보이고 "N개 더 보기"로 펼친다 (한 번 펼치면 그대로) */
export function HqTodoChips({ chips, className, limit = 8 }: { chips: HqTodoChip[]; className: string; limit?: number }) {
  const [all, setAll] = useState(false);
  // 숨길 게 1개뿐이면 접지 않는다 ("1개 더 보기"는 누르는 수고가 더 크다)
  const shown = all || chips.length <= limit + 1 ? chips : chips.slice(0, limit);
  const rest = chips.length - shown.length;
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {shown.map((c) => <OpenProjectButton key={c.id} projectId={c.id} href={c.href} label={c.label} className={className} />)}
      {rest > 0 && (
        <button type="button" className="btn-ghost btn-sm min-h-10 rounded-full sm:min-h-9" onClick={() => setAll(true)}>
          {rest}개 더 보기
        </button>
      )}
    </div>
  );
}
