// 토스 ListRow형 2줄 컴팩트 행 — 출입증·월별·정산·마감·기록·최근 입력 공통.
// "use client" 없음: 서버 컴포넌트에서도 href로 쓸 수 있고, onPress는 클라이언트 컴포넌트 안에서만 넘긴다.
import Link from "next/link";
import { won } from "@/lib/format";
import { Fragment } from "react";
import { Icon } from "../icons";

export type RowAccent = "ok" | "warn" | "bad" | "info";

/** 왼쪽 띠 + 옅은 배경 (상태 강조 — 글자·배지와 함께 쓴다) */
const ACCENT: Record<RowAccent, { bg: string; bar: string }> = {
  ok: { bg: "bg-emerald-50/70 dark:bg-emerald-950/30", bar: "bg-emerald-500" },
  // 50 단계는 토큰이라 다크에서 자동 전환
  warn: { bg: "bg-amber-50/60", bar: "bg-amber-500" },
  bad: { bg: "bg-rose-50/60", bar: "bg-rose-500" },
  info: { bg: "bg-sky-50/60", bar: "bg-sky-500" },
};

export type ListRowProps = {
  /** 왼쪽 원(36px) 안 내용 — 이모지·이니셜. 없으면 원을 그리지 않는다 */
  lead?: React.ReactNode;
  /** 1줄째 제목 (말줄임) */
  title: React.ReactNode;
  /** 제목 앞 배지 (예외 하나만) */
  badge?: React.ReactNode;
  /** 2줄째 메타 (13px, 최대 3개 · 로 구분) — 안에 버튼을 둘 수 있다(이때 onPress/href는 쓰지 않는다) */
  meta?: React.ReactNode;
  /** 메타 조각이 여럿이면 좁은 화면에서 다음 줄로 내린다 (기본은 한 줄 말줄임) — 출입증 줄의 '팀원 요청 · 항목'처럼 잘리면 안 되는 조각이 있을 때 */
  metaWrap?: boolean;
  /** 3줄째 (선택, 경고 등) */
  sub?: React.ReactNode;
  /** 오른쪽 금액 — "원"을 붙여 표시 */
  amount?: number;
  /** 금액 대신 오른쪽 위 내용 */
  value?: React.ReactNode;
  /** 금액 아래 작은 글씨 (결과·상태) */
  valueSub?: React.ReactNode;
  /** 맨 오른쪽 (체크·버튼 등 별도 조작) — 누르는 영역 밖에 둔다 */
  trail?: React.ReactNode;
  /** 오른쪽 › (누르면 상세) */
  chevron?: boolean;
  /** 오른쪽 자물쇠 (마감 등으로 잠김) */
  locked?: boolean | string;
  accent?: RowAccent;
  href?: string;
  onPress?: () => void;
  ariaLabel?: string;
  /** 행 아래 펼침 영역 (pl-16 들여쓰기는 쓰는 쪽에서) */
  children?: React.ReactNode;
  className?: string;
};

const LOCK = (
  <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
    <path d="M5.5 9V6.5a4.5 4.5 0 0 1 9 0V9M4.5 9h11v8h-11z" strokeLinejoin="round" />
  </svg>
);

export function ListRow({ lead, title, badge, meta, metaWrap, sub, amount, value, valueSub, trail, chevron, locked, accent, href, onPress, ariaLabel, children, className = "" }: ListRowProps) {
  const a = accent ? ACCENT[accent] : null;
  const body = (
    <>
      {lead !== undefined && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-base font-semibold text-fg-2" aria-hidden>{lead}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {badge}
          <span className="truncate text-base font-semibold sm:text-sm">{title}</span>
        </div>
        {meta && <div className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted ${metaWrap ? "flex-wrap gap-y-0.5" : ""}`}>{meta}</div>}
        {sub}
      </div>
      {(amount !== undefined || value !== undefined || valueSub) && (
        <div className="shrink-0 text-right">
          {amount !== undefined ? <div className="tabular text-base font-semibold sm:text-sm">{won(amount)}원</div> : value}
          {valueSub}
        </div>
      )}
      {locked && (
        <span className="-mr-1 flex shrink-0 items-center text-fg-subtle" title={typeof locked === "string" ? locked : "잠김"}>
          {LOCK}<span className="sr-only">{typeof locked === "string" ? locked : "잠김"}</span>
        </span>
      )}
      {chevron && !locked && <span className="-mr-1 shrink-0 text-base leading-none text-fg-subtle" aria-hidden>›</span>}
    </>
  );
  const rowCls = "flex min-h-16 items-center gap-3 px-4 py-2.5";
  const pressCls = `${rowCls} w-full min-w-0 flex-1 text-left transition-colors hover:bg-surface-muted/60 active:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary`;

  let main: React.ReactNode;
  if (href) main = <Link href={href} className={pressCls} aria-label={ariaLabel}>{body}</Link>;
  else if (onPress) main = <button type="button" className={pressCls} onClick={onPress} aria-label={ariaLabel}>{body}</button>;
  else main = null;

  return (
    <li className={`relative ${a ? a.bg : ""} ${className}`}>
      {a && <span className={`absolute inset-y-0 left-0 w-0.5 ${a.bar}`} aria-hidden />}
      {main ? (
        trail ? <div className="flex items-center">{main}<div className="shrink-0 pr-4">{trail}</div></div> : main
      ) : (
        <div className={rowCls}>{body}{trail}</div>
      )}
      {children}
    </li>
  );
}

/** 행 메타 구분점 — meta 안에서 `a<Dot/>b` */
export function Dot() {
  return <span aria-hidden className="text-fg-subtle">·</span>;
}

/** 인원 표시 (선 아이콘 + 숫자) — 그림 이모지(👥)는 글자색을 따르지 않아 상태색(보라=보류)처럼 보이므로 쓰지 않는다 */
export function Headcount({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-[-2px]" aria-label={`${n}명`}>
      <Icon name="people" className="size-3.5" /><span aria-hidden>{n}</span>
    </span>
  );
}

/** 2줄째 메타 — 빈 값은 빼고 " · "로 잇는다 (글자·요소 섞어 쓸 수 있음) */
export function MetaLine({ parts, className = "tabular truncate" }: { parts: React.ReactNode[]; className?: string }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return <span className={className}>{shown.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)}</span>;
}
