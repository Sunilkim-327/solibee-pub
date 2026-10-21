import { Icon } from "@/components/icons";
import { AutoScrollX } from "@/components/list/AutoScrollX";
import { dash0, won } from "@/lib/format";
import type { getSettlementRange } from "@/lib/settlement-range";

export type SettlementRange = Awaited<ReturnType<typeof getSettlementRange>>;

/** 연간 표 머리글 월: "10월", 첫 열·1월에는 연도를 위에 */
function MonthHead({ ym, first }: { ym: string; first: boolean }) {
  const [y, m] = ym.split("-");
  return (
    <>
      {(first || m === "01") && <span className="block text-xs leading-3 font-medium text-fg-subtle">{y}</span>}
      {Number(m)}월
    </>
  );
}

/**
 * 팀원별 정산 연간 추이 — 결제자 × 월 표 (엑셀 총괄현황과 같은 표). 마감·상신 화면 맨 아래, 기본 접힘.
 * 누적 확인·불일치 달 찾기용: 검증 불일치 달이 있으면 펼쳐 둔다. 선택 월(ym) 열은 강조하고 처음 그릴 때 그 열이 보이게 스크롤.
 * @param range getSettlementRange(함께 상신하는 서브 포함 범위, allMonths) 결과
 * @param allMonths 프로젝트 기간의 달 (회계연도 범위)
 * @param yearTeamTotal 기간 전체 팀원 정산(개인 법인카드) 합
 * @param invalidMonths 팀원별 + 공용 + 본사 ≠ 총합계인 달
 */
export function SettlementTrend({ range, allMonths, ym, yearTeamTotal, invalidMonths }: {
  range: SettlementRange; allMonths: string[]; ym: string; yearTeamTotal: number; invalidMonths: string[];
}) {
  return (
    <details id="trend" className="card group scroll-mt-20 overflow-hidden" open={invalidMonths.length > 0 || undefined}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-sm">
          <b className="text-title">팀원별 정산 연간 추이</b>
          <span className="tabular ml-2 text-fg-muted">누적 팀원 정산 <b className="text-fg">{won(yearTeamTotal)}원</b></span>
          {invalidMonths.length > 0 && <b className="ml-2 text-status-rejected">✕ {invalidMonths.map((m) => `${Number(m.slice(5))}월`).join("·")} 불일치</b>}
        </span>
        <Icon name="chevronDown" className="size-4 shrink-0 text-fg-subtle transition group-open:rotate-180" />
      </summary>
      <AutoScrollX watch={ym}>
        <table className="table border-t border-line [&_tbody_td]:py-2 [&_tbody_tr]:h-10">
          <thead>
            <tr>
              <th className="sticky left-0 z-10">결제자</th>
              {allMonths.map((m, i) => (
                <th key={m} data-current={m === ym ? "" : undefined} className={`text-right align-bottom ${m === ym ? "!bg-brand-100 !text-fg" : ""}`}>
                  <MonthHead ym={m} first={i === 0} />
                </th>
              ))}
              <th className="sm:sticky sm:right-0 z-10 text-right sm:shadow-[-1px_0_0_var(--c-line)]">합계</th>
            </tr>
          </thead>
          <tbody>
            {range.payers.map(({ id, name }) => {
              const vals = allMonths.map((m) => range.byMonth[m].byPayer[id] ?? 0);
              return (
                <tr key={id}>
                  <td className="sticky left-0 z-10 bg-surface whitespace-nowrap font-medium">{name}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`tabular text-right ${v === 0 ? "text-fg-subtle" : ""} ${allMonths[i] === ym ? "bg-brand-50/60 font-semibold" : ""}`}>{dash0(v)}</td>
                  ))}
                  <td className="tabular sm:sticky sm:right-0 z-10 bg-surface text-right font-semibold sm:shadow-[-1px_0_0_var(--c-line)]">{dash0(vals.reduce((a, b) => a + b, 0))}</td>
                </tr>
              );
            })}
            <tr>
              <td className="sticky left-0 z-10 bg-surface text-xs font-semibold text-fg-muted">검증</td>
              {allMonths.map((m) => (
                <td key={m} className={`whitespace-nowrap text-right text-xs ${range.byMonth[m].isValid ? "text-fg-subtle" : "font-semibold text-status-rejected"} ${m === ym ? "bg-brand-50/60" : ""}`}
                  title={range.byMonth[m].isValid ? "TRUE — 합계 일치" : "FALSE — 합계 불일치"}>
                  {range.byMonth[m].isValid ? "✓" : "✕ 불일치"}
                </td>
              ))}
              <td className="sm:sticky sm:right-0 z-10 bg-surface sm:shadow-[-1px_0_0_var(--c-line)]" />
            </tr>
          </tbody>
        </table>
      </AutoScrollX>
    </details>
  );
}
