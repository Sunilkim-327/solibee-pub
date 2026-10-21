"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExpenseRow, InputContext, MasterCategory } from "@/lib/dto";
import { dayLabel, shortDate, won } from "@/lib/format";
import { PAY_METHOD_LABEL, type PayMethod, type Role } from "@/lib/types";
import { ExpenseForm } from "./ExpenseForm";
import { Sheet } from "./Sheet";
import { Empty } from "./common";
import { flagLabel, isAdvisory, parseFlags } from "@/lib/policy";
import { sortPeople } from "@/lib/org";
import { Headcount, ListRow, MetaLine, type RowAccent } from "./list/ListRow";
import { DayGroup, RowList } from "./list/DayGroup";
import { FilterChips } from "./list/FilterChips";
import { FloatingTotal } from "./list/SummaryBar";
import { toCheck, useLedgerFilters, type CheckTab } from "./list/LedgerFilter";
import { initialOf, sortRows, type SortKey } from "./list/model";

type Props = {
  rows: ExpenseRow[];
  /** 하위 프로젝트 포함 취합 시 프로젝트명 표시 */
  showProject?: boolean;
  locked: boolean;
  /** 잠긴 달을 고치려면 필요한 처리 (상태별 안내, lib/closing unlockHint) */
  lockHint?: string;
  projectId: string;
  role: Role;
  /** 필터용 전체 분류 */
  categories: MasterCategory[];
  /** 수정 폼용 입력 가능 항목 */
  inputCategories: MasterCategory[];
  context: InputContext;
  lockedMonths: string[];
  /** 변경계약 과업 선택지 (수정 폼) */
  tasks?: { id: string; label: string; itemIds: string[] | null }[];
  /** 처음 적용할 점검 필터 (?check=flag) */
  initialCheck?: string;
  /** 처음 열 수정 시트 (?edit=지출 id) — 수정 가능한 건만 */
  initialEditId?: string;
};

const sum = (xs: ExpenseRow[]) => xs.reduce((a, r) => a + r.amount, 0);
/** 규정 위반(소명 필요) 플래그가 있는 건 — 행 강조 */
const hasViolation = (r: ExpenseRow) => !!r.flags && parseFlags(r.flags).some((c) => !isAdvisory(c));
/** 소명이 필요한데 비어 있는 건 — 가장 먼저 처리할 것 */
const isUnexplained = (r: ExpenseRow) => hasViolation(r) && !r.justification?.trim();

/**
 * 상단 탭: 전체 / 규정 점검(소명이 필요한 점검에 걸린 건 전부, 소명 완료 포함 — 안내성 ⓘ 제외) / 소명 필요(그중 아직 소명이 없는 건)
 * — "소명 필요"는 현황·할 일과 같은 뜻(용어집: 사유를 적어야 하는 건). 주소의 ?check=flag·unexplained는 식별자라 그대로
 */
const CHECK_OF: Record<CheckTab, (r: ExpenseRow) => boolean> = { "": () => true, flag: hasViolation, unexplained: isUnexplained };
const EMPTY_TEXT: Record<CheckTab, string> = { "": "조건에 맞는 내역이 없어요.", flag: "규정 점검에 걸린 내역이 없어요.", unexplained: "소명이 필요한 내역이 없어요." };

/** 행 앞 배지 — 예외 하나만 (우선순위: 규정 점검 > 변경계약 > 본사 > 공용카드). 기본값(개인카드)은 표시하지 않음 */
function RowBadge({ r }: { r: ExpenseRow }) {
  if (r.flags) {
    const codes = parseFlags(r.flags);
    const bad = codes.filter((c) => !isAdvisory(c));
    const title = bad.map((c) => flagLabel(c, r.itemName)).join(", ");
    if (bad.length && !r.justification?.trim()) return <span className="badge badge-bad" title={`${title} — 소명 필요`}>⚠ 소명 필요</span>;
    return bad.length
      ? <span className="badge badge-warn" title={title}>⚠ {bad.length > 1 ? `점검 ${bad.length}` : bad[0] === "PASS_DUP" ? flagLabel(bad[0], r.itemName) : "점검"}</span>
      : <span className="badge badge-neutral" title={codes.map((c) => flagLabel(c, r.itemName)).join(", ")}>ⓘ 안내</span>;
  }
  if (r.changeLabel) return <span className="badge badge-primary" title={r.changeLabel}>{r.changeLabel.split(" · ")[0]}</span>;
  if (r.isHq) return <span className="badge badge-neutral">본사</span>;
  if (r.payMethod !== "PERSONAL_CARD") return <span className="badge badge-neutral">{PAY_METHOD_LABEL[r.payMethod]}</span>;
  return null;
}

