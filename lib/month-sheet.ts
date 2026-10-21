// 상신 엑셀 '월 시트'의 데이터 — 순수함수 (엑셀 출력 lib/export.ts와 재무팀 검토 화면이 같은 계산을 쓴다)
// 기존 양식 월 시트: 1행 머리글 / 2행 총합계 / 3행~ 직접경비 개인 집행내역 / (출장비) / 직접경비 본사 집행내역 / 오른쪽 K:L 팀원별 정산금액.
import { passSettlementRows, settle } from "./settlement";
import type { PassExcelRow } from "./pass-budget";
import { PAY_METHOD_EXCEL_LABEL, parsePayMethod } from "./types";
import { TRAVEL_CATEGORY_ID } from "./pass-category";
import { parseDateOnly } from "./format";

export const MONTH_HEAD = ["결제자", "날짜", "금액", "결제방법", "분류", "항목", "세부내역", "대상\n인원", "참석자 (거래처명 및 담당자이름/전부기재)"];
/** 출장비 구역 (원본 양식 제목 그대로) — 그 달에 출장비 지출이 있을 때만 만든다 */
export const TRAVEL_SECTION = "출장비(신청서/보고서 품의 필수)";

/**
 * 결제자 라벨 (워크북 전체 공통): 마스터 결제자 + 마스터에 없지만 개인카드로 결제한 사람.
 * 동명이인은 "이름(2)"로 구분하고, SUMIF 와일드카드 문자(* ? ~)·앞머리 비교 연산자(< > =)는 "·"로 바꾼다.
 * "공용법인카드"·"본사"는 예약 라벨이라 사람 이름과 겹치면 번호를 붙인다.
 */
export function payerLabels(
  payers: { id: string; name: string }[],
  expenses: { isHq: boolean; payMethod: string; payerId: string; payer: { name: string } }[],
) {
  const allPayers = [...payers];
  for (const e of expenses) {
    if (!e.isHq && e.payMethod !== "SHARED_CARD" && !allPayers.some((p) => p.id === e.payerId)) allPayers.push({ id: e.payerId, name: e.payer.name });
  }
  const labelOf = new Map<string, string>();
  const usedLabels = new Set(["공용법인카드", "본사"]);
  for (const p of allPayers) {
    const base = p.name.replace(/[*?~]/g, "·").trim().replace(/^[<>=]+/, "·") || "결제자";
    let label = base;
    for (let n = 2; usedLabels.has(label); n++) label = `${base}(${n})`;
    usedLabels.add(label);
    labelOf.set(p.id, label);
  }
  return { allPayers, labelOf };
}

/** 월 시트 한 줄 */
export type MonthSheetRow = {
  label: string; date: Date; amount: number; method: string; category: string; item: string; detail: string; headcount: number | null; attendees: string | null;
  /** 화면용: 지출 id (규정 점검 표시를 줄에 붙일 때) — 출입증 줄은 없음 */
  id?: string;
};

/** 월 시트에 쓰는 지출 칸 */
export type SheetExpense = {
  id?: string;
  isHq: boolean; payMethod: string; payerId: string; payer: { name: string }; date: Date; amount: number; detail: string;
  headcount: number | null; attendees: string | null; itemId: string; yearMonth: string; item: { name: string; categoryId: string; category: { name: string } };
};

/**
 * 월 시트 데이터 (순수함수) — 개인·본사 집행내역 줄, 정산(lib/settlement settle), 팀원별 정산금액 칸
 * @param expenses 그 달 지출 (날짜·입력 순)
 * @param pass 그 달 출입증 회사 부담 확정분 (연결 예산 항목별 한 줄) — 본사 집행내역 끝에, 결제자 칸은 '본사'(본사 합계 SUMIF와 맞춤)
 * @param payersIn 그 달 결제자 마스터 (직급 → 성명)
 * @param labelOf 결제자 라벨 (동명이인 번호 — payerLabels)
 * @param passDate 사용일이 없는 출입증 줄의 날짜 (그 달 말일, 프로젝트 종료일을 넘지 않게)
 * @param passVendor 업체 이름을 모를 때 세부내역에 쓸 이름 (프로젝트의 출입증 이름)
 */
