// 항목 코드 — 재무 승인 담당이 분류별로 관리 (예: ops-01, ops-02 / 공통 기본 항목에서 복사되면 같은 코드를 이어 씀)
import { pad2 } from "./format";


const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

/** 코드 형식 → 문제 메시지 (없으면 null) */
export function itemCodeProblem(code: string): string | null {
  if (!code) return "항목 코드를 입력하세요.";
  if (!CODE_RE.test(code)) return "항목 코드는 영문·숫자·-·_ 2~40자입니다. (예: ops-01)";
  return null;
}

/** 새 항목 코드 추천: 분류 코드 + 두 자리 번호 (이미 있는 번호 다음) — 예) ops-07 */
export function suggestItemCode(categoryId: string, existing: string[]): string {
  const prefix = `${categoryId}-`;
  const used = new Set(existing.map((c) => c.toLowerCase()));
  let n = existing.filter((c) => c.toLowerCase().startsWith(prefix)).length + 1;
  while (used.has(`${prefix}${pad2(n)}`)) n++;
  return `${prefix}${pad2(n)}`;
}

/** 코드 순 정렬 (숫자는 자연 순서: ops-2 < ops-10) */
export const byCode = (a: { code: string | null; name: string }, b: { code: string | null; name: string }) =>
  (a.code ?? "￿").localeCompare(b.code ?? "￿", "en", { numeric: true }) || a.name.localeCompare(b.name, "ko");

/** 항목 글자 입력 길이 상한 */
export const ITEM_TEXT_MAX = { name: 60, accountCode: 40, keywords: 200 } as const;

/**
 * 글자 입력 검사 → 정리된 값 (undefined: 안 보냄, null: 빈 값)
 * 문자열이 아니거나 너무 길면 문제 메시지를 던질 수 있도록 { error }
 */
export function textInput(v: unknown, label: string, max: number): { value: string | null | undefined } | { error: string } {
  if (v === undefined) return { value: undefined };
  if (v === null) return { value: null };
  if (typeof v !== "string") return { error: `${label} 값이 올바르지 않습니다.` };
  const t = v.trim();
  if (t.length > max) return { error: `${label}은(는) ${max}자 이내로 입력하세요.` };
  return { value: t || null };
}