/** 규정 점검 배지 전체 (상세 시트·PC 툴팁) */
function Flags({ flags, itemName }: { flags: string | null | undefined; itemName?: string }) {
  const r = { itemName };
  if (!flags) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {parseFlags(flags).map((c) => (
        <span key={c} className={`badge ${isAdvisory(c) ? "badge-neutral" : "badge-warn"}`}>{isAdvisory(c) ? "ⓘ" : "⚠"} {flagLabel(c, r.itemName)}</span>
      ))}
    </div>
  );
}

type EditFormProps = Pick<React.ComponentProps<typeof ExpenseForm>, "projectId" | "role" | "context" | "lockedMonths" | "tasks" | "pmNames" | "userId">;

/** 지출 수정 시트 — 현황의 지출 내역과 지출 입력의 '내 지출' 목록이 함께 쓴다 (수정 가능한 건만 연다) */
export function ExpenseEditSheet({ row, categories, onClose, ...formProps }: EditFormProps & { row: ExpenseRow; categories: MasterCategory[]; onClose: () => void }) {
  return (
    <Sheet title="지출 수정" onClose={onClose}>
      {row.flags && (
        <div className="mb-4 rounded-lg bg-surface-muted px-3 py-2.5">
          <Flags flags={row.flags} itemName={row.itemName} />
          {row.justification && <p className="mt-1.5 text-xs text-fg-muted">소명: {row.justification}</p>}
        </div>
      )}
      <ExpenseForm key={row.id} {...formProps} categories={categories} initial={row} onDone={onClose} />
    </Sheet>
  );
}

