// 여러 달 결제자별 정산 (서버 전용) — 팀원별 정산 화면. 단월 정산(getSettlement)과 같은 규칙:
// 결제자 = 결제자 마스터(직급 → 성명), 마스터에 없는 결제자는 뒤에 이름순.
import "server-only";
import { sqlSettlementExpenses, sqlUserInfo } from "./sql-loaders";
import { getPayers } from "./reports";
import { passSettlementRows, settle, type Settlement } from "./settlement";
import { passCompanyLines } from "./queries";
import { passBudgetSpend } from "./pass-budget";
import { servedInMonth } from "./membership";

/**
 * 결제자 행 순서 — 마스터 순서 그대로, 마스터에 없는 결제자는 뒤에 이름순 (순수함수)
 * @param extraIds 정산 금액이 있는 결제자 id (마스터 포함 여부 무관)
 */
export function orderPayers(master: { id: string; name: string }[], extraIds: Iterable<string>, nameOf: (id: string) => string | undefined) {
  const known = new Set(master.map((p) => p.id));
  const extras = [...new Set(extraIds)].filter((id) => !known.has(id))
    .map((id) => ({ id, name: nameOf(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return [...master, ...extras];
}

const isPersonal = (e: { payMethod: string; isHq: boolean }) => e.payMethod === "PERSONAL_CARD" && !e.isHq;

/**
 * 프로젝트(하위 포함 취합 가능)의 월별 정산 + 결제자 행 + 월별·결제자별 개인카드 건수
 * @param opts.onlyPayerId 본인 정산만 보는 사용자(팀원) — 본인 결제 건만 읽고 결제자 마스터는 읽지 않는다
 */
export async function getSettlementRange(projectIds: string[], months: string[], opts: { onlyPayerId?: string } = {}) {
  const own = opts.onlyPayerId;
  const [expenses, master, pass] = await Promise.all([
    // 직접 SQL (lib/sql-loaders.ts) — 같은 조건·같은 칸
    sqlSettlementExpenses(projectIds, months, own),
    own ? [] : getPayers(projectIds),
    // 출입증 회사 부담 확정분 — 본사 집행으로 총합계에 (상신 엑셀과 같은 합계). 본인 정산(팀원)에는 넣지 않는다. 현황 예산 집계와 같은 조회
    own ? [] : passCompanyLines(projectIds.join(",")),
  ]);
  // 월별로 한 번 나누고, 같은 순회에서 월별·결제자별 개인카드 건수도 센다
  const rowsOf = new Map<string, typeof expenses>(months.map((m) => [m, []]));
  const counts = new Map<string, number>();
  for (const e of expenses) {
    rowsOf.get(e.yearMonth)?.push(e);
    if (isPersonal(e)) counts.set(`${e.yearMonth}|${e.payerId}`, (counts.get(`${e.yearMonth}|${e.payerId}`) ?? 0) + 1);
  }
  const passRows = passSettlementRows(passBudgetSpend(pass).confirmedRows);
  const byMonth: Record<string, Settlement> = Object.fromEntries(months.map((m) => [
    m, settle([...(rowsOf.get(m) ?? []), ...passRows.filter((r) => r.yearMonth === m)], master.filter((p) => servedInMonth(p, m)).map((p) => p.id)),
  ]));
  const countOf = (ym: string, payerId: string) => counts.get(`${ym}|${payerId}`) ?? 0;

  // 결제자(마스터 + 지출 결제자)의 이름·직급·소속을 한 번에 — 이름은 마스터에 없는 결제자만 쓴다
  const names = new Map<string, string>(master.map((p) => [p.id, p.name]));
  const people = [...new Set([...master.map((p) => p.id), ...expenses.map((e) => e.payerId)])];
  const info = people.length ? await sqlUserInfo(people) : [];
  for (const u of info) if (!names.has(u.id)) names.set(u.id, u.name);
  const payers = orderPayers(master, Object.values(byMonth).flatMap((s) => Object.keys(s.byPayer)), (id) => names.get(id));

  // 표시용: 직급·소속 (동명이인 구분 2줄째) — 정산 계산에는 쓰지 않는다
  const subOf = new Map(info.map((u) => [u.id, [u.position, u.department?.name].filter(Boolean).join(" · ")]));

  return { byMonth, payers: payers.map((p) => ({ ...p, sub: subOf.get(p.id) ?? "" })), countOf };
}
