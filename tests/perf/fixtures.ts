// 성능 벤치·회귀 스냅샷용 합성 데이터 — 모두 난수로 만든 가상의 값 (실제 업체 파일·이름·금액 사용 금지)
// 규모: 한 달 600줄 · 직원 40명 · 회사 부담 항목 5개 (업체 시트 2장: 식당·카페)
import type { CarryLine, DecideLine, PassItem, PassMember, Sheet, SheetConfig, SummaryLine } from "@/lib/pass-statement";

/** 고정 시드 난수 (mulberry32) — 실행마다 같은 데이터 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const YM = "2026-09";
export const START_DAY = 21; // 8월 21일 ~ 9월 20일
export const MEMBERS = 40;
export const LINES = 600;

export const items: PassItem[] = [
  { id: "it-night", name: "야근식대", perPersonLimit: 12_000 },
  { id: "it-holiday", name: "휴일근무식대", perPersonLimit: 12_000 },
  { id: "it-meeting", name: "회의간식", perPersonLimit: null },
  { id: "it-cafe", name: "카페", perPersonLimit: 6_000 },
  { id: "it-etc", name: "기타", perPersonLimit: null },
];

export const members: PassMember[] = Array.from({ length: MEMBERS }, (_, i) => ({ userId: `u${String(i + 1).padStart(2, "0")}`, name: `직원${String(i + 1).padStart(2, "0")}` }));

const pad2 = (n: number) => String(n).padStart(2, "0");
/** 정산 기간(8/21~9/20) 안의 날짜 — 0~30일째 */
export const dayOf = (n: number) => {
  const d = new Date(Date.UTC(2026, 7, 21 + n));
  return d.toISOString().slice(0, 10);
};

export type PerfLine = SummaryLine & DecideLine & {
  id: string; userId: string | null; holderName: string; amount: number; date: string; time: string; usageItemId: string | null;
  memberClaim: string | null; decision: string | null; onBehalfName: string | null; collectFrom: string | null; collectedAt: Date | null; collectNote: string | null;
  usageItemName: string | null; sheetName: string; placeType: string; extra: string | null; keys: string[]; memberNote: string | null;
};

