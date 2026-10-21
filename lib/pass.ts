// 출입증 사용 내역(이전 방식, 조회·엑셀 전용) — 개인 법인카드 정산과 분리된 별도 집계 (순수함수)
// 사용 항목은 프로젝트 항목(예: 야근식대)과 같고, 사용처(식당·카페…)만 나눠 입력한다.
// 예) 야근식대 1인 12,000원 한도 → 식당 8,000 + 카페 3,000 = 11,000원 (한도 내)
const PASS_PLACES = ["식당", "카페", "편의점", "기타"] as const;

export type PassRow = { userId: string; userName: string; itemId: string; itemName: string; amount: number; placeType: string };

/** 월 집계: 총액·건수, 항목별(사용처 내역 포함), 사용자별 */
export function summarizePass(rows: PassRow[]) {
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const byUser = new Map<string, { userId: string; name: string; amount: number; count: number }>();
  const byItem = new Map<string, { itemId: string; name: string; amount: number; count: number; places: Map<string, number> }>();
  for (const r of rows) {
    const u = byUser.get(r.userId) ?? { userId: r.userId, name: r.userName, amount: 0, count: 0 };
    u.amount += r.amount;
    u.count++;
    byUser.set(r.userId, u);
    const it = byItem.get(r.itemId) ?? { itemId: r.itemId, name: r.itemName, amount: 0, count: 0, places: new Map() };
    it.amount += r.amount;
    it.count++;
    it.places.set(r.placeType, (it.places.get(r.placeType) ?? 0) + r.amount);
    byItem.set(r.itemId, it);
  }
  return {
    total,
    count: rows.length,
    byItem: [...byItem.values()]
      .sort((a, b) => b.amount - a.amount)
      .map(({ places, ...it }) => ({
        ...it,
        // 사용처 구분은 고정 순서, 사용 없는 구분은 생략
        places: PASS_PLACES.filter((p) => places.has(p)).map((p) => ({ placeType: p, amount: places.get(p)! })),
      })),
    byUser: [...byUser.values()].sort((a, b) => b.amount - a.amount),
  };
}
