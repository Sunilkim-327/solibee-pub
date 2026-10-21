"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { monthsLabel, won } from "@/lib/format";
import { BUDGET_REASON_MIN } from "@/lib/snapshot";
import { bundleAlias } from "@/lib/budget-bundle";
import { ProjectProgress } from "./ProjectProgress";
import { burnSeries, monthAvailable, monthItemRows, splitConfirmed } from "@/lib/settlement";
import { BurnChart } from "./charts/BurnChart";
import type { ClosingStatus } from "@/lib/types";
import { useRun, type RunColors } from "./hooks/useRun";
import type { BudgetItem, BudgetLineInit, CategoryRef, ChangeRef, Line, MonthRef, PassCompany, PricePatch, Settings, Template } from "./budget/types";
import { allFolded, applyOrder, baseSettings, budgetLookups, buildBudgetIndex, categoryGauge, foldStorageKey, lineAmount, newKey, parseFold, passLinkedByKey, passLinkedIndex, serializeFold, swapIds, toggleFold, toggleFoldAll, ymDot } from "./budget/model";
import { useBudgetAutosave } from "./budget/useBudgetAutosave";
import { CategoryHead } from "./budget/ui";
import { ItemRow } from "./budget/ItemRow";
import { CategoryBudgetCard } from "./budget/CategoryBudgetCard";
import { MonthlyView } from "./budget/MonthlyView";
import { MonthItems } from "./budget/MonthItems";
import { AddItemButton } from "./budget/AddItemButton";
import { PassItemsPanel } from "./budget/PassItemsPanel";
import { useConfirm } from "./ConfirmDialog";

export type { BudgetItem, BudgetLineInit, PassCompany } from "./budget/types";

type Props = {
  projectId: string;
  readOnly: boolean;
  period: { start: string; end: string; months: number };
  months: MonthRef[];
  categories: CategoryRef[];
  items: BudgetItem[];
  /** 출입증 회사 부담 항목 — 연결 예산 항목이 있으면 확정분이 그 예산 항목의 집행에 합쳐진다 */
  passItems: BudgetItem[];
  passEnabled: boolean;
  /** 공통 항목 (가져오기용) */
  templates: Template[];
  /** 출입증 분류의 공통 항목 (가져오기용) */
  passTemplates: Template[];
  /** 출입증 항목 id → 회사 부담 */
  passCompany: Record<string, PassCompany>;
  initialLines: BudgetLineInit[];
  /** 항목별 집행 (묶음 반영 전 원래 항목 기준) = 카드 지출 + 출입증 확정분(연결 예산 항목) */
  spent: Record<string, number>;
  monthly: Record<string, Record<string, number>>;
  changes: ChangeRef[];
  contract: { original: number; delta: number } | null;
  /** 지난 개월수 (이번 달 포함) — 기간 경과 눈금·속도 판정 */
  elapsed?: number;
  /** 종료 시 예상 총액 (서버 집계) */
  forecast?: number;
  /** 월 → 마감 상태 (마감분·작성중분 구분) */
  closings?: Record<string, string>;
  /** 이번 달 "YYYY-MM" (이번 달 가용) */
  now?: string;
  /** 처음 보기 — ?view=monthly 로 열면 월별 (현황의 '항목별 월 배정' 링크) */
  initialView?: "items" | "monthly";
  /** 월별 보기에서 고른 달 "YYYY-MM" (?ym=, 없으면 이번 달) */
  ym?: string;
  /** 집행 추이 차트 (월별 지출·마감 상태) — 계획은 화면의 예산 합계를 써서 자동 저장 즉시 반영 */
  burn?: { months: string[]; amounts: number[]; statuses: ClosingStatus[]; now: string; elapsed: number };
};

const NOTE_COLORS: RunColors = { ok: "text-emerald-700", error: "text-rose-600" };

// ───────────────────────── 화면

