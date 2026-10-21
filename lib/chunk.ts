// id 목록을 쿼리당 바인딩 값 한도에 맞춰 나눈다 — 순수함수 (서버·테스트 공용)

/**
 * D1은 쿼리당 바인딩 값이 100개까지라, `id IN (…)` 조건의 id가 많으면 "query parameter limit exceeded"로 실패한다.
 * 조건·갱신 값에도 바인딩이 몇 개 들어가므로 기본 90개씩 끊는다.
 */
export const ID_CHUNK = 90;

export function chunkIds<T>(ids: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
