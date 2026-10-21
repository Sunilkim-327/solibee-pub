/** 축 최댓값: 1·2·2.5·5 × 10^k 로 올림 (0이면 1) */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/** 축 라벨용 짧은 금액: 1.2억 · 2,200만 · 5,000 */
export function compactWon(v: number): string {
  if (v >= 1e8) return `${Math.round(v / 1e7) / 10}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`;
  return Math.round(v).toLocaleString("ko-KR");
}