export function monthSheetData(x: {
  ym: string; expenses: SheetExpense[]; pass: PassExcelRow[]; payersIn: { id: string; name: string }[]; labelOf: Map<string, string>; passDate: Date; passVendor?: string;
}) {
  const st = settle([...x.expenses, ...passSettlementRows(x.pass.map((p) => ({ itemId: p.itemId, yearMonth: x.ym, amount: p.amount })))], x.payersIn.map((p) => p.id));
  // 결제자 열: 정산 블록 SUMIF와 맞도록 공용카드·본사는 구분 라벨로 기록
  const label = (e: SheetExpense) => (e.isHq ? "본사" : e.payMethod === "SHARED_CARD" ? "공용법인카드" : x.labelOf.get(e.payerId) ?? e.payer.name);
  const toRow = (e: SheetExpense): MonthSheetRow => ({
    id: e.id, label: label(e), date: e.date, amount: e.amount,
    method: ((m) => (m ? PAY_METHOD_EXCEL_LABEL[m] : e.payMethod))(parsePayMethod(e.payMethod)),
    category: e.item.category.name, item: e.item.name, detail: e.detail, headcount: e.headcount ?? null, attendees: e.attendees ?? null,
  });
  // 출장비(분류 id `trip`) 개인·공용카드 지출은 '출장비' 구역으로 (본사 결제 출장비는 본사 집행내역에 그대로)
  const isTravel = (e: SheetExpense) => !e.isHq && e.item.categoryId === TRAVEL_CATEGORY_ID;
  const personal = x.expenses.filter((e) => !e.isHq && !isTravel(e)).map(toRow);
  const travel = x.expenses.filter(isTravel).map(toRow);
  const travelSum = travel.reduce((a, r) => a + r.amount, 0);
  const hq = [
    ...x.expenses.filter((e) => e.isHq).map(toRow),
    // 출입증 회사 부담 (사용 건마다): 결제자 본사 · 날짜 = 사용일(없으면 그 달 말일) · 결제방법 본사지출 · 세부내역 "항목/업체" · 참석자 = 사용자
    ...x.pass.map((p): MonthSheetRow => ({
      label: "본사", date: (p.date && parseDateOnly(p.date)) || x.passDate, amount: p.amount, method: PAY_METHOD_EXCEL_LABEL.HQ, category: p.categoryName, item: p.itemName,
      detail: `${p.itemName}/${p.vendors.join("·") || x.passVendor || "업체 출입증"}`,
      headcount: p.users.length || null, attendees: p.users.length ? p.users.map((u) => u.name).join(", ") : null,
    })),
  // 본사 집행내역은 날짜순 (본사 결제 지출과 출입증 줄을 섞어서) — 같은 날은 원래 순서
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  // 결제자 마스터 + 마스터에 없지만 이 달에 개인카드로 결제한 사람
  const slotPayers: { id: string; name: string }[] = [...x.payersIn];
  for (const e of x.expenses) {
    if (!e.isHq && e.payMethod !== "SHARED_CARD" && !slotPayers.some((p) => p.id === e.payerId)) slotPayers.push({ id: e.payerId, name: e.payer.name });
  }
  const slots = slotPayers.map((p) => ({ label: x.labelOf.get(p.id) ?? p.name, amount: st.byPayer[p.id] ?? 0 }));
  return { personal, travel, travelSum, hq, st, slots };
}
export type MonthSheetData = ReturnType<typeof monthSheetData>;

/** 출입증 줄 날짜: 그 달 말일 (프로젝트 종료일을 넘지 않게) */
export function passRowDate(ym: string, projectEnd: Date): Date {
  const [y, mo] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0));
  return last > projectEnd ? new Date(Date.UTC(projectEnd.getUTCFullYear(), projectEnd.getUTCMonth(), projectEnd.getUTCDate())) : last;
}
