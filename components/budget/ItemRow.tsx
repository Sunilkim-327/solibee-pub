"use client";

import { useState } from "react";
import { won } from "@/lib/format";
import type { BudgetItem, CategoryRef, ChangeRef, Line, PassLinked, PricePatch, Settings } from "./types";
import { Meter, periodsOf } from "./ui";
import { digits, itemRowView, lineAmount, spendSplit, type ItemTag } from "./model";
import { Icon } from "../icons";
import { Menu } from "@/components/Menu";
import { ItemSettingsSheet } from "./ItemSettingsSheet";
import { ItemInsight, type ItemTrendInput } from "./ItemInsight";

/** 넓은 화면 열: 항목 · 단가 · 기간(회) · 배정 · 집행 · 잔액(+이번 달 가용) · 버튼 — 엑셀 순서(배정/집행/잔액) */
export const ITEM_GRID = "md:grid-cols-[minmax(0,1fr)_7.5rem_4.5rem_8rem_8rem_9rem_4.5rem]";

/** "⋯" (점 셋) */
const MORE = "M5 10h.01M10 10h.01M15 10h.01";
const TAG: Record<ItemTag["kind"], string> = {
  limit: "bg-surface-muted text-fg-muted", attendees: "bg-surface-muted text-fg-muted", hard: "bg-surface-muted text-fg-muted",
  bundle: "bg-brand-50 text-brand-700", inactive: "bg-surface-muted text-fg-muted",
};

type Props = {
  item: BudgetItem; edit: boolean;
  /** 펼침 패널(추이 차트) 열림 */
  open: boolean; onToggle: () => void;
  lines: Line[]; planned: number; spent: number; ownSpent: number; bundledInto: string | null; nameOf: (id: string) => string;
  settings: Settings; months: number; changes: ChangeRef[]; candidates: BudgetItem[];
  categories: CategoryRef[]; onDelete: () => void;
  onMove: (dir: "up" | "down") => void; first: boolean; last: boolean;
  /** 이 예산 항목에 연결된 출입증 회사 부담 — 확정분은 spent(집행)에 포함, 막대 아래에 카드·출입증으로 나눠 표시 */
  passLinked: PassLinked | null;
  /** 기간 경과율(%) — 주면 매월 항목(기간(회) ≥ 개월수)에 경과 눈금·속도 판정 */
  timeRate?: number | null;
  /** 마감분(마감 이상인 달) 지출 — 막대를 마감분/작성중으로 나눈다 */
  confirmed?: number;
  /** 이번 달 가용 (매월 항목만, 비정기는 null) */
  available?: number | null;
  /** 펼침 패널 데이터 (월별 집행·마감 상태·경과) */
  trend: ItemTrendInput;
  /** 항목 추가 직후 — 설정 시트를 자동으로 연다 (단가·기간을 바로 넣게) */
  settingsOpen?: boolean; onSettingsClose?: () => void;
  onPrice: (p: PricePatch) => void; onPatchLine: (key: string, p: Partial<Line>) => void; onRemoveLine: (key: string) => void; onAddLine: () => void;
  onAddBundle: (id: string) => void; onRemoveBundle: (id: string) => void; onSetting: (s: Partial<Settings>) => void;
};

/**
 * 항목 한 줄 — 펼치기 없이 행이 곧 전부.
 * 예산 행이 여럿(상세내역·변경계약별)이면 아래 보조 줄로 항상 보이고, 기본값이 아닌 설정만 항목명 옆 칩으로.
 * 편집은 행 안(단가·기간)과 "⋯ → 항목 설정" 시트에서. 끝의 chevron은 그 항목의 추이 패널(차트).
 */
