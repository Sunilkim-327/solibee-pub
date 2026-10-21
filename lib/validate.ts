// API 입력 검증 — 순수함수. 잘못된 값이면 HttpError(400)
import { HttpError } from "./http-error";

/** 이름 길이 제한 (프로젝트·부서) */
export const NAME_MAX = 60;

/**
 * 글자 입력: 앞뒤 공백 제거, 빈 값은 null.
 * undefined는 그대로 돌려준다 (부분 수정에서 "안 바꿈").
 * required: true(기본 메시지) 또는 빈 값일 때 보일 메시지
 */
export function str(v: unknown, label: string, max: number, opts: { required: true | string }): string;
export function str(v: unknown, label: string, max: number, opts?: { required?: boolean | string }): string | null | undefined;
export function str(v: unknown, label: string, max: number, opts: { required?: boolean | string } = {}): string | null | undefined {
  if (v === undefined && !opts.required) return undefined;
  if (v !== undefined && v !== null && typeof v !== "string") throw new HttpError(400, `${label} 값이 올바르지 않습니다.`);
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) {
    if (opts.required) throw new HttpError(400, typeof opts.required === "string" ? opts.required : `${label}을(를) 입력하세요.`);
    return null;
  }
  if (s.length > max) throw new HttpError(400, `${label}은(는) ${max}자 이내로 입력하세요.`);
  return s;
}

/** 문자열 id 목록: 배열·문자열만, 중복 제거, 최대 개수. undefined/null → [] */
export function strArray(v: unknown, label: string, max: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new HttpError(400, `${label} 값이 올바르지 않습니다.`);
  const list = [...new Set(v as string[])];
  if (list.length > max) throw new HttpError(400, `${label}은(는) ${max}개 이하로 지정하세요.`);
  return list;
}

/** 선택 정수: undefined → undefined, null·"" → null, 그 외 정수(min 이상)만 */
export function optInt(v: unknown, label: string, opts: { min?: number } = {}): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  if (!Number.isInteger(n) || (opts.min !== undefined && n < opts.min)) {
    throw new HttpError(400, opts.min === 0 ? `${label}는 0 이상의 정수입니다.` : `${label}는 정수로 입력하세요.`);
  }
  return n;
}
