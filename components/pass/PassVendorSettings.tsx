"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/client";
import { PERIOD_START_DAYS, defaultVendorName, isCodeHeader, isNoiseExtraLabel, vendorNameProblem, type DisplayItem } from "@/lib/pass-statement";
import { chip } from "../ui";
import { toast } from "../Nav";
import { useRun } from "../hooks/useRun";
import { useConfirm } from "../ConfirmDialog";
import { SaveBar } from "../SaveBar";
import { AddItemRow, RenameInput, displayItemsProblem, itemActions, renameItem } from "./DisplayItemsEditor";
import { PassSetupEditor, setupFromError, setupToProfile, type SetupState } from "./PassSetupEditor";
import { RowMenu } from "./RowMenu";
import { createWireReader, readError } from "./readWire";
import { BASE_ROWS, periodShort, vendorColumns, type CellValue, type TableColumn, type VendorView } from "./vendorTable";

export type { VendorView };

const periodText = (d: number) => (d === 1 ? "매월 1일 ~ 말일" : `전월 ${d}일 ~ 당월 ${d - 1}일`);

/**
 * PM 설정 > 출입증: '표시 열 · 업체 연결' 비교 표 하나.
 * 행 = 기본 열(이름·금액·날짜·시간) + 표시 열(프로젝트 순서), 열 = 업체(구분 칩·정산 기간), 칸 = 연결된 원본 열.
 * 모바일은 업체 칩으로 한 업체씩 '항목 → 연결 열' 목록. 고치기는 이 프로젝트 PM, 재무 승인·시스템 관리자는 조회만(메뉴 숨김).
 */
