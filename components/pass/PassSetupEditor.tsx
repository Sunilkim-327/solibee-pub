"use client";
import { monthKo } from "@/lib/format";

import {
  PERIOD_START_DAYS, autoDisplay, colLetter, passPeriodLabel, suggestColumns, toSheetConfig, vendorNameProblem,
  type ColumnSelection, type DisplayItem, type SheetConfig, type SheetProblem, type SheetSetup,
} from "@/lib/pass-statement";
import { DisplayItemsEditor, displayItemsProblem } from "./DisplayItemsEditor";

/** 업체 서식 설정 화면 상태 (서버 422 needSetup 응답에서 만든다) */
export type SetupState = {
  problem: string;
  problems: SheetProblem[];
  /** 업체 이름 — 기존 업체면 고정, 새 업체면 입력 (필수·중복 불가) */
  vendorName: string;
  isNew: boolean;
  /** 저장된 업체 서식 이름들 */
  vendors: string[];
  periodStartDay: number;
  sheets: SheetSetup[];
  /** 프로젝트 공통 표시 열 목록 */
  displayItems: DisplayItem[];
  /** 표시 열 목록을 고칠 수 있음 (이 프로젝트 PM) */
  canEditItems: boolean;
};

/** 서버로 보낼 업체 서식 */
export type SetupProfile = { vendorName: string; isNew: boolean; periodStartDay: number; sheets: SheetConfig[]; displayItems?: DisplayItem[] };

/** 422 needSetup 응답 → 설정 화면 상태 */
export function setupFromError(message: string, data: Record<string, unknown>): SetupState {
  const sheets = (data.sheets as SheetSetup[]) ?? [];
  const canEditItems = data.canEditItems === true;
  let displayItems = (data.displayItems as DisplayItem[]) ?? [];
  // 표시 열 목록이 아직 없으면(처음) 추천된 열(시간·상품·매대 등)의 머리글 이름으로 시작
  if (canEditItems && !displayItems.length) {
    const keys: string[] = [];
    for (const s of sheets.filter((x) => x.include)) {
      for (const [k] of Object.entries(s.selection.display).sort((a, b) => a[1] - b[1])) if (!keys.includes(k)) keys.push(k);
    }
    displayItems = keys.map((k) => ({ key: k, name: k }));
  }
  return {
    problem: message, problems: (data.problems as SheetProblem[]) ?? [],
    vendorName: (data.vendorName as string) ?? "", isNew: data.isNew !== false, vendors: (data.vendors as string[]) ?? [],
    periodStartDay: (data.periodStartDay as number) ?? 1, sheets, displayItems, canEditItems,
  };
}

/** 설정 화면 → 서버로 보낼 서식 (문제가 있으면 error) */
export function setupToProfile(setup: SetupState): { profile: SetupProfile } | { error: string } {
  const name = setup.vendorName.trim();
  const nameProblem = vendorNameProblem(name, setup.isNew ? setup.vendors : []);
  if (nameProblem) return { error: nameProblem };
  if (setup.canEditItems) {
    const p = displayItemsProblem(setup.displayItems);
    if (p) return { error: p };
  }
  const keys = setup.displayItems.filter((i) => !i.hidden).map((i) => i.key);
  const sheets: SheetConfig[] = [];
  for (const s of setup.sheets.filter((x) => x.include)) {
    const sel = { ...s.selection, display: Object.fromEntries(Object.entries(s.selection.display).filter(([k]) => keys.includes(k))) };
    const conf = toSheetConfig(s.name, s.headerRow, s.rows[s.headerRow - 1] ?? [], sel, s.label, keys);
    if (!conf) return { error: `'${s.name}' 시트의 이름 열과 금액 열을 지정하세요.` };
    // 기존 설정을 고친 것이면 그 설정을 교체 (구분을 바꿨으면 기존 내역의 구분도 함께)
    sheets.push(s.fromLabel ? { ...conf, from: s.fromLabel } : conf);
  }
  if (!sheets.length) return { error: "사용할 시트를 하나 이상 고르세요." };
  return {
    profile: {
      vendorName: name, isNew: setup.isNew, periodStartDay: setup.periodStartDay, sheets,
      ...(setup.canEditItems ? { displayItems: setup.displayItems.map((i) => ({ ...i, name: i.name.trim() })) } : {}),
    },
  };
}

