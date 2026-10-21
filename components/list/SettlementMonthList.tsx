// 내 정산 월별 목록 — 한 행에 "받을 돈(개인 법인카드)"과 "본인 부담(급여 공제)" 두 축을 나란히.
// PC(sm 이상)는 머리글 있는 표 밀도(머리 36·행 40·tabular·오른쪽 정렬, docs/DESIGN.md §0), 모바일은 행 안 2단(왼쪽 달+상태, 오른쪽 금액 두 줄).
// 행 전체는 그 달 내 지출 내역으로, 공제 금액은 출입증 탭으로 — 링크 둘이라 겹치지 않게 '펼친 링크'(after:inset-0) + 공제 링크 z-index.
// "use client" 없음: 서버 컴포넌트에서 쓴다.
import Link from "next/link";
import { settlementMonthCells, type DeductTone } from "./model";

export type SettlementMonthRow = {
  ym: string;
  /** 달 표기 ("2026년 10월") */
  label: string;
  /** 받을 돈 (개인 법인카드 결제분) */
  amount: number;
  /** 본인 부담(급여 공제) — 출입증을 안 쓰면 undefined */
  deduct?: { amount: number; confirmed: boolean } | null;
  /** 상태 배지 (StatusBadge 또는 승인 취소 배지) */
  status: React.ReactNode;
  /** 행 전체 링크 — 그 달 내 지출 내역 */
  href: string;
  /** 공제 금액 링크 — 출입증 탭 (deduct가 있을 때) */
  deductHref?: string;
  /** 선택된 달 강조 */
  current?: boolean;
};

const DEDUCT_TEXT: Record<DeductTone, string> = {
  none: "text-fg-subtle",
  pending: "text-fg-muted",
  confirmed: "text-status-rejected",
};

/** 표 열 폭: 달 | 상태 | 받을 돈 | 공제 | › — 머리글과 각 행이 따로 그리드라 상태 열은 고정 폭(배지 "승인 취소됨"까지) */
const COLS = { withDeduct: "sm:grid-cols-[minmax(0,1fr)_6rem_7.5rem_9.5rem_1rem]", noDeduct: "sm:grid-cols-[minmax(0,1fr)_6rem_7.5rem_1rem]" };

export function SettlementMonthList({ rows, showDeduct, deductHead = "본인 부담 공제" }: {
  rows: SettlementMonthRow[];
  /** 출입증을 쓰는 프로젝트면 공제 열 */
  showDeduct: boolean;
  /** 공제 열 머리글 (예: "본인 부담 공제") */
  deductHead?: string;
}) {
  const cols = showDeduct ? COLS.withDeduct : COLS.noDeduct;
  return (
    <div role="table" aria-label="월별 정산" className="tabular">
      {/* 머리글 — PC만. 표 안 금액은 "원"을 머리에 한 번 */}
      <div role="row" className={`hidden h-9 items-center gap-x-3 border-b border-line bg-surface-muted px-4 text-xs font-medium text-fg-muted sm:grid ${cols}`}>
        <span role="columnheader">달</span>
        <span role="columnheader">상태</span>
        <span role="columnheader" className="text-right">받을 돈 (원)</span>
        {showDeduct && <span role="columnheader" className="text-right">{deductHead} (원)</span>}
        <span role="columnheader" aria-hidden />
      </div>
      <ul role="rowgroup" className="[&>li+li]:border-t [&>li+li]:border-line">
        {rows.map((r) => {
          const c = settlementMonthCells(r);
          const deductLink = showDeduct && c.deductTone !== "none" && r.deductHref;
          return (
            <li key={r.ym} role="row" className={`relative transition-colors hover:bg-surface-muted/60 ${r.current ? "bg-brand-50/50" : ""}`}>
              {/* 모바일: 2단(왼쪽 달+상태 / 오른쪽 금액 두 줄, 최소 64px). PC: 표 행 40px */}
              <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 sm:min-h-10 sm:py-0 ${cols}`}>
                <div role="cell" className="min-w-0 sm:contents">
                  {/* 행 전체 링크 (after:inset-0로 펼침) — 공제 링크는 위(z-[1])에 둔다 */}
                  <Link href={r.href} aria-label={`${r.label} 내 지출 내역`}
                    className="block truncate text-base font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary sm:text-sm sm:font-medium">
                    {r.label}
                  </Link>
                  <div className="mt-1 flex items-center sm:mt-0">{r.status}</div>
                </div>
                {/* 금액: 모바일은 "받을 돈 54,000원" / "공제 12,000원" 두 줄, PC는 열 둘 */}
                <div role="cell" className="flex flex-col items-end gap-y-0.5 text-right sm:contents">
                  <div className="flex items-baseline gap-x-1.5 sm:block">
                    <span className="text-xs text-fg-muted sm:hidden">받을 돈</span>
                    <span className={`text-base font-semibold sm:text-sm ${r.amount === 0 ? "text-fg-subtle" : ""}`}>
                      {c.receive}<span className="text-xs font-medium text-fg-muted sm:hidden">{r.amount === 0 ? "" : "원"}</span>
                    </span>
                  </div>
                  {showDeduct && (
                    // 공제 금액 → 출입증 탭. 모바일은 누르는 영역 44px(min-h-11, 아래 여백으로 넓힘), PC는 셀 40px
                    deductLink ? (
                      <Link href={r.deductHref!} aria-label={`${r.label} 본인 부담(급여 공제) ${c.deductWord} ${c.deduct}원 — ${deductHead} 확인`}
                        className={`relative z-[1] -mb-2.5 flex min-h-11 items-center justify-end gap-x-1.5 pb-2.5 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:mb-0 sm:min-h-10 sm:pb-0 ${DEDUCT_TEXT[c.deductTone]}`}>
                        <span className="text-xs sm:hidden">공제</span>
                        <span className="text-xs font-medium">{c.deductWord}</span>
                        <span className="text-base font-semibold sm:text-sm">{c.deduct}<span className="text-xs font-medium sm:hidden">원</span></span>
                      </Link>
                    ) : (
                      <div className={`-mb-2.5 flex min-h-11 items-center justify-end gap-x-1.5 pb-2.5 sm:mb-0 sm:min-h-10 sm:pb-0 ${DEDUCT_TEXT.none}`}>
                        <span className="text-xs sm:hidden">공제</span>
                        <span className="text-base font-semibold sm:text-sm">-</span>
                      </div>
                    )
                  )}
                </div>
                <span className="hidden text-base leading-none text-fg-subtle sm:block" aria-hidden>›</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