/** 상세 시트의 사실 목록 — 행에서 뺀 정보(참석자·소명·결제방법)를 여기서 본다 */
function ExpenseFacts({ r, showProject }: { r: ExpenseRow; showProject?: boolean }) {
  const facts: [string, React.ReactNode][] = [
    ["날짜", dayLabel(r.date)],
    ["금액", <b key="a" className="tabular">{won(r.amount)}원</b>],
    ["결제자", r.isHq ? "본사" : r.payerName],
    ...(r.enteredByName ? [["입력", `${r.enteredByName} (대신 입력)`] as [string, React.ReactNode]] : []),
    ["결제방법", PAY_METHOD_LABEL[r.payMethod]],
    ["분류 · 항목", `${r.categoryName} · ${r.itemName}`],
    ["세부내역", <>{r.changeLabel && <span className="badge badge-primary mr-1.5">{r.changeLabel}</span>}{r.detail || "-"}</>],
    ...(r.merchant ? [["가맹점", r.merchant] as [string, React.ReactNode]] : []),
    ["참석자", r.attendees ? `${r.attendees}${r.headcount ? ` (${r.headcount}명)` : ""}` : r.headcount ? `${r.headcount}명` : "-"],
    ...(showProject ? [["프로젝트", r.projectName] as [string, React.ReactNode]] : []),
    ...(r.justification ? [["소명", r.justification] as [string, React.ReactNode]] : []),
  ];
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      {facts.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MonthlyTable({ rows, showProject, locked, lockHint, categories, inputCategories, initialCheck, initialEditId, ...formProps }: Props) {
  // 결제자·결제방법·점검 탭은 현황 요약(팀원별 정산·소명 없음 칸)과 함께 쓴다
  const { filters: { payer, method, check }, set } = useLedgerFilters(initialCheck);
  const setPayer = (v: string) => set({ payer: v });
  const setMethod = (v: string) => set({ method: v });
  const setCheck = (v: CheckTab) => set({ check: v });
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  /** 상세 시트 (수정 가능하면 수정 폼) */
  const [open, setOpen] = useState<ExpenseRow | null>(() => {
    const r = initialEditId ? rows.find((x) => x.id === initialEditId) : undefined;
    return r && r.editable && !locked ? r : null;
  });

  // 이 화면에 있는 동안 다른 링크로 ?edit·?check가 새로 오면 적용 (처음 값은 위 초기 상태로)
  useEffect(() => {
    if (!initialEditId) return;
    const r = rows.find((x) => x.id === initialEditId);
    if (r && r.editable && !locked) setOpen(r);
  }, [initialEditId]);
  useEffect(() => {
    if (toCheck(initialCheck)) setCheck(toCheck(initialCheck));
  }, [initialCheck]);

  // 주소의 edit·check 파라미터는 한 번만 적용 (새로고침·뒤로가기·저장 후 다시 열리지 않게).
  // state를 null로 넘겨야 Next 라우터도 바뀐 주소를 따른다 (Next 내부 state를 넘기면 router.refresh() 때 옛 주소로 돌아감)
  useEffect(() => {
    if (!initialEditId && !initialCheck) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    url.searchParams.delete("check");
    window.history.replaceState(null, "", url);
  }, [initialEditId, initialCheck]);

  const payerOptions = useMemo(
    // 결제자 필터: 직급 → 성명 순
    () => sortPeople([...new Map(rows.filter((r) => !r.isHq).map((r) => [r.payerId, { name: r.payerName, position: r.payerPosition }])).entries()], ([, v]) => v)
      .map(([id, v]) => [id, v.name] as const),
    [rows],
  );
  const hasHq = rows.some((r) => r.isHq);
  /** 결제자가 한 명뿐(팀원 본인 화면)이면 결제자 표시·필터를 숨긴다 */
  const showPayer = payerOptions.length > 1 || hasHq || formProps.role !== "MEMBER";
  /** 팀원 본인 화면이고 본사 건이 없으면 PC 표를 구역 머리·소계 없이 행만 (PM용 엑셀 구조를 보이지 않게) */
  const simple = formProps.role === "MEMBER" && !hasHq;
  // 점검 건수는 내역이 바뀔 때만, 거르기·정렬은 조건이 바뀔 때만 (상세 시트 열기 등 다른 상태 변화에는 다시 돌지 않게)
  const { checkCount, unexplainedCount } = useMemo(() => ({ checkCount: rows.filter(hasViolation).length, unexplainedCount: rows.filter(isUnexplained).length }), [rows]);
  const { filtered, personal, hq } = useMemo(() => {
    const needle = q.toLowerCase();
    const filtered = sortRows(rows.filter(
      (r) =>
        (!payer || (payer === "HQ" ? r.isHq : r.payerId === payer && !r.isHq)) &&
        (!category || r.categoryId === category) &&
        (!method || r.payMethod === method) &&
        CHECK_OF[check](r) &&
        (!q || `${r.detail} ${r.attendees ?? ""} ${r.itemName} ${r.merchant ?? ""}`.toLowerCase().includes(needle)),
    ), sort);
    return { filtered, personal: filtered.filter((r) => !r.isHq), hq: filtered.filter((r) => r.isHq) };
  }, [rows, payer, category, method, check, q, sort]);
  const isFiltered = !!(payer || category || method || q || check);
  const canEdit = (r: ExpenseRow) => r.editable && !locked;
  /** 칩·검색 해제 (탭은 유지) */
  const reset = () => { setPayer(""); setCategory(""); setMethod(""); setQ(""); };
  const canEditAny = !locked && rows.some((r) => r.editable);

  /** 상단 탭 (건수 배지). 소명 필요 탭은 해당 건이 있거나 선택됐을 때만 */
  const tabs: [CheckTab, string, number, string][] = [
    ["", "전체", rows.length, "badge-neutral"],
    ["flag", "규정 점검", checkCount, checkCount ? "badge-warn" : "badge-neutral"],
    ...(unexplainedCount || check === "unexplained" ? [["unexplained", "소명 필요", unexplainedCount, unexplainedCount ? "badge-bad" : "badge-neutral"] as [CheckTab, string, number, string]] : []),
  ];
  const tabBar = (
    <div className="seg mb-3 w-full sm:w-auto" role="tablist" aria-label="규정 점검 상태">
      {tabs.map(([k, label, n, tone]) => (
        <button key={k || "all"} type="button" role="tab" aria-selected={check === k} onClick={() => setCheck(k)} className="flex-1 sm:flex-none">
          {label}<span className={`badge tabular ml-0.5 ${tone}`}>{n}</span>
        </button>
      ))}
    </div>
  );

  // 분류·결제방법 필터는 이 달 내역에 있는 것만 (마스터 순서), 고를 것이 하나뿐이면 필터를 숨긴다 (선택 중이면 유지)
  const usedCategories = new Set(rows.map((r) => r.categoryId));
  const categoryOptions = categories.filter((c) => usedCategories.has(c.id) || c.id === category).map((c) => [c.id, c.name] as const);
  const usedMethods = new Set(rows.map((r) => r.payMethod));
  const methodOptions = (Object.keys(PAY_METHOD_LABEL) as PayMethod[]).filter((m) => usedMethods.has(m) || m === method).map((m) => [m, PAY_METHOD_LABEL[m]] as const);
  const chips = (
    <FilterChips
      selects={[
        ...(showPayer ? [{ key: "payer", label: "결제자", value: payer, options: [...payerOptions, ...(hasHq ? [["HQ", "본사"] as const] : [])] }] : []),
        ...(categoryOptions.length > 1 || category ? [{ key: "category", label: "분류", value: category, options: categoryOptions }] : []),
        ...(methodOptions.length > 1 || method ? [{ key: "method", label: "결제방법", value: method, options: methodOptions }] : []),
      ]}
      onSelect={(k, v) => (k === "payer" ? setPayer(v) : k === "category" ? setCategory(v) : setMethod(v))}
      onClearAll={reset} />
  );
  const sortSeg = (
    <div className="seg shrink-0" role="group" aria-label="정렬">
      <button type="button" aria-pressed={sort === "date"} onClick={() => setSort("date")}>날짜순</button>
      <button type="button" aria-pressed={sort === "amount"} onClick={() => setSort("amount")}>금액순</button>
    </div>
  );

  /** 모바일 행 (토스 ListRow형 2줄) */
  const row = (withDate: boolean) => (r: ExpenseRow) => {
    const accent: RowAccent | undefined = isUnexplained(r) ? "bad" : hasViolation(r) ? "warn" : undefined;
    const meta = [
      withDate ? shortDate(r.date) : null,
      showPayer ? (r.isHq ? "본사" : r.payerName) : null,
      r.itemName,
      r.headcount && r.headcount > 1 ? <Headcount n={r.headcount} /> : null,
      showProject ? r.projectName : null,
      r.enteredByName ? `${r.enteredByName} 입력` : null,
    ];
    return (
      <ListRow key={r.id} accent={accent} lead={showPayer ? (r.isHq ? "본" : initialOf(r.payerName)) : undefined}
        badge={<RowBadge r={r} />} title={r.detail || r.itemName} amount={r.amount}
        meta={<MetaLine parts={meta} />}
        sub={r.attendees ? <p className="mt-0.5 line-clamp-2 text-xs break-keep text-fg-muted">참석 {r.attendees}</p> : undefined}
        chevron={canEdit(r)} locked={!canEdit(r) && (locked ? "마감된 달" : "수정할 수 없는 건")}
        onPress={() => setOpen(r)}
        ariaLabel={`${dayLabel(r.date)} ${r.detail || r.itemName} ${won(r.amount)}원 ${canEdit(r) ? "수정" : "상세"}`} />
    );
  };

  return (
    <div className="min-w-0">
      {rows.length > 0 && tabBar}

      {/* 검색 + 정렬 / 필터 칩 */}
      <div className="mb-3 flex items-center gap-2">
        <input className="input min-w-0 flex-1 md:max-w-64 md:flex-none" type="search" placeholder="세부내역·참석자 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색" />
        {sortSeg}
        <span className="ml-auto hidden self-center text-sm text-fg-muted md:inline">
          {isFiltered ? "필터 결과 " : ""}<span className="tabular">{filtered.length}건 · <b className="text-fg">{won(sum(filtered))}원</b></span>
        </span>
      </div>
      <div className="mb-3">{chips}</div>

      {rows.length === 0 ? (
        <div className="card"><Empty>이 달 지출 내역이 없어요.</Empty></div>
      ) : filtered.length === 0 ? (
        payer || category || method || q ? (
          <div className="card"><Empty action={<button type="button" className="btn-secondary btn-sm" onClick={reset}>필터 해제</button>}>조건에 맞는 내역이 없어요.</Empty></div>
        ) : (
          <div className="card"><Empty action={<button type="button" className="btn-secondary btn-sm" onClick={() => setCheck("")}>전체 보기</button>}>{EMPTY_TEXT[check]}</Empty></div>
        )
      ) : (
        <>
          {/* 모바일: 날짜별 ListRow (금액순이면 묶지 않고 날짜를 행에) */}
          <div className="card overflow-clip md:hidden">
            {sort === "date" ? (
              <DayGroup items={filtered} dateOf={(r) => r.date} amountOf={(r) => r.amount} render={row(false)} sticky="surface" band
                headClassName="px-4" inset={showPayer ? "lead" : "text"} />
            ) : (
              <RowList inset={showPayer ? "lead" : "text"}>{filtered.map(row(true))}</RowList>
            )}
          </div>

          {/* 넓은 화면: 표 (열 7개, 행 높이 고정, 머리글·합계 고정) */}
          <div className="card hidden overflow-x-clip md:block">
            <table className="table table-fixed">
              <colgroup>
                <col className="w-24" />{showPayer && <col className="w-20" />}<col /><col className="w-32" /><col className="w-44" /><col className="w-24" />
              </colgroup>
              <thead className="sticky top-14 z-[5] lg:top-16">
                <tr>
                  <th aria-sort={sort === "date" ? "ascending" : "none"}>
                    <button type="button" className="font-semibold hover:text-fg" onClick={() => setSort("date")}>날짜{sort === "date" ? " ▲" : ""}</button>
                  </th>
                  {showPayer && <th>결제자</th>}<th>세부내역</th><th>항목</th><th>참석자</th>
                  <th className="text-right" aria-sort={sort === "amount" ? "descending" : "none"}>
                    <button type="button" className="font-semibold hover:text-fg" onClick={() => setSort("amount")}>금액(원){sort === "amount" ? " ▼" : ""}</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[["개인 집행내역", personal], ["본사 집행내역", hq]].map(([title, list]) => {
                  const xs = list as ExpenseRow[];
                  const name = title as string;
                  if (simple && name === "본사 집행내역") return null;
                  // 빈 구역은 한 줄로 접는다
                  if (xs.length === 0) {
                    return (
                      <tr key={name}>
                        <td colSpan={showPayer ? 5 : 4} className="!py-1.5 text-sm font-semibold text-fg-muted">{name} <span className="font-normal">· 내역 없음</span></td>
                        <td className="tabular !py-1.5 text-right text-xs text-fg-subtle">-</td>
                      </tr>
                    );
                  }
                  return [
                    ...(simple ? [] : [<tr key={`${name}-h`}><td colSpan={showPayer ? 6 : 5} className="bg-surface-muted/60 !py-1.5 text-sm font-semibold text-fg-muted">{name} <span className="tabular font-normal">· {xs.length}건</span></td></tr>]),
                    ...xs.map((r) => (
                      <tr key={r.id} className={`group h-10 cursor-pointer hover:bg-brand-50/40 focus-visible:bg-brand-50/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${isUnexplained(r) ? "bg-rose-50/40" : hasViolation(r) ? "bg-amber-50/40" : ""}`}
                        onClick={() => setOpen(r)} tabIndex={0}
                        aria-label={`${r.detail || r.itemName} ${won(r.amount)}원 ${canEdit(r) ? "수정" : "상세"}`}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(r); } }}>
                        <td className="tabular !py-1.5 whitespace-nowrap text-fg-muted">{shortDate(r.date)}</td>
                        {showPayer && (
                          <td className="!py-1.5 truncate font-medium" title={showProject ? r.projectName : undefined}>
                            {r.isHq ? "본사" : r.payerName}
                            {showProject && <div className="truncate text-xs font-normal text-fg-muted">{r.projectName}</div>}
                          </td>
                        )}
                        <td className="!py-1.5" title={[r.detail, r.justification ? `소명: ${r.justification}` : ""].filter(Boolean).join("\n")}>
                          <div className="flex min-w-0 items-center gap-1.5"><RowBadge r={r} /><span className="truncate">{r.detail}</span></div>
                        </td>
                        <td className="!py-1.5 truncate" title={`${r.categoryName} · ${r.itemName}`}>{r.itemName}</td>
                        <td className="!py-1.5 truncate text-fg-muted" title={r.attendees ? `${r.headcount ? `${r.headcount}명 · ` : ""}${r.attendees}` : undefined}>{r.headcount ? <span className="tabular font-medium text-fg-2">{r.headcount}</span> : null}{r.headcount && r.attendees ? " · " : ""}{r.attendees}</td>
                        <td className="tabular !py-1.5 text-right font-semibold">{won(r.amount)}</td>
                      </tr>
                    )),
                    ...(simple ? [] : [<tr key={`${name}-s`} className="text-sm font-semibold text-fg-muted">
                      <td colSpan={showPayer ? 5 : 4} className="!py-1.5">{name.replace(" 집행내역", "")} 소계</td>
                      <td className="tabular !py-1.5 text-right text-fg">{won(sum(xs))}</td>
                    </tr>]),
                  ];
                })}
              </tbody>
              <tfoot className="sticky bottom-[4.5rem] z-[5] lg:bottom-0">
                <tr className="h-10 bg-surface font-bold shadow-[0_-1px_0_var(--c-line)]">
                  <td colSpan={showPayer ? 5 : 4} className="!border-b-0 !py-1.5">{isFiltered ? "필터 결과 합계" : "총합계"} <span className="tabular text-xs font-medium text-fg-muted">{filtered.length}건</span></td>
                  <td className="tabular !border-b-0 !py-1.5 text-right text-primary">{won(sum(filtered))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {canEditAny && filtered.length > 0 && <p className="mt-2 text-xs text-fg-muted">내역을 누르면 수정할 수 있어요.</p>}

      {/* 모바일: 필터를 걸었을 때 결과 합계 고정 바 */}
      {isFiltered && filtered.length > 0 && (
        <FloatingTotal className="mt-3 md:hidden">
          <span className="text-fg-muted">필터 결과 <b className="text-fg">{filtered.length}건</b></span>
          <b>{won(sum(filtered))}원</b>
        </FloatingTotal>
      )}

      {open && (canEdit(open) ? (
        <ExpenseEditSheet {...formProps} row={open} categories={inputCategories} onClose={() => setOpen(null)} />
      ) : (
        <Sheet title="지출 상세" onClose={() => setOpen(null)}>
          {open.flags && <div className="mb-3"><Flags flags={open.flags} itemName={open.itemName} /></div>}
          <ExpenseFacts r={open} showProject={showProject} />
          <p className="mt-4 text-xs text-fg-muted">{locked ? `마감된 달이라 수정할 수 없습니다. ${lockHint ?? "수정이 필요하면 PM이 마감을 해제해야 합니다."}` : "이 건은 조회만 할 수 있습니다."}</p>
        </Sheet>
      ))}
    </div>
  );
}