const chipCls = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-surface text-fg-muted hover:border-primary/60"}`;


/**
 * 업체 서식 설정 — 업체(기존 선택 / 새 업체 이름)·정산 기간·표시 열(프로젝트 공통)·사용할 시트·시트별 열.
 * 업로드 화면과 PM 설정의 [업체 서식 추가]가 같이 쓴다.
 */
export function PassSetupEditor({ setup, onChange, ym, busy, submitLabel, onSubmit, onCancel, onPickVendor, onNewVendor, vendorLocked }: {
  setup: SetupState;
  onChange: (s: SetupState) => void;
  /** 기간 안내에 쓰는 달 */
  ym: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  /** 다른 저장된 업체 서식으로 다시 설정 (업로드 화면) */
  onPickVendor?: (name: string) => void;
  /** 새 업체로 설정 (업로드 화면) */
  onNewVendor?: () => void;
  /** 업체를 바꿀 수 없음 (PM 설정의 업체 서식 추가) */
  vendorLocked?: boolean;
}) {
  const patchSheet = (i: number, p: Partial<SheetSetup>) => onChange({ ...setup, sheets: setup.sheets.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const patchSel = (i: number, p: Partial<ColumnSelection>) =>
    onChange({ ...setup, sheets: setup.sheets.map((x, j) => (j === i ? { ...x, selection: { ...x.selection, ...p } } : x)) });
  /** 표시 열 목록이 바뀌면 새 열은 시트마다 머리글 이름이 같은 열을 자동 연결 */
  const setItems = (displayItems: typeof setup.displayItems) => {
    const before = new Set(setup.displayItems.map((i) => i.key));
    const added = displayItems.filter((i) => !before.has(i.key));
    onChange({
      ...setup, displayItems,
      sheets: added.length
        ? setup.sheets.map((s) => ({ ...s, selection: { ...s.selection, display: { ...autoDisplay(s.rows[s.headerRow - 1] ?? [], added), ...s.selection.display } } }))
        : setup.sheets,
    });
  };
  const items = setup.displayItems.filter((i) => !i.hidden);

  return (
    <div className="space-y-4 rounded-xl border border-line p-4">
      <div>
        <h3 className="font-bold">업체 서식 설정</h3>
        {setup.problems.some((p) => p.sheet) ? (
          <ul className="mt-1 list-disc pl-5 text-sm text-status-rejected">{setup.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
        ) : (
          <p className="mt-0.5 text-sm text-fg-2">{setup.problem}</p>
        )}
        <p className="mt-1 text-label text-fg-subtle">사용할 시트를 고르고(표지 시트 제외) 시트마다 열을 고르세요. 서식은 업체별로 저장되어 다음부터 자동으로 쓰입니다.</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="block w-full max-w-sm">
          <span className="text-sm font-semibold">업체<span className="text-accent">*</span></span>
          {!vendorLocked && setup.vendors.length > 0 && (onPickVendor || onNewVendor) ? (
            <select className="input mt-1" value={setup.isNew ? "" : setup.vendorName} aria-label="업체 서식"
              onChange={(e) => (e.target.value ? onPickVendor?.(e.target.value) : onNewVendor?.())}>
              {setup.vendors.map((v) => <option key={v} value={v}>{v}</option>)}
              <option value="">+ 새 업체로 설정</option>
            </select>
          ) : null}
          {setup.isNew ? (
            <input className="input mt-1" value={setup.vendorName} maxLength={30} placeholder="업체 이름 (예: ○○푸드)" aria-label="새 업체 이름"
              readOnly={vendorLocked} onChange={(e) => onChange({ ...setup, vendorName: e.target.value })} />
          ) : (!setup.vendors.length || vendorLocked) && <p className="mt-1 text-sm font-medium">{setup.vendorName}</p>}
          {setup.isNew && <span className="mt-1 block text-xs text-fg-subtle">새 업체 서식으로 저장됩니다.</span>}
        </div>
        <label className="block">
          <span className="text-sm font-semibold">정산 기간 (업체가 한 달을 끊는 기준)</span>
          <select className="input mt-1" value={setup.periodStartDay} onChange={(e) => onChange({ ...setup, periodStartDay: Number(e.target.value) })}>
            {PERIOD_START_DAYS.map((d) => (
              <option key={d} value={d}>{d === 1 ? "매월 1일 ~ 말일" : `전월 ${d}일 ~ 당월 ${d - 1}일`}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-fg-subtle">{monthKo(ym)}분 = {passPeriodLabel(ym, setup.periodStartDay)} 사용 내역</span>
        </label>
      </div>
      <div className="rounded-xl bg-surface-muted/60 p-3">
        <p className="text-sm font-semibold">표시 열 <span className="font-normal text-fg-muted">— 프로젝트 공통 순서. 업체 파일에 없는 열은 &apos;—&apos;로 보입니다.</span></p>
        <div className="mt-2">
          <DisplayItemsEditor items={setup.displayItems} onChange={setItems} canEdit={setup.canEditItems} allowDelete={false} />
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">사용할 시트</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {setup.sheets.map((s, i) => (
            <label key={s.name} className={`${chipCls(s.include)} flex cursor-pointer items-center gap-1.5`}>
              <input type="checkbox" className="sr-only" checked={s.include} onChange={(e) => patchSheet(i, { include: e.target.checked })} />
              {s.include ? "✓ " : ""}{s.name}{!s.detected && <span className="opacity-60"> (표지?)</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {setup.sheets.map((s, i) => s.include && <SheetPicker key={s.name} sheet={s} items={items} onSheet={(p) => patchSheet(i, p)} onSel={(p) => patchSel(i, p)} />)}
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel}>취소</button>
        <button className="btn-primary" disabled={busy} onClick={onSubmit}>{busy ? "읽는 중…" : submitLabel}</button>
      </div>
    </div>
  );
}

/** 시트 한 장의 열 고르기 — 이름·날짜·금액·보조 연결 열, 표시 열마다 이 시트의 원본 열 */
function SheetPicker({ sheet: s, items, onSheet, onSel }: {
  sheet: SheetSetup; items: { key: string; name: string }[]; onSheet: (p: Partial<SheetSetup>) => void; onSel: (p: Partial<ColumnSelection>) => void;
}) {
  const header = s.rows[s.headerRow - 1] ?? [];
  const cols = header.map((h, c) => ({ c, label: h || `${colLetter(c)}열` }));
  const sel = s.selection;
  const toggle = (list: number[], c: number) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);
  const multi = (key: "amountCols" | "keyCols", exclude: number[] = []) => (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {cols.filter((c) => !exclude.includes(c.c)).map((c) => (
        <button key={c.c} type="button" className={chipCls(sel[key].includes(c.c))} onClick={() => onSel({ [key]: toggle(sel[key], c.c) })}>{c.label}</button>
      ))}
    </div>
  );
  const single = (value: number | undefined, onChange: (v: number | undefined) => void, placeholder: string, label: string) => (
    <select className="input mt-1 py-1.5 sm:text-sm" value={value ?? ""} aria-label={label} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}>
      <option value="">{placeholder}</option>
      {cols.map((c) => <option key={c.c} value={c.c}>{c.label}</option>)}
    </select>
  );
  const setDisplay = (key: string, v: number | undefined) => {
    const next = { ...sel.display };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onSel({ display: next });
  };
  return (
    <div className={`space-y-3 rounded-xl border p-3 ${s.missing.length ? "border-rose-500" : "border-primary/40"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-bold">{s.name}</h4>
        <label className="flex items-center gap-1 text-sm" title="식당·카페처럼 내역을 나누는 이름. 다시 올릴 때 이 구분의 내역만 바뀝니다.">구분
          <input className="input w-28 py-1 sm:text-sm" value={s.label} maxLength={20} placeholder="예: 카페" onChange={(e) => onSheet({ label: e.target.value })} />
        </label>
        <label className="flex items-center gap-1 text-sm">머리글 행
          <select className="input w-16 py-1 sm:text-sm" value={s.headerRow}
            onChange={(e) => {
              const headerRow = Number(e.target.value);
              onSheet({ headerRow, selection: suggestColumns(s.rows[headerRow - 1] ?? [], items) ?? { keyCols: [], amountCols: [], display: {} } });
            }}>
            {s.rows.map((_, r) => <option key={r} value={r + 1}>{r + 1}</option>)}
          </select>
        </label>
        {s.missing.length > 0 && <span className="text-xs text-status-rejected">찾지 못한 열: {s.missing.join(", ")} — 다시 고르세요</span>}
      </div>
      {s.reference && (
        <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
          <p className="font-semibold">
            참고: 기존 <b>{s.reference.label}</b> 서식
            <span className="ml-1 font-normal text-fg-muted">
              {s.reference.applied ? "— ✓ 열은 미리 골랐어요. ✗ 열은 직접 고르세요." : "— 같은 열을 찾지 못했어요. 비슷한 열을 직접 고르세요."}
            </span>
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {s.reference.cols.map((c, i) => (
              <li key={i} className={c.found ? "text-fg-2" : "text-fg-muted"}>
                <span className="text-fg-subtle">{c.role}</span> {c.header} {c.found ? <span className="text-status-approved">✓</span> : <span title="이 시트에 없음">✗</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-label text-fg-subtle">구분 칸에는 기존과 다른 이름(예: 카페)을 넣어야 {s.reference.label} 내역이 그대로 남습니다.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-xs font-semibold text-fg-muted">이름 열<span className="text-accent">*</span> (팀원 연결 기준)</span>
          {single(sel.nameCol, (v) => onSel({ nameCol: v }), "선택하세요", "이름 열")}
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-fg-muted">날짜 열 (선택 — 없으면 날짜별 묶음·1일 한도를 볼 수 없어요)</span>
          {single(sel.dateCol, (v) => onSel({ dateCol: v }), "없음", "날짜 열")}
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-fg-muted">시간 열 (선택 — 저녁 식사 표시·야근 대조에 사용)</span>
          {single(sel.timeCol, (v) => onSel({ timeCol: v }), "없음 — '시간' 머리글이 있으면 자동", "시간 열")}
        </label>
      </div>
      <div className="text-sm">
        <span className="text-xs font-semibold text-fg-muted">금액 열<span className="text-accent">*</span> (여러 개 고르면 합계)</span>
        {multi("amountCols", [sel.nameCol ?? -1, sel.dateCol ?? -1])}
      </div>
      <div className="text-sm">
        <span className="text-xs font-semibold text-fg-muted">보조 연결 열 (선택 — 카드번호·사원번호 등, 팀원 지정을 이 값으로 기억)</span>
        {multi("keyCols", [sel.nameCol ?? -1, sel.dateCol ?? -1, ...sel.amountCols])}
      </div>
      <div className="text-sm">
        <span className="text-xs font-semibold text-fg-muted">표시 열별 원본 열 (이 업체 파일에 없는 열은 &apos;(없음)&apos;)</span>
        {items.length === 0 ? (
          <p className="mt-1 text-xs text-fg-subtle">표시 열이 없습니다. 먼저 표시 열을 추가하세요.</p>
        ) : (
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {items.map((it) => (
              <label key={it.key} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-xs font-medium" title={it.name}>{it.name}</span>
                <select className="input min-w-0 flex-1 py-1 sm:text-sm" value={sel.display[it.key] ?? ""} aria-label={`${it.name} 열`}
                  onChange={(e) => setDisplay(it.key, e.target.value === "" ? undefined : Number(e.target.value))}>
                  <option value="">(없음)</option>
                  {cols.map((c) => <option key={c.c} value={c.c}>{c.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
