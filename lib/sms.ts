// 법인카드 승인 문자 파싱 — 순수함수
// 카드사마다 형식이 달라 "금액(누적 제외)·월/일·시각·가맹점" 패턴을 공통으로 찾는다. 여러 문자를 한 번에 붙여넣어도 건별로 나눈다.

import { pad2 } from "./format";

export type CardSms = {
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  amount: number | null;
  merchant: string | null;
  cardCompany: string | null;
  cardLast4: string | null;
  installment: string | null; // 일시불 | n개월
  cancelled: boolean;
  raw: string;
};

const CARD_COMPANIES: [RegExp, string][] = [
  [/KB\s*국민|국민/, "KB국민"],
  [/신한/, "신한"],
  [/삼성/, "삼성"],
  [/현대/, "현대"],
  [/하나/, "하나"],
  [/우리/, "우리"],
  [/롯데/, "롯데"],
  [/NH|농협/, "NH농협"],
  [/BC|비씨/, "BC"],
  [/IBK|기업/, "IBK기업"],
  [/씨티|CITI/i, "씨티"],
  [/카카오뱅크/, "카카오뱅크"],
];

const NOISE = /(누적|누계|잔여|한도|총\s*누적|포인트|적립|결제\s*예정|이용\s*가능)/;

/** 붙여넣은 텍스트를 문자 단위로 나눈다 */
function splitMessages(text: string): string[] {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  // [Web발신] / [카드사] 머리글 또는 빈 줄 기준으로 분리
  const parts = t
    .split(/\n\s*\n|(?=\[Web발신\])|(?=\[(?:KB|신한|삼성|현대|하나|우리|롯데|NH|BC)[^\]]*\])/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 한 덩어리에 '승인'이 여러 번 줄바꿈 없이 이어진 경우 → '승인' 앞의 카드사 표기로 다시 나눔
  return parts.flatMap((p) => {
    const hits = [...p.matchAll(/(?:^|\n)[^\n]*?(?:승인|취소)/g)];
    if (hits.length <= 1) return [p];
    const idx = hits.map((h) => h.index ?? 0);
    return idx.map((start, i) => p.slice(start, idx[i + 1]).trim()).filter(Boolean);
  });
}

function inferYear(month: number, day: number, today: Date): number {
  const y = today.getFullYear();
  // 미래 날짜(오늘+3일 초과)면 작년 문자로 본다 (예: 1월에 12월 문자 붙여넣기)
  const candidate = new Date(y, month - 1, day);
  return candidate.getTime() - today.getTime() > 3 * 86400000 ? y - 1 : y;
}

export function parseCardSms(raw: string, today = new Date()): CardSms {
  const text = raw.replace(/\[Web발신\]/g, "").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const flat = lines.join(" ");

  // 금액: '원' 앞 숫자 중 누적·한도 등이 바로 앞에 붙지 않은 첫 번째
  let amount: number | null = null;
  for (const m of flat.matchAll(/([0-9][0-9,]*)\s*원/g)) {
    const before = flat.slice(Math.max(0, (m.index ?? 0) - 8), m.index);
    if (NOISE.test(before)) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (n > 0) {
      amount = n;
      break;
    }
  }

  // 날짜·시각: 10/09 12:34, 10-09 12:34, 10월9일 12:34
  let date: string | null = null;
  let time: string | null = null;
  const dm = flat.match(/(?<!\d)(\d{1,2})[/.-](\d{1,2})(?![\d/.-])/) ?? flat.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (dm) {
    const mo = Number(dm[1]);
    const d = Number(dm[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const y = inferYear(mo, d, today);
      date = `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }
  const tm = flat.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (tm) time = `${pad2(Number(tm[1]))}:${tm[2]}`;

  const cardCompany = CARD_COMPANIES.find(([re]) => re.test(flat))?.[1] ?? null;
  const last4 = flat.match(/\((\d{4})\)|카드\s?(\d{4})|(\d{4})\s?승인|\*(\d{4})/);
  const cardLast4 = last4 ? last4.slice(1).find(Boolean) ?? null : null;
  const inst = flat.match(/일시불|(\d{1,2})\s*개월/);
  const installment = inst ? (inst[0] === "일시불" ? "일시불" : `${inst[1]}개월`) : null;
  const cancelled = /취소/.test(flat);

  // 가맹점: 시각 뒤 같은 줄의 나머지 → 없으면 금액·시각이 아닌 마지막 '내용' 줄
  const clean = (s: string) =>
    s
      .replace(/(누적|누계|잔여|한도|총누적)[\s:]*[0-9,]+\s*원?.*/, "")
      .replace(/([0-9][0-9,]*)\s*원/g, "")
      .replace(/일시불|\d{1,2}\s*개월|승인|취소|\(\d{4}\)|\/|^\s*[-·:]\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  let merchant: string | null = null;
  if (tm) {
    const line = lines.find((l) => l.includes(tm[0]));
    const after = line ? clean(line.slice(line.indexOf(tm[0]) + tm[0].length)) : "";
    if (after) merchant = after;
  }
  if (!merchant) {
    const candidates = lines
      .map(clean)
      .filter((l) => l && !/\d{1,2}[/.-]\d{1,2}|:\d{2}/.test(l))
      .filter((l) => !/님$|\*|^\[|카드$|^(KB|신한|삼성|현대|하나|우리|롯데|NH|BC)/.test(l));
    merchant = candidates.at(-1) ?? null;
  }
  if (merchant) merchant = merchant.replace(/\s*(에서|사용)$/, "").slice(0, 60) || null;

  return { date, time, amount, merchant, cardCompany, cardLast4, installment, cancelled, raw: raw.trim() };
}

export function parseCardSmsBatch(text: string, today = new Date()): CardSms[] {
  return splitMessages(text)
    .map((m) => parseCardSms(m, today))
    .filter((r) => r.amount !== null);
}