export function PassVendorSettings({ projectId, ym, canEdit, displayItems, vendors }: {
  projectId: string;
  /** 샘플 파일 읽을 때의 기준 달 (정산 기간 안내) */
  ym: string;
  canEdit: boolean;
  displayItems: DisplayItem[];
  vendors: VendorView[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(displayItems);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [flow, setFlow] = useState<{ kind: "add" } | { kind: "edit"; vendor: VendorView } | { kind: "rename"; vendor: VendorView } | null>(null);
  const [mobileCol, setMobileCol] = useState(0);
  const save = useRun();
  const vendorRun = useRun();
  const { confirm, dialog } = useConfirm();

  const visible = items.filter((i) => !i.hidden);
  const columns = vendorColumns(vendors, visible);
  const col = columns[Math.min(mobileCol, Math.max(0, columns.length - 1))];
  const missingSections = columns.flatMap((c) => c.sections.filter((s) => s.missing).map((s) => `${c.vendorName} ${s.label}`));
  const dirty = JSON.stringify(items) !== JSON.stringify(displayItems);

  const saveItems = () => {
    const problem = displayItemsProblem(items);
    if (problem) { save.setMsg({ ok: false, text: problem }); return; }
    void save.act(() => api(`/api/projects/${projectId}/pass-display-items`, { method: "PUT", json: { items: items.map((i) => ({ ...i, name: i.name.trim() })) } }), "표시 열을 저장했어요.");
  };
  const removeVendor = async (v: VendorView) => {
    const yes = await confirm({
      title: "업체 서식 삭제", danger: true, confirmLabel: "삭제",
      message: `'${v.vendorName}' 업체 서식을 삭제할까요?\n이미 올린 출입증 내역은 그대로 남습니다. 이 업체 파일을 다시 올리려면 서식을 새로 설정해야 합니다.`,
    });
    if (yes) await vendorRun.act(() => api(`/api/projects/${projectId}/pass-vendors/${v.id}`, { method: "DELETE" }), "업체 서식을 삭제했어요.");
  };
  const vendorOf = (c: TableColumn) => vendors.find((v) => v.id === c.vendorId)!;
  const vendorMenu = (c: TableColumn) => canEdit && (
    <RowMenu label={`${c.vendorName} 메뉴`} actions={[
      { label: "이름 바꾸기", onSelect: () => setFlow({ kind: "rename", vendor: vendorOf(c) }) },
      { label: "서식 수정 (샘플 파일)", onSelect: () => setFlow({ kind: "edit", vendor: vendorOf(c) }) },
      { label: "삭제", danger: true, onSelect: () => void removeVendor(vendorOf(c)) },
    ]} />
  );
  /** 표시 열 이름 칸 (번호 · 이름, 끝에 ⋯) */
  const itemCell = (it: DisplayItem, i: number) => (
    <span className="flex min-w-0 items-center gap-2">
      <span className="tabular w-4 shrink-0 text-xs text-fg-subtle">{i + 1}</span>
      {renamingItem === it.key ? (
        <RenameInput items={items} itemKey={it.key} onDone={(name) => { if (name !== null) setItems(renameItem(items, it.key, name)); setRenamingItem(null); }} />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.name}</span>
          {isNoiseExtraLabel(it.name) ? (
            <span className="shrink-0 text-xs text-fg-subtle" title="금액·수량·시간·날짜 열은 내역 줄에 따로 보이므로 표시 열로는 숨겨요 (엑셀에는 나옴). 수량이 2 이상이면 품목 뒤에 '× 2'로 붙어요">내역 줄에는 숨김</span>
          ) : isCodeHeader(it.name) ? (
            <span className="shrink-0 text-xs text-amber-700" title="코드 값만 있는 열이에요. 내역 줄에는 보이지 않으니 ⋯ › 숨기기(삭제)로 정리하세요">코드 열</span>
          ) : null}
          {canEdit && <RowMenu label={`${it.name} 메뉴`} align="left" actions={itemActions(items, it.key, { rename: () => setRenamingItem(it.key), change: setItems, allowDelete: true })} />}
        </>
      )}
    </span>
  );
  const one = (v: string | null | undefined) => (v ? <span className="text-sm text-fg">{v}</span> : <span className="text-sm text-fg-subtle">—</span>);
  /** 칸: 값 하나, 또는 구분마다 다르면 '구분: 열' 줄 */
  const cellText = (c: CellValue | undefined) => !c?.parts ? one(c?.value) : (
    <span className="block space-y-0.5">
      {c.parts.map((p) => <span key={p.label} className="block text-sm"><span className="text-fg-muted">{p.label}:</span> {p.value ?? <span className="text-fg-subtle">—</span>}</span>)}
    </span>
  );
  const sectionChips = (c: TableColumn) => (
    <span className="flex flex-wrap gap-1">
      {c.sections.map((s) => s.missing
        ? <span key={s.label} className="badge badge-warn" title={`구분 이름이 없어 시트 이름(${s.label})이 구분으로 쓰였습니다. ⋯ › 서식 수정에서 구분을 정하세요.`}>⚠ 구분 없음 ({s.label})</span>
        : <span key={s.label} className="badge badge-neutral">{s.label}</span>)}
    </span>
  );

  return (
    <div className="card overflow-clip">
      <div className="card-head gap-3">
        <h2 className="section-title min-w-0 flex-1">출입증 표시 열 · 업체 연결</h2>
        {canEdit && !flow && <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setFlow({ kind: "add" })}>+ 업체 서식</button>}
      </div>
      <div className="space-y-3 p-4">
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer list-none">
            출입증 내역 화면·엑셀에 나오는 열과, 업체마다 그 열을 어느 원본 열에서 가져오는지예요. <span className="text-primary">자세히</span>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>표시 열 순서대로 화면·엑셀 열이 생겨요. 이름을 바꿔도 이미 올린 내역과 이어져요.</li>
            <li>숨기기(삭제)는 기존 값을 지우지 않고 화면·엑셀에서만 숨겨요.</li>
            <li>업체 파일을 올리면 파일 머리글과 가장 잘 맞는 업체 서식이 자동으로 쓰여요. 연결 열은 업체 ⋯ › 서식 수정에서 바꿔요.</li>
          </ul>
        </details>

        {missingSections.length > 0 && (
          <p className="alert alert-warn text-sm" role="status">
            ⚠ 구분 이름이 없는 시트: {missingSections.join(", ")} — 업체 ⋯ › 서식 수정에서 구분을 정하세요.
          </p>
        )}

        {flow?.kind === "rename" && (
          <VendorRename projectId={projectId} vendor={flow.vendor} others={vendors.filter((v) => v.id !== flow.vendor.id).map((v) => v.vendorName)}
            onDone={(saved) => { setFlow(null); if (saved) router.refresh(); }} />
        )}
        {(flow?.kind === "add" || flow?.kind === "edit") && (
          <VendorSetupFlow projectId={projectId} ym={ym} existing={vendors.map((v) => v.vendorName)} vendor={flow.kind === "edit" ? flow.vendor : null}
            onDone={(saved) => { setFlow(null); if (saved) router.refresh(); }} />
        )}
        {vendorRun.view && <p className="text-sm">{vendorRun.view}</p>}

        {/* PC: 비교 표 */}
        <div className="hidden min-w-0 overflow-x-auto sm:block">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-40 bg-surface-muted text-left align-top">항목</th>
                {columns.map((c) => (
                  <th key={c.key} className="min-w-36 text-left align-top">
                    <span className="flex items-start gap-1">
                      <span className="min-w-0 flex-1 space-y-1 py-1">
                        <span className="block text-sm font-semibold text-fg">{c.vendorName}</span>
                        {sectionChips(c)}
                        <span className="block text-xs font-normal text-fg-muted">정산 {periodShort(c.periodStartDay)}</span>
                      </span>
                      {vendorMenu(c)}
                    </span>
                  </th>
                ))}
                {columns.length === 0 && <th className="text-left text-fg-muted">업체 서식 없음</th>}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={columns.length + 1} className="bg-surface-muted/60 text-xs font-semibold text-fg-muted">기본 열</td></tr>
              {BASE_ROWS.map((r) => (
                <tr key={r.key}>
                  <td className="sticky left-0 z-10 bg-surface text-sm text-fg-2">{r.name}</td>
                  {columns.map((c) => <td key={c.key}>{cellText(c.cells[r.key])}</td>)}
                  {columns.length === 0 && <td />}
                </tr>
              ))}
              <tr><td colSpan={columns.length + 1} className="bg-surface-muted/60 text-xs font-semibold text-fg-muted">표시 열 (화면·엑셀 순서)</td></tr>
              {visible.map((it, i) => (
                <tr key={it.key}>
                  <td className="sticky left-0 z-10 bg-surface">{itemCell(it, i)}</td>
                  {columns.map((c) => <td key={c.key}>{cellText(c.cells[it.key])}</td>)}
                  {columns.length === 0 && <td />}
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={columns.length + 1} className="text-sm text-fg-muted">표시 열이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* 모바일: 업체 칩 → 한 업체씩 '항목 → 연결 열' */}
        <div className="space-y-3 sm:hidden">
          {columns.length > 0 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="업체">
              {columns.map((c, i) => (
                <button key={c.key} type="button" role="tab" aria-selected={c === col} className={chip(c === col)} onClick={() => setMobileCol(i)}>
                  {c.vendorName}
                </button>
              ))}
            </div>
          )}
          {col && (
            <div className="flex items-start gap-2 rounded-lg bg-surface-muted/60 px-3 py-2">
              <span className="min-w-0 flex-1 space-y-1">
                {sectionChips(col)}
                <span className="block text-xs text-fg-muted">정산 {periodText(col.periodStartDay)}</span>
              </span>
              {vendorMenu(col)}
            </div>
          )}
          <MobileList title="기본 열" rows={BASE_ROWS.map((r) => ({ key: r.key, label: <span className="text-sm text-fg-2">{r.name}</span>, value: cellText(col?.cells[r.key]) }))} />
          <MobileList title="표시 열" rows={visible.map((it, i) => ({ key: it.key, label: itemCell(it, i), value: cellText(col?.cells[it.key]) }))} />
        </div>

        {canEdit && <AddItemRow items={items} onAdd={setItems} />}
        {!canEdit && <p className="text-xs text-fg-muted">표시 열과 업체 서식은 이 프로젝트 PM이 정합니다.</p>}
      </div>
      {canEdit && <SaveBar dirty={dirty} busy={save.busy} onSave={saveItems} status={save.view} onReset={() => setItems(displayItems)} />}
      {dialog}
    </div>
  );
}

/** 모바일 2열 목록 */
function MobileList({ title, rows }: { title: string; rows: { key: string; label: React.ReactNode; value: React.ReactNode }[] }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-fg-muted">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-fg-muted">없음</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rows.map((r) => (
            <li key={r.key} className="grid min-h-11 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-3 py-1">
              <span className="min-w-0">{r.label}</span>
              <span className="min-w-0 truncate text-right">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 업체 이름 바꾸기 (이 업체로 올린 출입증 내역 줄의 업체 이름도 함께) */
function VendorRename({ projectId, vendor, others, onDone }: { projectId: string; vendor: VendorView; others: string[]; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(vendor.vendorName);
  const { act, busy, view, setMsg } = useRun();
  const submit = async () => {
    const p = vendorNameProblem(name, others);
    if (p) { setMsg({ ok: false, text: p }); return; }
    if (await act(() => api(`/api/projects/${projectId}/pass-vendors/${vendor.id}`, { method: "PATCH", json: { vendorName: name } }), undefined, { refresh: false })) onDone(true);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
      <span className="text-sm font-semibold">업체 이름 바꾸기</span>
      <input className="input w-48 sm:text-sm" value={name} maxLength={30} autoFocus aria-label="새 업체 이름"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onDone(false); }} />
      <button type="button" className="btn-primary btn-sm" disabled={busy || !name.trim()} onClick={() => void submit()}>저장</button>
      <button type="button" className="btn-ghost btn-sm" onClick={() => onDone(false)}>취소</button>
      {view && <span className="w-full">{view}</span>}
    </div>
  );
}

/**
 * 업체 서식 추가·양식 수정: (추가면 업체 이름·정산 기간) + 샘플 파일 → 업로드와 같은 양식 설정 화면 → 서식만 저장 (출입증 내역 반영 없음)
 */
function VendorSetupFlow({ projectId, ym, existing, vendor, onDone }: { projectId: string; ym: string; existing: string[]; vendor: VendorView | null; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(() => vendor?.vendorName ?? defaultVendorName(existing));
  const [startDay, setStartDay] = useState(vendor?.periodStartDay ?? 1);
  const [file, setFile] = useState<File | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const readWire = useRef(createWireReader()).current;

  async function post(extra: (fd: FormData) => void) {
    if (!file) return null;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("ym", ym);
    fd.set("profileOnly", "1");
    try {
      fd.set("sheets", await readWire(file));
      fd.set("fileName", file.name);
    } catch (err) {
      setMsg(readError(err));
      setBusy(false);
      return null;
    }
    extra(fd);
    try {
      return await api<{ profileOnly: true; vendor: string }>(`/api/projects/${projectId}/pass-statements`, { method: "POST", body: fd });
    } catch (err) {
      const data = err instanceof ApiError ? err.data : {};
      if (data.needSetup) setSetup(setupFromError((err as Error).message, data));
      else setMsg((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** 샘플 파일 읽기 → 양식 설정 화면 (수정이면 저장된 서식으로 채움) */
  async function start() {
    if (!vendor) {
      const problem = vendorNameProblem(name, existing);
      if (problem) { setMsg(problem); return; }
      await post((fd) => { fd.set("newVendor", "1"); fd.set("vendorName", name.trim()); fd.set("periodStartDay", String(startDay)); });
    } else {
      await post((fd) => { fd.set("vendor", vendor.vendorName); fd.set("setup", "1"); });
    }
  }

  /** 서식만 저장 */
  async function save() {
    if (!setup) return;
    const r = setupToProfile(setup);
    if ("error" in r) { setMsg(r.error); return; }
    const res = await post((fd) => { fd.set("profile", JSON.stringify(r.profile)); if (vendor) fd.set("vendor", vendor.vendorName); });
    if (res) {
      const moved = (res as { relabeled?: number }).relabeled ?? 0;
      toast(`'${r.profile.vendorName}' 서식을 ${vendor ? "고쳤어요" : "저장했어요"}.${moved ? ` 기존 내역 ${moved}건의 구분도 함께 바꿨어요.` : ""}`);
      onDone(true);
    }
  }

  if (setup) {
    return (
      <div className="space-y-2">
        {msg && <p className="alert alert-danger" role="alert">{msg}</p>}
        <PassSetupEditor setup={setup} onChange={setSetup} ym={ym} busy={busy} submitLabel="서식 저장" onSubmit={() => void save()} onCancel={() => onDone(false)} vendorLocked />
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <p className="text-sm font-semibold">{vendor ? `'${vendor.vendorName}' 서식 수정` : "업체 서식 추가"} <span className="font-normal text-fg-muted">— 그 업체 파일(아무 달)로 시트·열을 정합니다. 출입증 내역에는 반영하지 않습니다.</span></p>
      {!vendor && (
        <div className="flex flex-wrap gap-3">
          <label className="block w-full max-w-xs">
            <span className="label">업체 이름<span className="text-accent">*</span></span>
            <input className="input mt-1" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">정산 기간</span>
            <select className="input mt-1" value={startDay} onChange={(e) => setStartDay(Number(e.target.value))}>
              {PERIOD_START_DAYS.map((d) => <option key={d} value={d}>{periodText(d)}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-secondary min-w-0 max-w-full cursor-pointer justify-start">
          <input type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" aria-label="업체 샘플 파일"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg(null); }} />
          <span className="truncate">{file ? file.name : "샘플 파일 고르기 (엑셀·CSV)"}</span>
        </label>
        <button type="button" className="btn-primary" disabled={!file || busy} onClick={() => void start()}>{busy ? "읽는 중…" : "시트·열 정하기"}</button>
        <button type="button" className="btn-ghost" onClick={() => onDone(false)}>취소</button>
      </div>
      {msg && <p className="alert alert-danger" role="alert">{msg}</p>}
    </div>
  );
}
