// 목록 순서 이동 (위로·아래로) — 순수함수

export type Move = "up" | "down";

export const isMove = (v: unknown): v is Move => v === "up" || v === "down";

/**
 * 정렬된 목록에서 id를 이웃과 바꾼 새 목록. 맨 위·맨 아래라 움직일 수 없거나 없는 id면 null.
 * 저장은 결과의 인덱스를 0..n 순서로 다시 매긴다.
 */
export function moveInList<T extends { id: string }>(list: T[], id: string, move: Move): T[] | null {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const j = move === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return null;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** 새 목록을 0..n으로 다시 매길 때 순서 값이 실제로 바뀌는 행만 (저장 쿼리 수를 줄인다) */
export function orderUpdates<T extends { id: string; order: number }>(next: T[]): { id: string; order: number }[] {
  return next.flatMap((x, order) => (x.order === order ? [] : [{ id: x.id, order }]));
}
