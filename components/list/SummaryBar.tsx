// 목록 요약: 위쪽 큰 숫자(테두리 없음) + 아래 고정 알약 바. 서버·클라이언트 공용.
import { won } from "@/lib/format";

/** 목록 위 요약 — "총 406,300원 · 8건" + 보조 한 줄 */
export function SummaryHead({ label, amount, count, sub, right, className = "" }: {
  label: string;
  amount: number;
  count?: number;
  sub?: React.ReactNode;
  /** 오른쪽 (검증 경고 등) */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={label} className={className}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-fg-muted">{label}</div>
          <div className="tabular mt-0.5 text-kpi font-bold tracking-tight">
            {won(amount)}<span className="ml-0.5 text-sm font-semibold text-fg-muted">원</span>
            {count !== undefined && <span className="ml-2 text-sm font-medium text-fg-muted">{count}건</span>}
          </div>
        </div>
        {right}
      </div>
      {sub && <div className="tabular mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-fg-muted">{sub}</div>}
    </section>
  );
}

/** 화면 아래 고정 알약 바 (모바일 하단 탭 위 / PC 아래 16px) */
export function FloatingTotal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-bottom-bar className={`sticky bottom-[4.5rem] z-10 lg:bottom-4 ${className}`}>
      <div className="tabular flex items-center justify-between gap-3 rounded-full border border-line bg-surface/95 px-4 py-2.5 text-sm shadow-pop backdrop-blur">
        {children}
      </div>
    </div>
  );
}
