import type { HqTodo, HqTodoKind } from "@/lib/hq-todo";
import { Icon } from "./icons";
import { PACE_ICON } from "./Meter";
import { HqTodoChips } from "./HqTodoChips";

/**
 * 종류별 표시 — 칩은 모두 중립, 앞 아이콘만 의미색 (빨강은 반려·오류 전용이라 승인 대기는 진행색).
 * 아이콘 + 글자를 함께 써서 색만으로 구분하지 않는다.
 */
const KIND: Record<HqTodoKind, { d: string; cls: string }> = {
  APPROVE: { d: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.5V10l2.5 1.5", cls: "text-sky-700" },
  NO_BUDGET: { d: PACE_ICON.warn, cls: "text-amber-800" },
  NO_PM: { d: PACE_ICON.warn, cls: "text-amber-800" },
  CLOSABLE: { d: "m5 10 3.5 3.5L15 7", cls: "text-fg-muted" },
};

/** 재무 승인 할 일 — 종류별 프로젝트 칩, 누르면 그 프로젝트의 해당 화면으로 */
export function HqTodoPanel({ todos }: { todos: HqTodo[] }) {
  if (!todos.length) return null;
  const total = todos.reduce((a, t) => a + t.projects.length, 0);
  return (
    <section className="card mb-5 overflow-hidden" aria-label="할 일">
      <div className="card-head">
        <h2 className="section-title">할 일 <span className="font-medium text-fg-muted">{total}건</span></h2>
      </div>
      <ul className="divide-y divide-line">
        {[...todos].sort((a, b) => (a.kind === "APPROVE" ? -1 : b.kind === "APPROVE" ? 1 : 0)).map((t) => (
          <li key={t.kind} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:px-5 ${t.kind === "APPROVE" ? "bg-brand-50/50" : ""}`}>
            <div className="flex w-36 shrink-0 items-center gap-1.5 pt-1.5">
              <span className={KIND[t.kind].cls}><Icon d={KIND[t.kind].d} className="size-4" sw={1.8} /></span>
              <span className="text-sm font-semibold">{t.label}</span>
              <span className="tabular text-xs text-fg-muted">{t.projects.length}</span>
            </div>
            {/* 승인 대기는 모두 보이고(지금 처리할 것), 나머지는 8개 넘으면 접는다 */}
            <HqTodoChips limit={t.kind === "APPROVE" ? 100 : 8}
              chips={t.projects.map((p) => ({ id: p.id, href: p.href ?? t.href, label: t.kind === "APPROVE" ? `${p.name} · ${p.note ?? ""} 승인하기 ›` : p.note ? `${p.name} · ${p.note}` : p.name }))}
              className={t.kind === "APPROVE"
                ? "btn-primary min-h-10 max-w-full truncate rounded-full px-3.5 sm:min-h-9"
                : "min-h-10 max-w-full truncate rounded-full border border-line-strong bg-surface px-3 text-sm font-medium text-fg transition hover:border-primary hover:bg-surface-muted sm:min-h-9"} />
          </li>
        ))}
      </ul>
    </section>
  );
}
