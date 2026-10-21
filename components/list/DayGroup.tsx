// 날짜별 소제목 + 그 날 행들 (ListRow 목록). 서버·클라이언트 공용 ("use client" 없음).
import { dayLabel, won } from "@/lib/format";
import { groupByDay } from "./model";

type Group<T> = { date: string; total: number; items: T[] };

/** 행 사이 구분선 — lead(원)가 있으면 원 다음부터(ml-16), 없으면 글자부터(ml-4) */
export const rowSeparator = (inset: "lead" | "text" = "lead") =>
  `[&>li+li]:before:absolute [&>li+li]:before:inset-x-0 [&>li+li]:before:top-0 [&>li+li]:before:h-px [&>li+li]:before:bg-line ${
    inset === "lead" ? "[&>li+li]:before:ml-16" : "[&>li+li]:before:ml-4"
  }`;

export type DayGroupProps<T> = {
  items: T[];
  /** "YYYY-MM-DD" (또는 그 앞부분이 날짜인 문자열). 없으면 "날짜 없음" 묶음 */
  dateOf: (t: T) => string | null | undefined;
  /** 있으면 소제목 오른쪽에 "n건 · 합계원" */
  amountOf?: (t: T) => number;
  /** 행 하나 (ListRow 등 <li>) */
  render: (t: T) => React.ReactNode;
  /** 소제목 글자 (기본 dayLabel: "10월 6일 (화)") */
  label?: (date: string) => React.ReactNode;
  /** 소제목 오른쪽 (기본: amountOf가 있으면 건수·합계) */
  right?: (g: Group<T>) => React.ReactNode;
  /** 소제목 아래 줄 (경고 배지 등 — w-full로 넣는다) */
  extra?: (g: Group<T>) => React.ReactNode;
  /** 스크롤 시 소제목 고정 — 배경색 (canvas: 페이지 위 / surface: 카드 안. band면 띠 색) */
  sticky?: "canvas" | "surface";
  /**
   * 날짜 띠 — 옅은 배경(bg-surface-muted) + 위아래 1px 선, 날짜 사이 여백 없음 (카드 안 목록용).
   * 행 구분선만 있으면 날짜 경계가 행 경계와 구별되지 않아서, 표 머리글(th)·집행내역 묶음 머리글과 같은 띠로 날짜를 나눈다.
   */
  band?: boolean;
  /** 페이지 여백까지 행을 넓힘 (-mx-4) */
  bleed?: boolean;
  /** 소제목 추가 클래스 (카드 안이면 px-4) */
  headClassName?: string;
  /** 구분선 시작 위치 (기본 lead) */
  inset?: "lead" | "text";
};

const STICKY = "sticky top-14 z-[5] lg:top-16";
const STICKY_BG = { canvas: "bg-canvas", surface: "bg-surface" };

export function DayGroup<T>({ items, dateOf, amountOf, render, label = dayLabel, right, extra, sticky, band, bleed, headClassName = "", inset }: DayGroupProps<T>) {
  const groups = groupByDay(items, dateOf, amountOf);
  // 띠: 날짜 사이 여백 대신 1px 선(첫 날은 카드 선과 겹치지 않게 생략). 고정 배경도 띠 색을 그대로 쓴다
  const sectionCls = band ? "border-t border-line first:border-t-0" : "mt-3 first:mt-1";
  const headCls = `${band ? "border-b border-line bg-surface-muted" : sticky ? STICKY_BG[sticky] : ""} ${sticky ? STICKY : ""}`;
  return (
    <div>
      {groups.map((g) => (
        <section key={g.date || "none"} className={sectionCls}>
          <h4 className={`tabular flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-label font-semibold text-fg-muted ${headCls} ${headClassName}`}>
            <span className="text-fg">{g.date ? label(g.date) : "날짜 없음"}</span>
            {right ? right(g) : amountOf && <span className="font-medium">{g.items.length}건 · {won(g.total)}원</span>}
            {extra?.(g)}
          </h4>
          <ul className={`${bleed ? "-mx-4" : ""} ${rowSeparator(inset)}`}>{g.items.map(render)}</ul>
        </section>
      ))}
    </div>
  );
}

/** 날짜 묶음 없이 같은 구분선 규칙의 목록 */
export function RowList({ children, bleed, inset, className = "" }: { children: React.ReactNode; bleed?: boolean; inset?: "lead" | "text"; className?: string }) {
  return <ul className={`${bleed ? "-mx-4" : ""} ${rowSeparator(inset)} ${className}`}>{children}</ul>;
}
