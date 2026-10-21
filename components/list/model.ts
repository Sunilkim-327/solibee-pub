// 목록·표 공통 도우미 (순수함수 — tests/list-model.test.ts)
import { dash0, won } from "@/lib/format";

/** 날짜별 묶음: 줄 순서 유지, 같은 날짜는 처음 나온 자리에 모은다. 날짜 없는 줄은 "" 하나로 */
export function groupByDay<T>(items: T[], dateOf: (t: T) => string | null | undefined, amountOf?: (t: T) => number) {
  const map = new Map<string, { date: string; total: number; items: T[] }>();
  for (const t of items) {
    const k = (dateOf(t) ?? "").slice(0, 10);
    const g = map.get(k) ?? { date: k, total: 0, items: [] };
    g.total += amountOf ? amountOf(t) : 0;
    g.items.push(t);
    map.set(k, g);
  }
  return [...map.values()];
}

/** 이니셜 원(lead)에 넣을 한 글자 — 사이드바 아바타와 같은 규칙(첫 글자) */
export function initialOf(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  return s ? s[0].toUpperCase() : "?";
}

/** 같은 이름이 둘 이상인 이름 집합 (동명이인 구분 표시용) */
export function duplicateNames(people: { name: string }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const p of people) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
}

export type SortKey = "date" | "amount";

/** 날짜순(원래 순서 유지 — 안정 정렬) / 금액 큰 순 */
export function sortRows<T extends { date: string; amount: number }>(rows: T[], key: SortKey): T[] {
  if (key === "amount") return [...rows].sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date));
  return [...rows].sort((a, b) => a.date.localeCompare(b.date));
}

/** 한국 시간 "YYYY-MM-DD" / "HH:MM:SS" (변경 기록) */
export function kstParts(d: Date): { day: string; time: string } {
  const k = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return { day: k.slice(0, 10), time: k.slice(11, 19) };
}

// ── 내 정산 월별 행 (받을 돈 | 본인 부담 공제) ──

/** 공제 칸 상태: none=없음(-) · pending=확정 전(예정, 회색) · confirmed=확정(붉은 글자) */
export type DeductTone = "none" | "pending" | "confirmed";

export type SettlementMonthCells = {
  /** 받을 돈 — 0은 "-" */
  receive: string;
  /** 본인 부담(급여 공제) 금액 — 없으면 "-" */
  deduct: string;
  deductTone: DeductTone;
  /** 금액 옆 한 단어: 예정 / 확정 (없으면 "") */
  deductWord: string;
};

const DEDUCT_WORD: Record<DeductTone, string> = { none: "", pending: "예정", confirmed: "확정" };

/**
 * 내 정산 월별 행의 표시값 — 받을 돈(개인 법인카드)과 본인 부담(급여 공제)을 따로 읽는다.
 * 공제는 출입증 월 확정 전이면 "예정"(팀원 업무 사용 표시·PM 결정에 따라 바뀜), 확정이면 "확정". 0원은 둘 다 "-".
 */
export function settlementMonthCells(m: { amount: number; deduct?: { amount: number; confirmed: boolean } | null }): SettlementMonthCells {
  const d = m.deduct;
  const tone: DeductTone = !d || d.amount <= 0 ? "none" : d.confirmed ? "confirmed" : "pending";
  return {
    receive: dash0(m.amount),
    deduct: tone === "none" ? "-" : won(d!.amount),
    deductTone: tone,
    deductWord: DEDUCT_WORD[tone],
  };
}
