// 항목 이름·코드 중복 — 앱 검사 문구와 DB 유니크 제약(P2002) 매핑을 한곳에 (설계 검토(2026-10-14) P1-8)
// 서버 모듈 의존 없음 (Prisma 모듈을 불러오지 않고 오류 모양만 본다 — 순수 함수·테스트에서 사용)
import { HttpError } from "./http-error";

/** 같은 프로젝트에 같은 이름의 항목 */
export const itemNameDupMessage = (name: string) => `이미 같은 이름의 항목이 있습니다: ${name}`;
/** 같은 프로젝트에 같은 코드의 항목 */
export const itemCodeDupMessage = (code: string) => `이미 같은 코드의 항목이 있습니다: ${code}`;

/**
 * Prisma 유니크 위반(P2002)을 409 HttpError로. 경합 등으로 사전 검사를 지나친 경우를 받는다.
 * meta.target(SQLite: 열 이름 배열, 예 ["projectId","code"])에 code가 있으면 코드 중복, 아니면 이름 중복으로 안내.
 * 그 밖의 오류는 그대로 던진다 (라우트 래퍼가 처리).
 */
export function itemUniqueError(err: unknown, value: { name?: string | null; code?: string | null }): HttpError | null {
  const e = err as { code?: unknown; meta?: { target?: unknown } } | null;
  if (!e || typeof e !== "object" || e.code !== "P2002") return null;
  const target = Array.isArray(e.meta?.target) ? e.meta.target.map(String) : typeof e.meta?.target === "string" ? [e.meta.target] : [];
  const byCode = target.some((t) => t.toLowerCase().includes("code"));
  if (byCode && value.code) return new HttpError(409, itemCodeDupMessage(value.code));
  if (!byCode && value.name) return new HttpError(409, itemNameDupMessage(value.name));
  // 대상 열을 모르면 둘 중 있는 값으로
  return new HttpError(409, value.name ? itemNameDupMessage(value.name) : itemCodeDupMessage(value.code ?? ""));
}

/** 항목 생성·수정을 감싸 P2002를 409로 바꾼다 */
export async function withItemUnique<T>(value: { name?: string | null; code?: string | null }, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw itemUniqueError(err, value) ?? err;
  }
}
