// 지출 규정 점검 — 순수함수. 위반(flag)이 있으면 소명 사유가 있어야 저장된다 (안내 성격의 flag는 소명 없이 저장).
// 근거: 사내 법인카드 내규 관행(주말·한도·중복), 세무상 계정 구분(임직원만 → 복리후생비, 거래처 포함 → 기업업무추진비)

import { won } from "./format";

export const FLAG_CODES = ["PER_PERSON", "PER_CASE", "OVER_BUDGET", "DUPLICATE", "PASS_DUP", "ACCOUNT_CHECK"] as const;
export type FlagCode = (typeof FLAG_CODES)[number];
const FLAG_CODE_SET: ReadonlySet<string> = new Set(FLAG_CODES);
const isFlagCode = (v: string): v is FlagCode => FLAG_CODE_SET.has(v);

export const FLAG_LABEL: Record<FlagCode, string> = {
  PER_PERSON: "1인당 한도 초과",
  PER_CASE: "1건 한도 초과",
  OVER_BUDGET: "예산 잔액 초과",
  DUPLICATE: "중복 의심",
  PASS_DUP: "출입증 중복 의심",
  ACCOUNT_CHECK: "계정 확인 필요",
};

/**
 * 점검 이름 (항목 이름을 알면 항목으로): 출입증 중복 의심 → "야근 식대 중복 의심"
 * 같은 사람·같은 날 카드 지출 항목이 출입증 회사 부담 줄의 연결 예산 항목과 같을 때 (lib/pass-budget.ts)
 */
export const flagLabel = (code: FlagCode, itemName?: string | null) =>
  code === "PASS_DUP" && itemName ? `${itemName} 중복 의심` : FLAG_LABEL[code];
export const passDupMessage = (itemName: string) => `${itemName} 중복 의심 — 같은 날 출입증으로 회사 부담한 사용분이 있습니다.`;

/**
 * 안내만 하고 소명은 받지 않는 점검 — 기록(flag)은 남긴다.
 * 계정 확인: 같은 프로젝트를 하는 협력사 프리랜서처럼 거래처가 아닌 외부인도 있어 판단은 입력자에게 맡긴다.
 */
const ADVISORY_FLAGS: FlagCode[] = ["ACCOUNT_CHECK"];
export const isAdvisory = (code: FlagCode) => ADVISORY_FLAGS.includes(code);
/** 소명 사유가 있어야 저장되는지 */
export const needsJustification = (flags: { code: FlagCode }[]) => flags.some((f) => !isAdvisory(f.code));

export const ACCOUNT_CHECK_MESSAGE = "거래처가 참석했다면 복리후생비가 아닌 기업업무추진비(회의비) 항목일 수 있습니다.";
/** 외부인 참석 + 복리후생비 계정 항목 → 계정 확인 안내 */
export const accountCheck = (hasExternal: boolean, accountCode: string | null | undefined) => hasExternal && !!accountCode?.includes("복리후생");

export type PolicyInput = {
  amount: number;
  headcount: number | null;
  date: Date; // UTC 자정 기준 일자
  hasExternal: boolean;
  item: { name: string; accountCode: string | null; perPersonLimit: number | null; perCaseLimit: number | null };
  /** 이 건을 제외한 항목 예산 잔액 (예산 없으면 null) */
  remainingBefore: number | null;
  /** 예산 이름 (묶음이면 "○○ 묶음") — 없으면 항목 이름 */
  budgetName?: string;
  /** 같은 결제자·같은 날짜·같은 금액의 다른 건 수 */
  sameEntries: number;
  /** 같은 결제자·같은 날 이 항목에 연결된 출입증 회사 부담 사용분이 있음 */
  passDuplicate?: boolean;
};

export type Flag = { code: FlagCode; message: string };

/**
 * 한도 초과 건의 정산 금액 — 한도를 넘긴 결제는 한도 금액까지만 정산하고 초과분은 본인 부담.
 * 한도 = 1인당 한도 × 대상인원(인원을 알 때), 1건 한도 중 작은 값. 넘지 않으면 null
 */
export type LimitCap = { cap: number; original: number; over: number };
export function limitCap(amount: number, headcount: number | null, item: { perPersonLimit: number | null; perCaseLimit: number | null }): LimitCap | null {
  const caps: number[] = [];
  if (item.perPersonLimit && headcount && headcount > 0) caps.push(item.perPersonLimit * headcount);
  if (item.perCaseLimit) caps.push(item.perCaseLimit);
  if (!caps.length) return null;
  const cap = Math.min(...caps);
  return amount > cap ? { cap, original: amount, over: amount - cap } : null;
}