export function ProjectBudget(p: Props) {
  const edit = !p.readOnly;
  const [lines, setLines] = useState<Line[]>(() =>
    p.initialLines.map((l) => ({ key: newKey(), itemId: l.itemId, detail: l.detail, unitPrice: l.unitPrice, periods: l.periods, changeId: l.changeId ?? "", bundle: l.bundleItemIds })),
  );
  const [items, setItems] = useState(p.items);
  const [categories, setCategories] = useState(p.categories);
  const [settings, setSettings] = useState<Record<string, Settings>>({});
  // 펼친 항목(추이 패널) — 여러 개 동시에 열 수 있다. settingsFor: 항목 추가 직후 자동으로 여는 설정 시트
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [view, setView] = useState<"items" | "monthly">(p.initialView ?? "items");
  // 보기를 바꾸면 주소에도 남긴다 (?view=monthly) — 월별 보기에서 달을 바꿀 때(?ym=) 서버가 다시 그려도 보기가 유지되게
  const changeView = (k: "items" | "monthly") => {
    setView(k);
    const q = new URLSearchParams(window.location.search);
    if (k === "monthly") q.set("view", "monthly"); else q.delete("view");
    const s = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  };
  const [showInactive, setShowInactive] = useState(false);
  // ── 분류 접기 (항목 보기): 접힌 분류 id 집합 — 기본은 모두 펼침, 이 브라우저에 프로젝트별로 기억 (저장소를 못 쓰면 기본 상태)
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try { setFolded(parseFold(localStorage.getItem(foldStorageKey(p.projectId)))); } catch { /* 기본 상태 */ }
  }, [p.projectId]);
  const saveFold = (next: Set<string>) => {
    setFolded(next);
    try { localStorage.setItem(foldStorageKey(p.projectId), serializeFold(next)); } catch { /* 기억하지 못할 뿐 */ }
  };
  const toggleCat = (categoryId: string) => saveFold(toggleFold(folded, categoryId));
  /** 접힌 분류에 항목이 생기거나 펼친 항목이 있으면 그 분류를 자동으로 펼친다 */
  const unfoldCat = (categoryId: string | undefined) => { if (categoryId && folded.has(categoryId)) saveFold(toggleFold(folded, categoryId)); };
  /** 알림 (성공은 잠깐, 오류는 닫을 때까지) */
  const note = useRun(NOTE_COLORS);
  const { confirm, askReason, dialog } = useConfirm();

  // ── 자동 저장: 바꾸고 0.8초 동안 더 바꾸지 않으면 저장 (저장 버튼 없음)
  const autosave = useBudgetAutosave({
    projectId: p.projectId, lines, settings,
    // 승인된 달이 있으면 사유를 한 번 받는다 (서버 409 APPROVED_EXISTS) — 승인본 엑셀은 그대로, 현재 데이터만 바뀐다
    askReason: (months) => askReason({
      title: "승인된 달이 있는 예산 변경",
      message: `승인된 달(${monthsLabel(months)})이 있는 예산을 바꿉니다. 승인본 엑셀은 그대로 남습니다. 사유를 ${BUDGET_REASON_MIN}자 이상 적어 주세요.`,
      placeholder: "예: 변경계약 2차 반영으로 야근식대 단가 조정", required: true, confirmLabel: "사유와 함께 저장",
    }),
    onSettingsSaved: (ready) => {
      const saved = new Map(ready);
      setItems((list) => list.map((i) => { const v = saved.get(i.id); return v ? { ...i, ...v, name: v.name.trim() } : i; }));
      // 저장하는 동안 다시 바뀐 항목은 남긴다
      setSettings((cur) => { const n = { ...cur }; for (const [id, v] of ready) if (JSON.stringify(n[id]) === JSON.stringify(v)) delete n[id]; return n; });
    },
    onError: (text) => note.setMsg({ ok: false, text }),
  });

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const nameOf = (id: string) => itemById.get(id)?.name ?? "삭제된 항목";
  const setOf = (i: BudgetItem): Settings => settings[i.id] ?? baseSettings(i);

  // 묶음: 묶인 항목의 지출은 대표 항목으로
  const alias = useMemo(() => bundleAlias(lines.map((l) => ({ itemId: l.itemId, bundleItemIds: l.bundle }))), [lines]);
  const index = useMemo(() => buildBudgetIndex(items, lines, alias, p.spent, p.monthly), [items, lines, alias, p.spent, p.monthly]);
  const itemIds = useMemo(() => new Set(itemById.keys()), [itemById]);
  const { linesOf, plannedOf, spentOf, monthOf } = budgetLookups(index, itemIds, p.spent);
  // 출입증 회사 부담 → 연결 예산 항목 (묶음이면 대표 항목으로 모아 그 줄의 카드·출입증 나눔 표시)
  const passLinked = useMemo(() => passLinkedByKey(passLinkedIndex(p.passItems, p.passCompany), alias), [p.passItems, p.passCompany, alias]);

  const totals = useMemo(() => {
    const planned = lines.reduce((a, l) => a + lineAmount(l), 0);
    const spent = Object.values(p.spent).reduce((a, b) => a + b, 0);
    const budgeted = new Set(lines.map((l) => l.itemId));
    const unbudgeted = Object.entries(p.spent).filter(([id, v]) => v > 0 && !budgeted.has(alias.get(id) ?? id)).reduce((a, [, v]) => a + v, 0);
    return { planned, spent, unbudgeted };
  }, [lines, p.spent, alias]);

  // ── 편집
  const touch = (what: "lines" | "settings" = "lines") => { autosave.markDirty(what); note.setMsg(null); };
  const patchLine = (key: string, patch: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); touch(); };
  const removeLine = (key: string) => { setLines((ls) => ls.filter((l) => l.key !== key)); touch(); };
  const addLine = (itemId: string, unitPrice = 0, periods = p.period.months) => { setLines((ls) => [...ls, { key: newKey(), itemId, detail: "", unitPrice, periods, changeId: "", bundle: [] }]); touch(); };
  /**
   * 한 행짜리 항목의 단가·기간: 행이 없으면 만들고(기간 기본 = 프로젝트 개월 수), 단가 0·내용 없는 행은 지운다.
   * 기간 = 단가를 쓸 수 있는 횟수 (12 = 매월, 1 = 한 번, 3 = 기간 중 3번)
   */
  const setPrice = (itemId: string, patch: PricePatch) => {
    const own = linesOf(itemId);
    if (!own.length) {
      if (patch.unitPrice || patch.periods) { setLines((ls) => [...ls, { key: newKey(), itemId, detail: "", unitPrice: patch.unitPrice ?? 0, periods: patch.periods ?? p.period.months, changeId: "", bundle: [] }]); touch(); }
      return;
    }
    const l = own[0];
    if (patch.unitPrice === 0 && !l.detail && !l.bundle.length && !l.changeId) removeLine(l.key);
    else patchLine(l.key, patch);
  };
  // 저장 대기 값은 updater 안에서 읽는다 (같은 렌더에서 여러 번 바뀌어도 앞의 변경을 잃지 않게)
  const setItemSetting = (i: BudgetItem, patch: Partial<Settings>) => { setSettings((s) => ({ ...s, [i.id]: { ...(s[i.id] ?? baseSettings(i)), ...patch } })); touch("settings"); };
  const addBundle = (itemId: string, extra: string) => {
    const own = linesOf(itemId);
    if (!own.length) { setLines((ls) => [...ls, { key: newKey(), itemId, detail: "", unitPrice: 0, periods: p.period.months, changeId: "", bundle: [extra] }]); touch(); return; }
    patchLine(own[0].key, { bundle: [...own[0].bundle, extra] });
  };
  const removeBundle = (itemId: string, extra: string) => {
    const l = linesOf(itemId).find((x) => x.bundle.includes(extra));
    if (l) patchLine(l.key, { bundle: l.bundle.filter((x) => x !== extra) });
  };

  /** 항목 삭제 — 바로 반영 (지출·출입증·예산 행 기록이 있으면 서버가 막고 '사용 안 함'을 안내, P1-7 정책) */
  async function deleteItem(i: BudgetItem) {
    // 지출·예산 행이 있는 항목은 지우면 정산 기록이 깨지므로 '사용 안 함'으로
    const offerOff = async () => {
      if (setOf(i).active && await confirm({ message: `'${i.name}'은(는) 사용 기록이 있어 삭제할 수 없습니다.\n대신 '사용 안 함'으로 바꿀까요? 입력 화면에서만 빠지고 기록·예산은 남습니다.`, confirmLabel: "사용 안 함으로" })) {
        setItemSetting(i, { active: false });
      }
    };
    if ((p.spent[i.id] ?? 0) > 0 || linesOf(i.id).length > 0) { await offerOff(); return; }
    if (!(await confirm({ message: `'${i.name}' 항목을 삭제할까요?\n다른 항목의 묶음에서도 빠지며 되돌릴 수 없습니다.`, confirmLabel: "삭제", danger: true }))) return;
    note.setMsg(null);
    try {
      // 진행 중인 자동 저장이 끝난 뒤 삭제 (저장 중인 예산 행·설정과 겹치지 않게)
      await autosave.exclusive(() => api(`/api/master/items/${i.id}`, { method: "DELETE" }));
      setItems((l) => l.filter((x) => x.id !== i.id));
      setLines((ls) => ls.filter((l) => l.itemId !== i.id).map((l) => ({ ...l, bundle: l.bundle.filter((b) => b !== i.id) })));
      setSettings((s) => { const n = { ...s }; delete n[i.id]; return n; });
      setOpen((s) => { if (!s.has(i.id)) return s; const n = new Set(s); n.delete(i.id); return n; });
      setSettingsFor((v) => (v === i.id ? null : v));
      note.setMsg({ ok: true, text: `'${i.name}' 항목을 삭제했습니다.` });
    } catch (e) {
      // 출입증 사용 등 다른 기록이 있어 서버가 막은 경우
      if ((e as { data?: { inUse?: boolean } }).data?.inUse) await offerOff();
      else note.setMsg({ ok: false, text: (e as Error).message });
    }
  }

  /** 같은 분류 안에서 순서 이동 — 화면에 바로 반영하고 서버에 저장 (엑셀 예산 시트 순서도 같음) */
  async function moveItem(i: BudgetItem, dir: "up" | "down") {
    const same = items.filter((x) => x.categoryId === i.categoryId);
    const k = same.findIndex((x) => x.id === i.id);
    const j = dir === "up" ? k - 1 : k + 1;
    if (k < 0 || j < 0 || j >= same.length) return;
    const other = same[j].id;
    // 두 항목 자리만 맞바꿈 (그 사이 저장된 항목 설정을 덮어쓰지 않게 updater로)
    setItems((list) => swapIds(list, i.id, other));
    try {
      const r = await autosave.exclusive(() => api<{ order: string[] }>(`/api/master/items/${i.id}`, { method: "PATCH", json: { move: dir } }));
      // 저장된 순서(서버 기준)로 맞춘다 — 화면과 서버 순서가 어긋나 있었어도 새로고침 결과와 같게
      if (r?.order) setItems((list) => applyOrder(list, r.order));
    } catch (e) {
      setItems((list) => swapIds(list, i.id, other));
      note.setMsg({ ok: false, text: (e as Error).message });
    }
  }

  /**
   * 분류 전체 예산: 분류의 한 항목(대표) 예산 행에 나머지 항목이 모두 묶여 있으면 분류 하나의 예산으로 본다.
   * 반환: 대표 항목 id (아니면 null)
   */
  const categoryBudgetOf = (categoryId: string): string | null => {
    const cat = items.filter((i) => i.categoryId === categoryId && (setOf(i).active || linesOf(i.id).length));
    if (cat.length < 2) return null;
    const primaries = cat.filter((i) => linesOf(i.id).length);
    if (primaries.length !== 1) return null;
    const pid = primaries[0].id;
    return cat.every((i) => i.id === pid || alias.get(i.id) === pid) ? pid : null;
  };
  /** 분류 전체를 한 예산으로: 첫 예산 행 항목(없으면 첫 항목)을 대표로, 나머지를 모두 묶는다 */
  async function makeCategoryBudget(categoryId: string, name: string) {
    const cat = items.filter((i) => i.categoryId === categoryId && setOf(i).active);
    if (cat.length < 2) return;
    const inCat = new Set(cat.map((i) => i.id));
    const catLines = lines.filter((l) => inCat.has(l.itemId));
    const primary = catLines[0]?.itemId ?? cat[0].id;
    const others = cat.map((i) => i.id).filter((id) => id !== primary);
    const total = catLines.reduce((a, l) => a + lineAmount(l), 0);
    const own = catLines.filter((l) => l.itemId === primary);
    // 예산 행이 여러 개면 계획 합계를 한 줄로 (단가 = 합계, 기간 1회)
    const merge = catLines.length > 1 || own.length > 1;
    if (merge && !(await confirm({ message: `'${name}'의 예산 행 ${catLines.length}개(배정 합계 ${won(total)}원)를 하나로 합칩니다.\n합친 예산은 단가 ${won(total)}원 × 1회로 시작합니다. 계속할까요?` }))) return;
    setLines((ls) => {
      const rest = ls.filter((l) => !inCat.has(l.itemId));
      const base = merge || !own.length
        ? { key: newKey(), itemId: primary, detail: "", unitPrice: merge ? total : 0, periods: merge ? 1 : p.period.months, changeId: "", bundle: others }
        : { ...own[0], bundle: others };
      return [...rest, base];
    });
    touch();
  }
  /** 분류 예산 풀기: 대표 항목 예산만 남기고 묶음 해제 (나머지는 예산 없는 항목이 됨) */
  async function breakCategoryBudget(primary: string, name: string) {
    if (!(await confirm({ message: `'${name}'을(를) 항목별 예산으로 바꿀까요?\n예산은 대표 항목에만 남고, 다른 항목은 예산 없는 항목이 됩니다.` }))) return;
    setLines((ls) => ls.map((l) => (l.itemId === primary ? { ...l, bundle: [] } : l)));
    touch();
  }

  // ── 분류별 묶음 (사용 중인 항목 + 예산 행이 있는 항목, 사용 안 함은 접어 둠)
  const visible = (i: BudgetItem) => (setOf(i).active && edit) || linesOf(i.id).length > 0 || (p.spent[i.id] ?? 0) > 0;
  const groups = categories
    .map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id && (showInactive || visible(i))) }))
    .filter((c) => c.items.length);
  const hiddenCount = items.filter((i) => !visible(i)).length;
  // 묶을 수 있는 항목 (다른 항목에 묶이지 않고 예산 행도 없음) — 행마다 전체 항목을 훑지 않도록 분류별로 한 번만
  const freeByCat = new Map<string, BudgetItem[]>();
  for (const x of items) {
    if (alias.has(x.id) || linesOf(x.id).length) continue;
    const arr = freeByCat.get(x.categoryId);
    if (arr) arr.push(x); else freeByCat.set(x.categoryId, [x]);
  }
  // 마감분(마감 이상인 달) / 이번 달 가용 (매월 항목만)
  const closings = p.closings ?? {};
  const confirmedOf = (key: string) => (p.closings ? splitConfirmed(index.monthByKey.get(key), closings).confirmed : undefined);
  const totalConfirmed = p.closings ? Object.values(p.monthly).reduce((a, m) => a + splitConfirmed(m, closings).confirmed, 0) : undefined;
  const nowIn = !!p.now && p.months.some((m) => m.ym === p.now);
  // 매월 항목: 모든 예산 행의 기간(회)이 개월수 이상 (비정기 항목은 월 배정 없이 누적 잔액만)
  const isRegular = (id: string) => {
    const own = linesOf(id);
    return own.length > 0 && own.every((l) => l.periods >= p.period.months);
  };
  const availableOf = (id: string) => (nowIn ? monthAvailable(plannedOf(id), p.period.months, monthOf(id, p.now!), isRegular(id)) : null);
  // 월별 보기: 고른 달의 항목별 월 배정 대비 집행 (현황 월 요약의 monthUsage와 같은 계산)
  const monthYm = p.ym && p.months.some((m) => m.ym === p.ym) ? p.ym : nowIn ? p.now! : p.months[p.months.length - 1]?.ym;
  const monthItems = monthYm ? monthItemRows(
    groups.flatMap((g) => g.items.filter((i) => !alias.has(i.id)).map((i) => ({
      // 분류 전체 한 예산이면 대표 항목 대신 분류 이름으로
      itemId: i.id, itemName: categoryBudgetOf(g.id) === i.id ? `${g.name} 전체` : i.name, categoryName: g.name,
      planned: plannedOf(i.id), months: p.months.map((m) => monthOf(i.id, m.ym)), regular: isRegular(i.id),
    }))),
    p.months.findIndex((m) => m.ym === monthYm), p.period.months,
  ) : null;
  const timeRate = p.elapsed !== undefined && p.period.months > 0 ? Math.round((p.elapsed / p.period.months) * 1000) / 10 : null;

  const addProps = { projectId: p.projectId, categories, items, templates: p.templates, months: p.period.months };

  return (
    <div className="space-y-5 pb-20">
      {dialog}
      {/* 요약 — 대시보드와 같은 전체 집행 블록 (편집 중 계획 변경이 바로 반영되도록 화면 값으로) */}
      <ProjectProgress title="운영비 전체 집행" className="" planned={totals.planned} spent={totals.spent} forecast={p.forecast ?? totals.spent} confirmed={totalConfirmed}
        elapsed={p.elapsed ?? 0} months={p.period.months}
        notes={{
          planned: p.contract ? <>당초 {won(p.contract.original)} · 변경 {p.contract.delta >= 0 ? "+" : ""}{won(p.contract.delta)}</> : <>{ymDot(p.period.start)} ~ {ymDot(p.period.end)}</>,
          spent: totals.unbudgeted ? <span className="text-amber-800">예산 없는 항목 {won(totals.unbudgeted)}원 포함</span> : undefined,
        }} />
      {/* 도구 막대 — 항목별(배정·집행·잔액, 편집) / 월별(월 배정 대비 집행: 추이 차트 + 월×항목 표) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="tablist" aria-label="보기 방식">
          {([["items", "항목별"], ["monthly", "월별"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => changeView(k)}>{label}</button>
          ))}
        </div>
        {view === "items" && groups.length > 0 && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => saveFold(toggleFoldAll(folded, groups.map((g) => g.id)))}>
            {allFolded(folded, groups.map((g) => g.id)) ? "모두 펼치기" : "모두 접기"}
          </button>
        )}
        {hiddenCount > 0 && (
          <label className="ml-1 flex min-h-10 items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" className="size-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {edit ? "사용 안 함" : "예산 없는 항목"} {hiddenCount}개 보기
          </label>
        )}
        {edit && <AddItemButton {...addProps} onCategory={(c) => setCategories((l) => [...l, c])}
          onAdded={(item, price, periods) => { setItems((l) => [...l, item]); if (price) addLine(item.id, price, periods); setSettingsFor(item.id); unfoldCat(item.categoryId); }} />}
      </div>

      {view === "items" ? (
        groups.length === 0 ? (
          <div className="card px-5 py-14 text-center text-sm text-fg-muted">아직 항목이 없어요.{edit && " [+ 항목 추가]로 시작해 보세요."}</div>
        ) : groups.map((g) => {
          const keys = g.items.map((i) => i.id).filter((id) => !alias.has(id));
          const gPlanned = keys.reduce((a, id) => a + plannedOf(id), 0);
          const gSpent = keys.reduce((a, id) => a + spentOf(id), 0);
          const catPrimary = categoryBudgetOf(g.id);
          const fixed = { id: g.id, name: g.name };
          const isFolded = folded.has(g.id);
          if (catPrimary) {
            return (
              <CategoryBudgetCard key={g.id} name={g.name} edit={edit} months={p.period.months}
                line={linesOf(catPrimary)[0]}
                gauge={categoryGauge({ planned: plannedOf(catPrimary), spent: spentOf(catPrimary), confirmed: confirmedOf(catPrimary), timeRate, paced: isRegular(catPrimary) })}
                items={g.items} spentOfItem={(id) => p.spent[id] ?? 0}
                folded={isFolded} onToggleFold={() => toggleCat(g.id)}
                onPrice={(patch) => { const l = linesOf(catPrimary)[0]; if (l) patchLine(l.key, patch); }}
                onBreak={() => breakCategoryBudget(catPrimary, g.name)} onDelete={(i) => deleteItem(i)}
                addButton={edit ? (
                  <AddItemButton {...addProps} fixedCategory={fixed}
                    onAdded={(item) => { setItems((l) => [...l, item]); addBundle(catPrimary, item.id); unfoldCat(item.categoryId); }} />
                ) : null} />
            );
          }
          const bodyId = `budget-cat-${g.id}`;
          return (
            <section key={g.id} className="card overflow-hidden">
              {/* 머리: 접기 토글(chevron + 분류명) + 게이지(잔액·배정·집행·집행률)·버튼 — 분류 전체 한 예산 카드와 같은 부품, 접혀 있어도 그대로 */}
              <CategoryHead name={g.name} folded={isFolded} controls={bodyId} onToggle={() => toggleCat(g.id)} count={g.items.length}
                gauge={categoryGauge({
                  planned: gPlanned, spent: gSpent, timeRate,
                  confirmed: p.closings ? keys.reduce((a, id) => a + (confirmedOf(id) ?? 0), 0) : undefined,
                  // 예산이 있는 항목이 모두 매월 항목일 때만 기간과 비교 (비정기 항목이 섞이면 초과만) — 항목 줄의 판정과 같은 기준
                  paced: keys.some((id) => linesOf(id).length > 0) && keys.every((id) => linesOf(id).length === 0 || isRegular(id)),
                })}
                action={edit && g.items.length > 1 ? (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => makeCategoryBudget(g.id, g.name)}
                    title="분류의 항목을 모두 묶어 예산 하나로 관리합니다. 새 항목도 자동 포함됩니다.">분류 전체를 한 예산으로</button>
                ) : null} />
              {/* 내용: 접으면 숨김 (DOM은 유지) — 선은 아래쪽에 두어 접힌 카드 바닥에 선이 겹치지 않게 */}
              <div id={bodyId} hidden={isFolded} className="border-t border-line">
              {/* 열 머리 (넓은 화면) */}
              <div className="hidden h-10 grid-cols-[minmax(0,1fr)_7.5rem_4.5rem_8rem_8rem_9rem_4.5rem] items-center gap-3 bg-surface-muted px-5 text-xs font-semibold text-fg-muted md:grid">
                <span>항목 · 집행률</span><span className="text-right">단가</span><span className="text-right" title="단가를 쓸 수 있는 횟수 (12 = 매월, 1 = 한 번)">기간(회)</span><span className="text-right">배정</span><span className="text-right">집행</span><span className="text-right" title="이번 달 가용 = 월 배정 − 이번 달 집행 (매월 항목만)">잔액 · 이번 달 가용</span><span />
              </div>
              <ul className="divide-y divide-line">
                {g.items.map((i, idx) => (
                  <ItemRow key={i.id} item={i} edit={edit} open={open.has(i.id)} onToggle={() => toggleOpen(i.id)}
                    settingsOpen={settingsFor === i.id} onSettingsClose={() => setSettingsFor(null)}
                    trend={{ months: p.months.map((m) => m.ym), monthOf: (ym) => monthOf(i.id, ym), closings, elapsed: p.elapsed ?? 0, now: p.now ?? null }}
                    lines={linesOf(i.id)} planned={plannedOf(i.id)} spent={spentOf(i.id)} ownSpent={p.spent[i.id] ?? 0}
                    passLinked={passLinked.get(i.id) ?? null} timeRate={timeRate} confirmed={confirmedOf(i.id)} available={availableOf(i.id)}
                    bundledInto={alias.get(i.id) ?? null} nameOf={nameOf} settings={setOf(i)} months={p.period.months}
                    changes={p.changes} categories={categories} onDelete={() => deleteItem(i)}
                    onMove={(d) => moveItem(i, d)} first={idx === 0} last={idx === g.items.length - 1}
                    candidates={(freeByCat.get(i.categoryId) ?? []).filter((x) => x.id !== i.id)}
                    onPrice={(patch) => setPrice(i.id, patch)} onPatchLine={patchLine} onRemoveLine={removeLine} onAddLine={() => addLine(i.id)}
                    onAddBundle={(x) => addBundle(i.id, x)} onRemoveBundle={(x) => removeBundle(i.id, x)} onSetting={(s) => setItemSetting(i, s)} />
                ))}
              </ul>
              {edit && (
                <AddItemButton {...addProps} fixedCategory={fixed}
                  onAdded={(item, price, periods) => { setItems((l) => [...l, item]); if (price) addLine(item.id, price, periods); }} />
              )}
              </div>
            </section>
          );
        })
      ) : (
        <>
          {/* 고른 달의 항목별 월 배정 대비 집행 — 항목별 보기(전체 기간)와 달리 한 달만. 달은 ?ym= (머리글의 월 이동) */}
          {monthItems && monthYm && <MonthItems ym={monthYm} now={p.now ?? null} rows={monthItems.rows} totals={monthItems.totals} />}
          {/* 집행 추이: 월 막대 + 월 배정 기준선 (기본), 누적 번업·종료 시 예상은 탭으로. 월별 합계 표는 아래 표가 대신한다 */}
          {p.burn && (totals.planned > 0 || totals.spent > 0) && (
            <BurnChart now={p.burn.now} points={burnSeries(p.burn.months, p.burn.amounts, totals.planned, p.burn.elapsed)} statuses={p.burn.statuses}
              className="" defaultMode="month" table={false} />
          )}
          <MonthlyView months={p.months} groups={groups} alias={alias} monthOf={monthOf} plannedOf={plannedOf} planned={totals.planned} now={p.now ?? p.burn?.now ?? null} />
        </>
      )}

      <PassItemsPanel projectId={p.projectId} items={p.passItems} templates={p.passTemplates} enabled={p.passEnabled} edit={edit}
        company={p.passCompany} budgetItems={items} months={p.months} />

      {/* 자동 저장 상태 · 알림 */}
      {edit && (autosave.saveState !== "idle" || note.msg) && (
        <div className="fixed right-4 bottom-20 z-30 lg:right-8 lg:bottom-6" role="status" aria-live="polite">
          <div className="flex items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2 text-sm shadow-pop">
            {autosave.saveState === "pending" && <><span className="size-2 rounded-full bg-sky-500" aria-hidden /><span className="text-fg-muted">저장 대기…</span></>}
            {autosave.saveState === "saving" && <><span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden /><span className="text-fg-muted">저장 중…</span></>}
            {autosave.saveState === "saved" && !note.msg && <><span className="text-emerald-600" aria-hidden>✓</span><span className="text-fg-muted">자동 저장됨</span></>}
            {note.view}
            {autosave.saveState === "error" && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => { note.setMsg(null); void autosave.flush(); }}>다시 시도</button>}
            {note.msg && autosave.saveState !== "error" && <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => note.setMsg(null)} aria-label="닫기">✕</button>}
          </div>
        </div>
      )}
    </div>
  );
}
