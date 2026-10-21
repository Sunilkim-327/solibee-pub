// 세부내역 키워드 기반 항목 추천 (오분류 방지)
export type SuggestItem = { id: string; name: string; keywords: string | null };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 세부내역에 포함된 가장 긴 키워드(항목명 포함)를 가진 항목을 추천한다. */
export function suggestItem<T extends SuggestItem>(detail: string, items: T[]): T | null {
  const text = norm(detail);
  if (!text) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const words = [item.name, ...(item.keywords ?? "").split(",")].map(norm).filter(Boolean);
    const score = Math.max(0, ...words.filter((w) => text.includes(w)).map((w) => w.length));
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}
