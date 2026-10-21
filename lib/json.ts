// DB JSON 문자열 열 파싱 공통 — 순수함수

/** JSON 문자열 배열(또는 이미 배열) → 문자열 배열. 형식이 다르면 빈 배열 */
export function parseStringArray(raw: string | readonly unknown[] | null | undefined): string[] {
  if (!raw) return [];
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