/** 집계·결정·공제 함수용 줄 600개 (사용자 40명, 날짜·시간·항목·결정·요청이 섞여 있음) */
export function makeLines(seed = 1): PerfLine[] {
  const r = rng(seed);
  const out: PerfLine[] = [];
  for (let i = 0; i < LINES; i++) {
    const m = members[Math.floor(r() * MEMBERS)];
    const unmatched = r() < 0.04;
    const external = !unmatched && r() < 0.03;
    const day = Math.floor(r() * 31);
    const hour = 7 + Math.floor(r() * 14);
    const place = r() < 0.7 ? "식당" : "카페";
    const amount = (place === "식당" ? 40 + Math.floor(r() * 100) : 25 + Math.floor(r() * 40)) * 100;
    const k = r();
    const item = place === "카페" ? items[3] : items[Math.floor(r() * 3)];
    const decision = k < 0.35 ? "OVERTIME" : k < 0.6 ? "DEDUCT" : null;
    const claim = decision ? (r() < 0.5 ? "OVERTIME" : null) : r() < 0.5 ? "OVERTIME" : null;
    const company = decision === "OVERTIME" || (!decision && claim === "OVERTIME");
    out.push({
      id: `ln${String(i + 1).padStart(4, "0")}`, userId: unmatched ? null : m.userId, userName: unmatched ? null : m.name, holderName: unmatched ? `외부${i % 7}` : m.name,
      amount, date: dayOf(day), time: `${pad2(hour)}:${pad2(Math.floor(r() * 60))}:00`,
      usageItemId: company ? item.id : null, usageItemName: company ? item.name : null,
      memberClaim: claim, decision: external ? "DEDUCT" : decision,
      onBehalfName: external ? `방문자${i % 5}` : null, collectFrom: external ? `방문자${i % 5}` : null, collectedAt: external && r() < 0.5 ? new Date(Date.UTC(2026, 8, 25)) : null, collectNote: null,
      sheetName: place, placeType: place, memberNote: null,
      extra: JSON.stringify([{ label: "판매시간", value: `${pad2(hour)}:00:00` }, { label: "상품한글명", value: `메뉴${i % 23}` }, { label: "총금액1", value: String(amount) }]),
      keys: unmatched ? [] : [`사원카드번호:${1000 + Number(m.userId.slice(1))}`],
    });
  }
  // 날짜·시간 순 (화면 목록과 같은 순서)
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

export const FOOD_HEAD = ["판매일자", "판매시간", "고객성명", "사원카드번호", "상품한글명", "매대명", "사원번호", "표시금액1", "개인부담금액", "총금액1"];
export const CAFE_HEAD = ["이용일자", "이용시각", "사용자명", "카드번호", "메뉴", "코너명", "결제금액"];

export const foodConf: SheetConfig = {
  sheetName: "식당", headerRow: 2, nameCol: "고객성명", keyCols: ["사원카드번호"], amountCols: ["총금액1"], dateCol: "판매일자", timeCol: "판매시간",
  display: [{ item: "시간", col: "판매시간" }, { item: "상품", col: "상품한글명" }, { item: "매대", col: "매대명" }, { item: "총금액1", col: "총금액1" }],
};
export const cafeConf: SheetConfig = {
  sheetName: "카페", headerRow: 1, nameCol: "사용자명", keyCols: ["카드번호"], amountCols: ["결제금액"], dateCol: "이용일자",
  display: [{ item: "시간", col: "이용시각" }, { item: "상품", col: "메뉴" }, { item: "매대", col: "코너명" }], label: "카페",
};
export const DISPLAY_KEYS = ["시간", "상품", "매대", "총금액1"];

/** 업체 파일 시트 2장: 식당(표지 1행 + 머리글 + 420줄 + 합계 행), 카페(머리글 + 180줄) */
export function makeSheets(seed = 7): Sheet[] {
  const r = rng(seed);
  const food: (string | number | Date | null)[][] = [["월 사용 내역 (가상)"], FOOD_HEAD];
  const formulas = new Set<string>();
  for (let i = 0; i < 420; i++) {
    const m = members[Math.floor(r() * MEMBERS)];
    const day = Math.floor(r() * 31);
    const amount = (40 + Math.floor(r() * 100)) * 100;
    const dateCell = r() < 0.5 ? dayOf(day).replace(/-/g, ".") : new Date(`${dayOf(day)}T00:00:00Z`);
    food.push([dateCell, `${pad2(11 + Math.floor(r() * 10))}:${pad2(Math.floor(r() * 60))}:00`, r() < 0.02 ? `손님${i % 9}` : m.name, String(1000 + Number(m.userId.slice(1))), `메뉴${i % 23}`, r() < 0.5 ? "A코너" : "B코너", `E${m.userId.slice(1)}`, amount, 0, r() < 0.3 ? `${amount.toLocaleString("en-US")}원` : amount]);
    if (i % 50 === 49) food.push([]);
  }
  food.push(["합계", null, null, null, null, null, null, 0, 0, 0]);
  formulas.add(`${food.length - 1}:9`);
  const cafe: (string | number | Date | null)[][] = [CAFE_HEAD];
  for (let i = 0; i < 180; i++) {
    const m = members[Math.floor(r() * MEMBERS)];
    const day = Math.floor(r() * 31);
    cafe.push([dayOf(day), `${pad2(8 + Math.floor(r() * 12))}:${pad2(Math.floor(r() * 60))}`, m.name, `${1000 + Number(m.userId.slice(1))}`, `음료${i % 11}`, "카페", (25 + Math.floor(r() * 40)) * 100]);
  }
  return [{ name: "식당", table: food, formulas }, { name: "카페", table: cafe }];
}

/** 다시 올리기용 기존 줄 (이어받기 대상) — makeLines를 CarryLine 모양으로 */
export function makeCarryLines(lines: PerfLine[]): CarryLine[] {
  return lines.map((l) => ({
    date: l.date, holderName: l.holderName, amount: l.amount, extra: l.extra, userId: l.userId, memberClaim: l.memberClaim, memberNote: l.memberNote,
    decision: l.decision, usageItemId: l.usageItemId, decisionSource: l.decision ? "PM" : null, decidedBy: l.decision ? "u01" : null, decidedAt: l.decision ? new Date(Date.UTC(2026, 8, 21)) : null,
    onBehalfName: l.onBehalfName, collectFrom: l.collectFrom, collectedAt: l.collectedAt, collectNote: l.collectNote,
  }));
}

/** 기억된 매핑 (카드번호 → 사용자) — 절반만 기억되어 있고 나머지는 이름으로 맞춘다 */
export function makeHolders(): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of members.slice(0, MEMBERS / 2)) m.set(`사원카드번호:${1000 + Number(x.userId.slice(1))}`, x.userId);
  return m;
}