export function ItemRow(x: Props) {
  const { item, lines, edit } = x;
  const view = itemRowView(lines, x.settings, x.nameOf);
  const one = lines[0];
  const remaining = x.planned - x.spent;
  const inactive = !x.settings.active;
  // 매월 쓰는 항목만 기간과 비교 (일부 달에만 쓰는 항목은 초과만)
  const paced = lines.length > 0 && lines.every((l) => l.periods >= x.months);
  const [sheet, setSheet] = useState(false);
  const sheetOpen = edit && (sheet || !!x.settingsOpen);
  const closeSheet = () => { setSheet(false); x.onSettingsClose?.(); };
  const dim = inactive ? "opacity-60" : "";

  if (x.bundledInto) {
    return (
      <li className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-sm text-fg-muted ${ITEM_GRID}`}>
        <span className="pl-4">↳ {item.name} <span className="text-xs">· {x.nameOf(x.bundledInto)} 묶음에 포함</span></span>
        <span className="hidden md:block" /><span className="hidden md:block" /><span className="hidden md:block" />
        <span className="tabular text-right text-xs md:col-start-5">{won(x.ownSpent)}</span>
      </li>
    );
  }

  const menu = edit && (
    <Menu label={`${item.name} 더 보기`} align="right" minWidth={168}
      triggerClassName="flex size-10 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-surface-muted hover:text-fg md:size-8 md:rounded-md"
      items={[
        { key: "settings", label: "항목 설정…", onSelect: () => setSheet(true) },
        { key: "line", label: "예산 행 추가", onSelect: x.onAddLine },
        { key: "up", label: "위로", onSelect: () => x.onMove("up"), disabled: x.first },
        { key: "down", label: "아래로", onSelect: () => x.onMove("down"), disabled: x.last },
        { key: "del", label: "삭제", onSelect: x.onDelete, danger: true },
      ]}>
      <Icon d={MORE} sw={2.6} className="size-4" />
    </Menu>
  );
  const toggle = (
    <button type="button" onClick={x.onToggle} aria-expanded={x.open} aria-label={`${item.name} 추이`} title={x.open ? "추이 접기" : "월별·누적 추이"}
      className="flex size-8 items-center justify-center rounded-md text-fg-subtle transition hover:bg-surface-muted hover:text-fg">
      <Icon name="down" sw={1.8} className={`size-4 transition-transform ${x.open ? "rotate-180" : ""}`} />
    </button>
  );

  return (
    <li>
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-3 md:py-2.5 ${ITEM_GRID} ${dim}`}>
        {/* 항목명 · 칩(기본값이 아닌 설정만) · 집행률 */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-medium">{item.name}</span>
            {view.detail && <span className="truncate text-xs text-fg-muted" title={view.detail}>{view.detail}</span>}
            {view.tags.map((t) => (
              <span key={t.kind + t.label} className={`inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium ${TAG[t.kind]}`}>{t.label}</span>
            ))}
          </div>
          {(x.planned > 0 || x.spent > 0) && <Meter spent={x.spent} planned={x.planned} timeRate={paced ? x.timeRate ?? null : null} showRate={x.planned > 0} confirmed={x.confirmed} className="mt-1.5 max-w-72" />}
          {x.passLinked && (() => {
            // 예산은 하나, 쓰는 방법은 둘: 집행 = 카드 + 출입증(월 확정분). 확정 전 출입증은 집행에 넣지 않고 흐리게
            const sp = spendSplit(x.spent, x.passLinked);
            return (
              <div className="tabular mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-muted" title={`연결된 출입증 항목: ${x.passLinked.names.join(", ")}`}>
                <span>카드 {won(sp.card)}</span>
                <span aria-hidden>·</span>
                <span>출입증 {won(sp.pass)}</span>
                {sp.pending > 0 && <span className="text-fg-subtle">(출입증 확정 전 {won(sp.pending)})</span>}
              </div>
            );
          })()}
        </div>
        {/* 단가 · 기간(회) — 보조 줄이 없을 때만 행 안에 (편집이면 바로 입력) */}
        <div className="text-right max-md:hidden">
          {edit && view.inline ? <PriceInput value={one?.unitPrice ?? 0} onChange={(n) => x.onPrice({ unitPrice: n })} label={`${item.name} 단가`} />
            : <span className="tabular text-sm">{view.inline && one ? won(one.unitPrice) : <span className="text-fg-subtle">{view.inline ? "—" : ""}</span>}</span>}
        </div>
        <div className="text-right max-md:hidden">
          {edit && view.inline ? (
            <input className="input tabular w-full text-right" inputMode="numeric" aria-label={`${item.name} 기간(회)`} placeholder={String(x.months)}
              value={one ? one.periods : ""} onChange={(e) => x.onPrice({ periods: periodsOf(e.target.value) })} />
          ) : <span className="tabular text-sm">{view.inline && one ? one.periods : <span className="text-fg-subtle">{view.inline ? "—" : ""}</span>}</span>}
        </div>
        <div className="tabular text-right text-sm font-semibold max-md:hidden">
          {x.planned ? won(x.planned) : <span className="text-fg-subtle">—</span>}
        </div>
        <div className="tabular text-right text-sm max-md:hidden">{won(x.spent)}</div>
        {/* 잔액 — 이 줄의 주인공 (좁은 화면은 오른쪽 위) */}
        <div className="tabular text-right max-md:col-start-2 max-md:row-start-1 max-md:self-start">
          <span className="block text-xs text-fg-muted md:hidden">잔액</span>
          <span className={`text-base font-bold ${remaining < 0 ? "text-status-rejected" : x.planned || x.spent ? "" : "font-normal text-fg-subtle"}`}>{x.planned || x.spent ? won(remaining) : "-"}</span>
          {remaining < 0 && <span className="badge badge-bad ml-1 align-middle">초과</span>}
          {x.available != null && (
            <span className={`block text-xs max-md:hidden ${x.available < 0 ? "font-semibold text-status-rejected" : "text-fg-muted"}`}>
              이번 달 가용 {won(x.available)}
            </span>
          )}
        </div>
        <div className="hidden items-center justify-end gap-0.5 md:flex">
          {menu}
          {toggle}
        </div>
        {/* 좁은 화면: 단가 × 기간 = 배정 / 집행 · 이번 달 가용 · 버튼 */}
        <div className="col-span-2 space-y-1 text-sm md:hidden">
          {edit && view.inline ? (
            <div className="tabular flex flex-wrap items-center gap-2">
              <PriceInput value={one?.unitPrice ?? 0} onChange={(n) => x.onPrice({ unitPrice: n })} label={`${item.name} 단가`} className="w-32" />
              <span className="text-fg-muted">×</span>
              <input className="input tabular w-16 text-right" inputMode="numeric" aria-label={`${item.name} 기간(회)`} placeholder={String(x.months)}
                value={one ? one.periods : ""} onChange={(e) => x.onPrice({ periods: periodsOf(e.target.value) })} />
              <span className="text-fg-muted">회 =</span>
              <b>{won(x.planned)}</b>
            </div>
          ) : (
            <div className="tabular text-fg-muted">
              {view.inline && one && <>단가 {won(one.unitPrice)} × {one.periods}회 = </>}배정 <b className="text-fg">{won(x.planned)}</b>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-fg-muted">
            <span className="tabular">
              집행 {won(x.spent)}
              {x.available != null && <> · <span className={x.available < 0 ? "font-semibold text-status-rejected" : ""}>이번 달 가용 {won(x.available)}</span></>}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {menu}
              <button type="button" className="btn-secondary btn-sm" aria-expanded={x.open} onClick={x.onToggle}>{x.open ? "접기" : "추이"}</button>
            </span>
          </div>
        </div>
      </div>

      {view.subRows && <SubRows {...x} className={dim} />}
      {x.open && (
        <ItemInsight name={item.name} planned={x.planned} trend={x.trend}
          lines={lines.map((l) => ({ amount: lineAmount(l), from: l.changeId ? x.changes.find((c) => c.id === l.changeId)?.from ?? null : null }))} />
      )}
      {sheetOpen && (
        <ItemSettingsSheet item={item} settings={x.settings} categories={x.categories} bundle={view.bundle} candidates={x.candidates} nameOf={x.nameOf}
          price={view.inline ? {
            unitPrice: one?.unitPrice ?? 0, periods: one?.periods ?? x.months, months: x.months, onPrice: x.onPrice,
            // 상세내역은 행이 있어야 적을 수 있다 (단가를 넣으면 행이 생긴다)
            detail: one ? { value: one.detail, onChange: (v: string) => x.onPatchLine(one.key, { detail: v }) } : null,
          } : null} lineCount={lines.length}
          onSetting={x.onSetting} onAddBundle={x.onAddBundle} onRemoveBundle={x.onRemoveBundle} onClose={closeSheet} />
      )}
    </li>
  );
}

const changeName = (changes: ChangeRef[], id: string) => changes.find((c) => c.id === id)?.label.split(" · ")[0] ?? "변경계약";

/** 금액 입력 (행·보조 줄 공용 — PC 보조 줄은 28px) */
function PriceInput({ value, onChange, label, className = "w-full", small }: { value: number; onChange: (n: number) => void; label: string; className?: string; small?: boolean }) {
  return (
    <input className={`input tabular text-right ${small ? "sm:min-h-7 sm:py-0.5 sm:text-[13px]" : ""} ${className}`} inputMode="numeric" placeholder="0" aria-label={label}
      value={value ? won(value) : ""} onChange={(e) => onChange(digits(e.target.value))} />
  );
}

/**
 * 보조 줄 — 예산 행이 여럿이거나 상세내역·변경계약이 붙은 항목만, 항상 보인다 (32px · 13px).
 * 넓은 화면은 항목 줄과 같은 열(단가·기간·배정)에 맞춰 놓고, 편집이면 그 자리에서 바로 입력 + 행 삭제 ×, 아래 "+ 예산 행".
 */
function SubRows(x: Props & { className: string }) {
  const { edit } = x;
  const small = "input tabular w-full text-right sm:min-h-7 sm:py-0.5 sm:text-[13px]";
  return (
    <ul className={`pb-1.5 ${x.className}`}>
      {x.lines.map((l) => {
        const amount = lineAmount(l);
        return (
          <li key={l.key} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-1 text-[13px] md:min-h-8 ${ITEM_GRID}`}>
            {/* 1열은 1280px에서 약 200px — 변경계약은 넓은 화면에서 비어 있는 집행·잔액 열(아래)에, 좁은 화면은 상세내역 옆에 */}
            <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-4 ${edit ? "max-md:col-span-2" : ""}`}>
              <span className="text-fg-subtle" aria-hidden>↳</span>
              {edit ? (
                <input className="input min-w-24 flex-1 sm:min-h-7 sm:py-0.5 sm:text-[13px]" placeholder="상세내역 (선택)" value={l.detail} aria-label="상세내역"
                  onChange={(e) => x.onPatchLine(l.key, { detail: e.target.value })} />
              ) : <span className="truncate text-fg-muted">{l.detail || "기본"}</span>}
              <span className="md:hidden"><ChangePick {...x} l={l} /></span>
            </div>
            <div className="text-right max-md:hidden">
              {edit ? <PriceInput small value={l.unitPrice} onChange={(n) => x.onPatchLine(l.key, { unitPrice: n })} label="단가" />
                : <span className="tabular text-fg-muted">{won(l.unitPrice)}</span>}
            </div>
            <div className="text-right max-md:hidden">
              {edit ? <input className={small} inputMode="numeric" value={l.periods} aria-label="기간(회)" onChange={(e) => x.onPatchLine(l.key, { periods: periodsOf(e.target.value) })} />
                : <span className="tabular text-fg-muted">{l.periods}</span>}
            </div>
            <div className="tabular text-right font-medium max-md:hidden">{won(amount)}</div>
            <div className="col-span-2 flex items-center pl-3 max-md:hidden"><ChangePick {...x} l={l} /></div>
            <div className="flex items-center justify-end max-md:hidden">
              {edit && <RemoveLine onClick={() => x.onRemoveLine(l.key)} />}
            </div>
            {/* 좁은 화면 */}
            <div className={`tabular md:hidden ${edit ? "col-span-2 flex flex-wrap items-center gap-2" : "text-right text-fg-muted"}`}>
              {edit ? (
                <>
                  <PriceInput small value={l.unitPrice} onChange={(n) => x.onPatchLine(l.key, { unitPrice: n })} label="단가" className="w-32" />
                  <span className="text-fg-muted">×</span>
                  <input className="input tabular w-16 text-right" inputMode="numeric" value={l.periods} aria-label="기간(회)" onChange={(e) => x.onPatchLine(l.key, { periods: periodsOf(e.target.value) })} />
                  <span className="text-fg-muted">회 =</span>
                  <b>{won(amount)}</b>
                  <RemoveLine onClick={() => x.onRemoveLine(l.key)} />
                </>
              ) : <>{won(l.unitPrice)} × {l.periods}회 = <b className="text-fg">{won(amount)}</b></>}
            </div>
          </li>
        );
      })}
      {edit && (
        <li className="px-5">
          <button type="button" className="btn-ghost btn-sm ml-2 text-xs" onClick={x.onAddLine}>+ 예산 행</button>
        </li>
      )}
    </ul>
  );
}

/** 보조 줄의 변경계약 — 편집이면 고르기(변경계약이 있는 프로젝트만), 조회면 배지 */
function ChangePick({ l, edit, changes, onPatchLine }: Pick<Props, "edit" | "changes" | "onPatchLine"> & { l: Line }) {
  if (edit && changes.length > 0) {
    return (
      <select className="input w-28 sm:min-h-7 sm:py-0.5 sm:text-xs" value={l.changeId} aria-label="변경계약" onChange={(e) => onPatchLine(l.key, { changeId: e.target.value })}>
        <option value="">당초 계약</option>
        {changes.map((c) => <option key={c.id} value={c.id}>{c.label.split(" · ")[0]}</option>)}
      </select>
    );
  }
  return l.changeId ? <span className="badge badge-info shrink-0">{changeName(changes, l.changeId)}</span> : null;
}

function RemoveLine({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="flex size-10 items-center justify-center rounded-lg text-fg-subtle hover:bg-rose-50 hover:text-rose-600 md:size-7 md:rounded-md" onClick={onClick} aria-label="행 삭제" title="행 삭제">
      <Icon name="close" className="size-3.5" />
    </button>
  );
}