/** 세부내역 뒤에 붙는 결제금액 표기 "(결제금액:13,000원)" — 한도로 정산한 건의 원래 결제 금액 */
export const PAID_NOTE_RE = /\s*\(결제금액:[\d,]+원\)\s*$/;
export const paidNote = (original: number) => `(결제금액:${won(original)}원)`;
/** 세부내역 + 결제금액 표기 (이미 붙어 있으면 새 금액으로 바꾼다) */
export function withPaidNote(detail: string, original: number): string {
  return `${detail.replace(PAID_NOTE_RE, "").trim()} ${paidNote(original)}`;
}
/** 한도 정산 안내: "한도 12,000원으로 정산 (결제금액 13,000원, 본인 부담 1,000원)" */
export const capNote = (c: LimitCap) => `한도 ${won(c.cap)}원으로 정산 (결제금액 ${won(c.original)}원, 본인 부담 ${won(c.over)}원)`;

export function checkPolicy(x: PolicyInput): Flag[] {
  const flags: Flag[] = [];
  const { item } = x;
  // 한도를 넘긴 결제는 한도까지만 정산 — 예산 잔액 비교·저장 금액은 정산 금액(charged) 기준
  const cap = limitCap(x.amount, x.headcount, item);
  const charged = cap?.cap ?? x.amount;
  // 1인당 한도: 정수 비교 (금액 > 한도 × 인원), 표시만 반올림한 1인당 금액
  if (item.perPersonLimit && x.headcount && x.headcount > 0) {
    if (x.amount > item.perPersonLimit * x.headcount) {
      const per = Math.round(x.amount / x.headcount);
      flags.push({ code: "PER_PERSON", message: `1인당 ${won(per)}원 — ${item.name} 1인당 한도 ${won(item.perPersonLimit)}원 초과 → ${capNote(cap!)}` });
    }
  }
  if (item.perCaseLimit && x.amount > item.perCaseLimit) {
    flags.push({ code: "PER_CASE", message: `${item.name} 1건 한도 ${won(item.perCaseLimit)}원 초과 → ${capNote(cap!)}` });
  }
  // 주말·심야 사용은 점검하지 않는다 (2026-10-15 확정 — 긴급 장애 등으로 주말·심야 출근이 있어 규정 점검 대상에서 제외. 다시 묻지 않는다)
  if (x.remainingBefore !== null && charged > x.remainingBefore) {
    flags.push({
      code: "OVER_BUDGET",
      message: `${x.budgetName ?? item.name} 예산 잔액 ${won(Math.max(0, x.remainingBefore))}원을 초과합니다.`,
    });
  }
  if (x.sameEntries > 0) flags.push({ code: "DUPLICATE", message: "같은 날짜·같은 금액의 지출이 이미 있습니다." });
  if (x.passDuplicate) flags.push({ code: "PASS_DUP", message: passDupMessage(item.name) });
  if (accountCheck(x.hasExternal, item.accountCode)) flags.push({ code: "ACCOUNT_CHECK", message: ACCOUNT_CHECK_MESSAGE });
  return flags;
}

export const encodeFlags = (flags: Flag[]) => (flags.length ? flags.map((f) => f.code).join(",") : null);
/** 저장된 flags 문자열 → 코드 목록 (알 수 없는 코드는 버림) */
export const parseFlags = (s: string | null | undefined): FlagCode[] => (s ? s.split(",").map((c) => c.trim()).filter(isFlagCode) : []);
/** 확인이 필요한 건(소명이 필요한 점검이 있음) — 안내성 점검만 있으면 제외. 월별 '소명 필요' 탭·할 일·마감 체크리스트가 같은 기준을 쓴다 */
export const needsReview = (flags: string | null | undefined): boolean => parseFlags(flags).some((c) => !isAdvisory(c));
export const decodeFlags = parseFlags;
/**
 * 소명 없는 규정 점검 건 — "규정 점검" 할 일의 유일한 기준.
 * 대시보드 숫자·할 일·지출 입력 배너·마감 체크리스트가 모두 이 함수를 쓴다.
 */
export const isUnexplained = (e: { flags: string | null | undefined; justification?: string | null }): boolean =>
  needsReview(e.flags) && !e.justification?.trim();

/** 금액 한글 병기: 123000 → "12만 3,000원" (0 이하·정수 아님은 "") */
export function koreanWon(n: number): string {
  if (!Number.isInteger(n) || n <= 0) return "";
  const eok = Math.floor(n / 100000000);
  const man = Math.floor((n % 100000000) / 10000);
  const rest = n % 10000;
  return [eok && `${won(eok)}억`, man && `${won(man)}만`, rest && won(rest)]
    .filter(Boolean)
    .join(" ") + "원";
}

/** "2026-10-09" → "10/9(금)" */
export function dateWithWeekday(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]})`;
}
