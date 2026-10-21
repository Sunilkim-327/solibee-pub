// 재무 승인 검토용 집행내역 — 상신 엑셀 '월 시트'와 같은 구성 (총합계 → 개인 집행내역 → 출장비 → 본사 집행내역)
// PC: 엑셀과 같은 아홉 열 표 / 모바일: 가로 스크롤 대신 한 줄을 카드 하나로.
// 규정 점검에 걸린 줄은 세부내역 아래에 점검 내용·소명을 붙여 표에서 바로 판단한다.
// 행 구분(DESIGN.md §0 "구분은 1px 선으로"): 줄무늬 없이 모든 줄 사이 불투명 1px `line`, 줄 높이 40px 고정.
// 위계 3단계 — 총합계(brand-50 면·14px bold) > 구간 소계(`line` 면·2px 굵은 위 선·네이비 왼쪽 띠·14px bold)
//            > 결제자 묶음 머리줄(`surface-muted` 면·2px 위 선·13px bold 이름 + 소계 600).
// 개인·출장비 구역은 결제자별 묶음(이름은 머리줄에만, 줄의 결제자 칸은 비움), 같은 날 연속이면 날짜를 흐리게.
// 본사 집행내역은 결제자가 '본사' 하나라 묶음 머리줄 없이 줄만. 머리글은 화면 상단 바 아래에 고정.
import { Fragment } from "react";
import { formatDate, won } from "@/lib/format";
import { MONTH_HEAD, TRAVEL_SECTION, type MonthSheetData, type MonthSheetRow } from "@/lib/month-sheet";
import { groupByPayer, type SheetGroup } from "@/lib/month-sheet-view";

export type SheetMark = { labels: string[]; justification: string | null };

const HEAD = MONTH_HEAD.map((h) => h.replace("\n", "")).map((h) => (h.startsWith("참석자") ? "참석자" : h));
const COLS = HEAD.length;

/** 점검 내용·소명 (세부내역 아래 한 줄) */
function Mark({ m }: { m: SheetMark }) {
  return (
    <div className="mt-0.5 text-xs">
      <span className="font-medium text-amber-800">{m.labels.join(", ")}</span>
      {m.justification
        ? <span className="text-fg-2"> · 소명: {m.justification}</span>
        : <span className="font-semibold text-status-rejected"> · 소명 없음</span>}
    </div>
  );
}

// 규정 점검 면(amber/rose, 기존 그대로) — 줄 구분선 위에서도 가장 먼저 보여야 한다
const markBg = (m?: SheetMark) => (m ? (m.justification ? "bg-amber-50/60" : "bg-rose-50/60") : "");

// 구간 소계 줄의 네이비 왼쪽 띠(3px) — 첫 칸에 inset 그림자 (tr에는 inset shadow가 안 먹는다)
const SECTION_BAR = "shadow-[inset_3px_0_0_var(--color-primary)]";

