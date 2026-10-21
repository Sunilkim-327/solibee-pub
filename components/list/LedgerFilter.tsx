"use client";

// 현황 화면의 요약(소명 없음 칸·팀원별 정산 행)과 지출 내역 표가 같은 필터를 쓴다.
// 요약을 누르면 서버를 다시 부르지 않고 내역만 거르고, 내역이 화면 밖이면 그리로 스크롤한다.
import { createContext, useContext, useState } from "react";
import { ListRow } from "./ListRow";

/** 규정 점검 탭: 전체 / 규정 점검(flag: 소명이 필요한 점검에 걸린 건 전부) / 소명 필요(unexplained: 아직 소명이 없는 건) — ?check=flag·unexplained와 호환 */
export type CheckTab = "" | "flag" | "unexplained";
export const toCheck = (v: string | undefined): CheckTab => (v === "flag" || v === "unexplained" ? v : "");

export type LedgerFilters = { payer: string; method: string; check: CheckTab };
type Ctx = { filters: LedgerFilters; set: (p: Partial<LedgerFilters>) => void };

const LedgerCtx = createContext<Ctx | null>(null);
/** 내역 구역 id — 요약에서 누르면 여기로 스크롤 */
export const LEDGER_ID = "ledger";

function useFilterState(initialCheck?: string): Ctx {
  const [filters, setFilters] = useState<LedgerFilters>({ payer: "", method: "", check: toCheck(initialCheck) });
  return { filters, set: (p) => setFilters((f) => ({ ...f, ...p })) };
}

/** 요약과 내역이 필터를 함께 쓰는 범위 (월이 바뀌면 key로 초기화) */
export function LedgerFilterProvider({ initialCheck, children }: { initialCheck?: string; children: React.ReactNode }) {
  return <LedgerCtx.Provider value={useFilterState(initialCheck)}>{children}</LedgerCtx.Provider>;
}

/** 내역 표의 필터 상태 — 공유 범위 안이면 공유 상태, 밖이면 자체 상태 */
export function useLedgerFilters(initialCheck?: string): Ctx {
  const shared = useContext(LedgerCtx);
  const local = useFilterState(initialCheck);
  return shared ?? local;
}

/** 내역이 화면 밖(지나쳤거나 화면 절반보다 아래에서 시작)이면 내역 머리로 */
function revealLedger() {
  const el = document.getElementById(LEDGER_ID);
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function usePress(set: Partial<LedgerFilters>) {
  const ctx = useContext(LedgerCtx);
  if (!ctx) return null;
  const keys = Object.keys(set) as (keyof LedgerFilters)[];
  const pressed = keys.every((k) => ctx.filters[k] === set[k]);
  const toggle = () => {
    // 다시 누르면 해제
    ctx.set(pressed ? Object.fromEntries(keys.map((k) => [k, ""])) : set);
    if (!pressed) revealLedger();
  };
  return { pressed, toggle };
}

/** 누르면 내역을 거르는 칸 (공유 범위 밖이면 그냥 칸) */
export function FilterTrigger({ set, className = "", pressedClassName = "", label, children }: {
  set: Partial<LedgerFilters>; className?: string; pressedClassName?: string; label?: string; children: React.ReactNode;
}) {
  const p = usePress(set);
  if (!p) return <div className={className}>{children}</div>;
  return (
    <button type="button" aria-pressed={p.pressed} aria-label={label} onClick={p.toggle} className={`text-left ${className} ${p.pressed ? pressedClassName : ""}`}>
      {children}
    </button>
  );
}

/** 팀원별 정산 행 — 누르면 내역을 이 결제자(또는 결제방법) 건만 */
export function FilterRow({ set, lead, title, meta, value, ariaLabel }: {
  set: Partial<LedgerFilters>; lead?: React.ReactNode; title: string; meta?: React.ReactNode; value?: React.ReactNode; ariaLabel: string;
}) {
  const p = usePress(set);
  return (
    <ListRow lead={lead} title={title} meta={meta} value={value}
      onPress={p?.toggle} ariaLabel={p?.pressed ? `${ariaLabel} — 필터 해제` : ariaLabel}
      valueSub={p?.pressed ? <span className="badge badge-primary mt-0.5">내역 보는 중</span> : undefined}
      className={p?.pressed ? "bg-brand-50/70" : ""} />
  );
}