export function MonthSheetView({ sheet, marks }: { sheet: MonthSheetData; marks: Map<string, SheetMark> }) {
  const { personal, travel, travelSum, hq, st } = sheet;
  const pSum = st.personal - travelSum;
  // 결제자 묶음 순서 = 팀원별 정산금액 칸 순서(결제자 마스터: 직급 → 성명), 공용법인카드 등은 처음 나온 순
  const payerOrder = sheet.slots.map((p) => p.label);
  const sections: { title: string; sum: number; rows: MonthSheetRow[]; groups: SheetGroup[]; grouped: boolean }[] = [
    { title: "직접경비 개인 집행내역", sum: pSum, rows: personal, groups: groupByPayer(personal, payerOrder), grouped: true },
    ...(travel.length ? [{ title: TRAVEL_SECTION, sum: travelSum, rows: travel, groups: groupByPayer(travel, payerOrder), grouped: true }] : []),
    // 본사: 결제자가 '본사' 하나 — 묶음 머리줄 없이 한 묶음으로
    { title: "직접경비 본사 집행내역", sum: st.hq, rows: hq, groups: groupByPayer(hq), grouped: false },
  ];
  const markOf = (r: MonthSheetRow) => (r.id ? marks.get(r.id) : undefined);

  // ── PC: 표 — 줄 40px(14/20 + 상하 10px, tr h-10으로 고정), 세부내역이 길면 자연 확장
  const cell = "px-2 py-2.5 align-top whitespace-nowrap";
  const num = `${cell} tabular text-right`;
  // 줄바꿈 열 (nowrap을 빼야 줄바꿈된다 — 같은 요소에 두 whitespace 유틸리티를 쓰면 nowrap이 이긴다)
  const wrap = "px-2 py-2.5 align-top whitespace-normal";
  // 합계 줄: 총합계(brand 면) / 구간(line 면 + 굵은 위 선 + 네이비 띠) — 둘 다 14px bold
  const sumRow = (title: string, sum: number, cls: string, bar = false) => (
    <tr className={`h-10 font-bold ${cls}`}>
      <td colSpan={2} className={`${cell} ${bar ? SECTION_BAR : ""}`}>{title}</td>
      <td className={num}>{won(sum)}</td>
      <td colSpan={COLS - 3} className={cell} />
    </tr>
  );
  // 결제자 묶음 머리줄: surface-muted 면 + 2px 위 선, 이름 13px bold · N건 12px · 소계 13px 600
  const groupRow = (g: SheetGroup) => (
    <tr className="h-8 border-t-2 border-line-strong bg-surface-muted text-label">
      <td colSpan={2} className="px-2 py-1.5 align-middle whitespace-nowrap font-bold">{g.label} <span className="text-xs font-normal text-fg-muted">· {g.count}건</span></td>
      <td className="px-2 py-1.5 align-middle tabular text-right font-semibold">{won(g.sum)}</td>
      <td colSpan={COLS - 3} className="px-2 py-1.5" />
    </tr>
  );
  // 머리글 고정: 상단 바(모바일 56px·PC 64px) 아래. 조상에 스크롤 컨테이너가 있으면 sticky가 죽으므로
  // 표가 다 들어가는 xl부터는 가로 overflow를 풀고(세로 스크롤은 페이지), 그보다 좁으면 가로 스크롤을 우선한다.
  const th = "sticky top-14 z-10 bg-surface-muted px-2 py-2 align-middle whitespace-nowrap font-medium shadow-[inset_0_-1px_0_var(--color-line)] first:rounded-tl-xl last:rounded-tr-xl lg:top-16";
  const table = (
    <div className="hidden overflow-x-auto rounded-xl border border-line sm:block xl:overflow-x-visible">
      <table className="w-full min-w-[48rem] border-collapse text-sm">
        <thead>
          <tr className="text-xs text-fg-muted">
            {HEAD.map((h, i) => <th key={h} className={`${th} ${i === 2 || i === 7 ? "text-right" : "text-left"}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {sumRow("총합계", st.total, "bg-brand-50")}
          {sections.map((s) => (
            <Fragment key={s.title}>
              {sumRow(s.title, s.sum, "border-t-2 border-line-strong bg-line", true)}
              {s.rows.length === 0
                ? <tr className="h-10 border-t border-line"><td colSpan={COLS} className={`${cell} text-fg-subtle`}>없음</td></tr>
                : s.groups.map((g) => (
                  <Fragment key={g.label}>
                    {s.grouped && groupRow(g)}
                    {g.rows.map(({ row: r, key, sameDate }) => {
                      const m = markOf(r);
                      // 규정 점검 면(amber/rose)이 최우선, 그 밖의 줄은 hover만 (줄무늬 없음 — 선으로 구분)
                      const bg = m ? markBg(m) : "hover:bg-brand-50/60";
                      return (
                        <tr key={key} className={`h-10 border-t border-line transition-colors ${bg}`}>
                          {/* 결제자: 묶음이면 머리줄에만 있으므로 비움 (화면 전용 — 엑셀은 줄마다 기록) */}
                          <td className={cell}>{s.grouped ? "" : r.label}</td>
                          <td className={`${cell} tabular ${sameDate ? "text-fg-subtle" : ""}`}>{formatDate(r.date)}</td>
                          <td className={`${num} font-semibold`}>{won(r.amount)}</td>
                          <td className={cell}>{r.method}</td>
                          <td className={cell}>{r.category}</td>
                          <td className={cell}>{r.item}</td>
                          <td className={`${wrap} w-[16rem] min-w-[10rem]`}>
                            {r.detail ? <div className="line-clamp-2" title={r.detail}>{r.detail}</div> : <span className="text-fg-subtle">-</span>}
                            {m && <Mark m={m} />}
                          </td>
                          <td className={num}>{r.headcount ?? ""}</td>
                          <td className={`${wrap} w-[12rem] min-w-[8rem]`}>{r.attendees ? <div className="line-clamp-2" title={r.attendees}>{r.attendees}</div> : ""}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ── 모바일: 카드 (가로 스크롤 없이) — 같은 위계: 총합계 brand 면 > 구간 line 면·네이비 띠 > 묶음 band(surface-muted, 카드 묶음 머리) > 카드 사이 1px 선
  const cards = (
    <div className="space-y-3 sm:hidden">
      <div className="flex items-baseline justify-between rounded-xl bg-brand-50 px-3 py-2 font-bold">
        <span>총합계</span><span className="tabular">{won(st.total)}원</span>
      </div>
      {sections.map((s) => (
        <section key={s.title} aria-label={s.title}>
          <div className="mb-2 flex items-baseline justify-between gap-3 rounded-lg border-l-[3px] border-primary bg-line px-3 py-1.5 text-sm font-bold">
            <span className="min-w-0 truncate">{s.title}</span><span className="tabular shrink-0">{won(s.sum)}원</span>
          </div>
          {s.rows.length === 0 ? (
            <p className="rounded-xl border border-line px-3 py-2 text-sm text-fg-subtle">없음</p>
          ) : s.groups.map((g) => (
            // 결제자 묶음: band(이름 · N건 · 소계)를 카드 묶음 머리로 붙이고, 카드 안에서는 이름 생략
            <div key={g.label} className="mb-2 overflow-hidden rounded-xl border border-line last:mb-0">
              {s.grouped && (
                <div className="flex items-baseline justify-between gap-3 border-b border-line-strong bg-surface-muted px-3 py-1.5 text-label">
                  <span className="min-w-0 truncate font-bold">{g.label} <span className="text-xs font-normal text-fg-muted">· {g.count}건</span></span>
                  <span className="tabular shrink-0 font-semibold">{won(g.sum)}원</span>
                </div>
              )}
              <ul className="divide-y divide-line">
                {g.rows.map(({ row: r, key, sameDate }) => {
                  const m = markOf(r);
                  return (
                    <li key={key} className={`px-3 py-2 text-sm ${markBg(m)}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`tabular min-w-0 truncate font-semibold ${sameDate ? "text-fg-subtle" : ""}`}>{s.grouped ? formatDate(r.date) : <>{r.label} <span className="font-normal text-fg-muted">{formatDate(r.date)}</span></>}</span>
                        <span className="tabular shrink-0 font-semibold">{won(r.amount)}원</span>
                      </div>
                      <div className="mt-0.5 text-xs text-fg-muted">{r.method} · {r.category} › {r.item}</div>
                      {r.detail && <div className="mt-0.5">{r.detail}</div>}
                      {(r.headcount || r.attendees) && (
                        <div className="mt-0.5 text-xs text-fg-muted">{r.headcount ? `${r.headcount}명` : ""}{r.headcount && r.attendees ? " · " : ""}{r.attendees ?? ""}</div>
                      )}
                      {m && <Mark m={m} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );

  return <>{table}{cards}</>;
}
