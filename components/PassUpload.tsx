"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/client";
import { shortDate, won } from "@/lib/format";
import { Icon } from "./icons";
import { SKIP_LABEL, passPeriodLabel, type AmbiguousSheet, type DisplayItem, type PassPreview, type SkipCounts } from "@/lib/pass-statement";
import { PassSetupEditor, setupFromError, setupToProfile, type SetupProfile, type SetupState } from "./pass/PassSetupEditor";
import { createWireReader, readError } from "./pass/readWire";
import { Caret, Menu } from "@/components/Menu";

type UploadResult = {
  lineCount: number; replaced: boolean; kept: number; carried: number; autoDecided: number; errorCount: number; profileSaved: boolean; vendor: string;
  unmatched: { holderName: string; count: number; amount: number }[];
};
/** 기존 출입증 내역의 업체·구분별 줄: replace = 이번 파일로 바뀜, keep = 그대로 둠 */
type ExistingGroup = { label: string; count: number; amount: number; action: "keep" | "replace" };
type PreviewState = {
  preview: Omit<PassPreview, "people"> & { people: (PassPreview["people"][number] & { userName: string | null })[]; existing: ExistingGroup[]; warnings: string[] };
  /** 고른 구분 (시트 이름 → 구분) — 반영할 때 그대로 보낸다 */
  labels: Record<string, string>;
  profile: SetupProfile;
  /** 쓴 업체 서식 (auto = 파일 머리글로 자동 선택) */
  vendor: { name: string; auto: boolean; isNew: boolean };
  vendors: string[];
  displayItems: DisplayItem[];
  usingSaved: boolean;
};

/** 업체 내역 올리기: (처음·변경 시) 업체 서식 설정 → 미리보기 → 반영. 업체 서식은 업체별로 여러 개, 파일 머리글로 자동 선택 */
export function PassUpload({ projectId, ym, profileText, locked, lockedText, defaultOpen = true }: {
  projectId: string; ym: string; profileText: string | null; locked: boolean;
  /** 잠긴 이유 (기본: 확정된 달 — 월 마감으로 잠겼으면 그 안내) */
  lockedText?: string;
  /** 처음부터 펼침 — 이 달 내역이 아직 없을 때. 이미 올렸으면 접어 두고 "다시 올리기"로 연다 */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(defaultOpen);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  // 반영 결과는 화면을 새로 그린 뒤(처음 올린 달은 진행 카드 안으로 옮겨짐)에도 이어서 보이게 — 이 탭에서만
  const resultKey = `pass-upload-result:${projectId}:${ym}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(resultKey);
      sessionStorage.removeItem(resultKey);
      const v = saved ? (JSON.parse(saved) as { at: number; result: UploadResult }) : null;
      // 방금(1분 안) 반영한 결과만 — 다른 화면에 다녀온 뒤 옛 결과가 다시 뜨지 않게
      if (v && Date.now() - v.at < 60_000) { setResult(v.result); setExpanded(true); }
    } catch {
      /* 저장소를 못 쓰면 결과만 생략 */
    }
  }, [resultKey]);
  /** 같은 시트 이름에 구분이 여러 개인 업체 서식: 이 파일이 어느 구분인지 고르기 */
  const [labelChoice, setLabelChoice] = useState<{ vendor: string; sheets: AmbiguousSheet[]; picks: Record<string, string> } | null>(null);
  const readWire = useRef(createWireReader()).current;

  function reset() {
    setLabelChoice(null);
    setSetup(null);
    setPreview(null);
    setResult(null);
    setMsg(null);
  }

  async function post(opts: { profile?: SetupProfile | null; preview?: boolean; reset?: boolean; vendor?: string; newVendor?: boolean; labels?: Record<string, string> }) {
    if (!file) return null;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("ym", ym);
    try {
      fd.set("sheets", await readWire(file));
      fd.set("fileName", file.name);
    } catch (err) {
      setMsg(readError(err));
      setBusy(false);
      return null;
    }
    if (opts.profile) fd.set("profile", JSON.stringify(opts.profile));
    if (opts.vendor) fd.set("vendor", opts.vendor);
    if (opts.labels && Object.keys(opts.labels).length) fd.set("labels", JSON.stringify(opts.labels));
    if (opts.newVendor) fd.set("newVendor", "1");
    if (opts.preview) fd.set("preview", "1");
    if (opts.reset) fd.set("setup", "1");
    fd.set("allowErrors", "1"); // 오류 행은 미리보기에서 확인
    try {
      return await api<PreviewState | UploadResult>(`/api/projects/${projectId}/pass-statements`, { method: "POST", body: fd });
    } catch (err) {
      const data = err instanceof ApiError ? err.data : {};
      if (data.needLabel) {
        setPreview(null);
        const sheets = data.needLabel as AmbiguousSheet[];
        setLabelChoice({ vendor: (data.vendorName as string) ?? opts.vendor ?? "", sheets, picks: Object.fromEntries(sheets.map((x) => [x.sheet, ""])) });
      } else if (data.needSetup) {
        setPreview(null);
        setSetup(setupFromError((err as Error).message, data));
      } else setMsg((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** 미리보기 요청 (profile 없으면 저장된 업체 서식 — vendor를 주면 그 업체, 없으면 머리글로 자동 선택) */
  async function loadPreview(opts: { profile?: SetupProfile | null; reset?: boolean; vendor?: string; newVendor?: boolean; labels?: Record<string, string> } = {}) {
    const r = await post({ ...opts, preview: true });
    if (r && "preview" in r) {
      setPreview(r);
      setSetup(null);
      setLabelChoice(null);
    }
  }

  async function apply() {
    if (!preview) return;
    const r = await post({ profile: preview.usingSaved ? null : preview.profile, vendor: preview.vendor.name, labels: preview.labels });
    if (r && "lineCount" in r) {
      setResult(r);
      setPreview(null);
      try { sessionStorage.setItem(resultKey, JSON.stringify({ at: Date.now(), result: r })); } catch { /* 저장소를 못 쓰면 생략 */ }
      router.refresh();
    }
  }

  function submitSetup() {
    if (!setup) return;
    const r = setupToProfile(setup);
    if ("error" in r) { setMsg(r.error); return; }
    void loadPreview({ profile: r.profile });
  }

  const busyHere = busy || !!setup || !!preview;
  return (
    <section className="card">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5" aria-expanded={expanded}
        onClick={() => { if (!busyHere) setExpanded(!expanded); }}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-primary">
          <Icon d="M12 15V3m0 0-4 4m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" box={24} sw={1.8} className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-title font-bold">{defaultOpen ? "업체 내역 올리기" : "업체 내역 추가 · 다시 올리기"}</span>
          <span className="block truncate text-xs text-fg-muted">{defaultOpen ? (profileText ? `업체 서식: ${profileText}` : "처음 올리면 업체 이름과 사용할 시트·열을 정합니다.") : "다른 업체·다른 구분의 파일은 추가되고, 같은 업체의 같은 구분은 교체됩니다."}</span>
        </span>
        <Icon name="down" sw={1.8} className={`size-4 shrink-0 text-fg-subtle transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
      <div className="space-y-4 border-t border-line px-4 py-4 sm:px-5">
      <p className="text-sm text-fg-muted">업체가 보낸 월 사용 내역(엑셀·CSV)을 올리면 미리보기 후 팀원별로 나눠 보여 줘요.</p>
      {locked ? (
        <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-fg-muted">{lockedText ?? "확정된 달이에요. 다시 올리려면 먼저 [확정 취소]를 누르세요."}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-secondary min-w-0 max-w-full basis-full cursor-pointer justify-start sm:basis-auto sm:flex-none">
            <input type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only" aria-label="업체 내역 파일"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
            <Icon name="plus" />
            <span className="truncate">{file ? file.name : "파일 고르기 (엑셀·CSV)"}</span>
          </label>
          <button className="btn-primary" disabled={!file || busy} onClick={() => loadPreview()}>{busy ? "읽는 중…" : "미리보기"}</button>
          {profileText && <button className="btn-ghost" disabled={!file || busy} onClick={() => loadPreview({ reset: true })}>서식 다시 설정</button>}
        </div>
      )}

      {msg && <p className="alert alert-danger" role="alert">{msg}</p>}

      {labelChoice && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">이 파일이 &apos;{labelChoice.vendor}&apos; 서식의 어느 구분인지 고르세요</p>
          <p className="text-xs">구분을 잘못 고르면 그 구분의 기존 내역이 이 파일로 바뀝니다.</p>
          {labelChoice.sheets.map((x) => (
            <fieldset key={x.sheet} className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">{x.sheet} 시트의 구분</legend>
              <span className="font-medium">{x.sheet} 시트 →</span>
              {x.labels.map((lb) => (
                <label key={lb} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold ${labelChoice.picks[x.sheet] === lb ? "border-primary bg-primary text-on-primary" : "border-amber-300 bg-surface"}`}>
                  <input type="radio" className="sr-only" name={`label-${x.sheet}`} checked={labelChoice.picks[x.sheet] === lb}
                    onChange={() => setLabelChoice({ ...labelChoice, picks: { ...labelChoice.picks, [x.sheet]: lb } })} />
                  {lb}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setLabelChoice(null)}>취소</button>
            <button className="btn-primary" disabled={busy || Object.values(labelChoice.picks).some((v) => !v)}
              onClick={() => loadPreview({ vendor: labelChoice.vendor, labels: labelChoice.picks })}>{busy ? "읽는 중…" : "미리보기"}</button>
          </div>
        </div>
      )}

      {setup && (
        <PassSetupEditor setup={setup} onChange={setSetup} ym={ym} busy={busy} submitLabel="미리보기" onSubmit={submitSetup} onCancel={() => setSetup(null)}
          onPickVendor={(vendor) => loadPreview({ reset: true, vendor })} onNewVendor={() => loadPreview({ newVendor: true })} />
      )}

      {preview && (
        <PreviewPanel key={`${preview.vendor.name}:${JSON.stringify(preview.labels)}:${preview.preview.total.count}:${preview.preview.total.amount}`} state={preview} ym={ym} busy={busy} onApply={apply} onCancel={() => setPreview(null)}
          onEdit={() => loadPreview({ profile: preview.usingSaved ? null : preview.profile, reset: true, vendor: preview.vendor.name, labels: preview.labels })}
          onPickVendor={(vendor) => loadPreview({ vendor })} onNewVendor={() => loadPreview({ newVendor: true })} />
      )}

      {result && (
        <div className="alert alert-ok block space-y-1">
          <p className="font-semibold">✓ {result.vendor} {result.lineCount}건을 {result.replaced ? "다시 " : ""}반영했어요.{result.kept > 0 ? ` 다른 업체·다른 구분 ${result.kept}건은 그대로 두었어요.` : ""}{result.profileSaved ? " 업체 서식을 저장했어요." : ""}</p>
          {result.carried > 0 && <p>기존 표시·결정 {result.carried}건을 이어받았어요.</p>}
          {result.autoDecided > 0 && <p>야근 기록으로 {result.autoDecided}건을 회사 부담으로 정했어요.</p>}
          {result.errorCount > 0 && <p>읽지 못한 행 {result.errorCount}건은 빼고 반영했어요.</p>}
          {result.unmatched.length > 0 && (
            <p>연결 안 된 이름 {result.unmatched.length}개: {result.unmatched.map((u) => `${u.holderName}(${u.count}건 ${won(u.amount)}원)`).join(", ")} — 팀원을 지정하거나 외부인 사용으로 처리하세요.{" "}
              <a href="#flow" className="font-semibold underline underline-offset-2" onClick={(e) => { e.preventDefault(); document.getElementById("flow")?.querySelector("[data-task]")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>지금 할 일로 이동</a></p>
          )}
        </div>
      )}
      </div>
      )}
    </section>
  );
}

const ymLabelShort = (ym: string) => `${Number(ym.slice(5, 7))}월`;

/** 반영 전 미리보기 */
function PreviewPanel({ state, ym, busy, onApply, onEdit, onCancel, onPickVendor, onNewVendor }: {
  state: PreviewState; ym: string; busy: boolean; onApply: () => void; onEdit: () => void; onCancel: () => void;
  onPickVendor: (name: string) => void; onNewVendor: () => void;
}) {
  const p = state.preview;
  const nameOf = new Map(state.displayItems.map((i) => [i.key, i.name]));
  // 기존 내역이 바뀌는 반영은 확인을 받고 진행 (다른 구분 파일을 잘못 올려 내역이 지워지지 않게)
  const replacing = p.existing.filter((g) => g.action === "replace");
  const [confirmed, setConfirmed] = useState(false);
  // 업체 내역 이름 ≠ 연결된 팀원 이름 (외부인 사용분을 팀원에게 연결해 둔 경우 등) → 눈에 띄게, 맨 위로
  const norm = (v: string) => v.replace(/\s+/g, "");
  const isOther = (x: { holderName: string; userName: string | null }) => !!x.userName && norm(x.userName) !== norm(x.holderName);
  const people = [...p.people].sort((a, b) => Number(isOther(b)) - Number(isOther(a)));
  const otherCount = people.filter(isOther).length;
  const skipText = (k: SkipCounts) => (Object.keys(k) as (keyof SkipCounts)[]).filter((x) => k[x] > 0).map((x) => `${SKIP_LABEL[x]} ${k[x]}`).join(" · ");
  return (
    <div className="space-y-4 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold">미리보기 — 아직 반영 전</h3>
        <span className="text-sm text-fg-muted">{ymLabelShort(ym)}분 사용 기간: {passPeriodLabel(ym, state.profile.periodStartDay)}</span>
        <span className="tabular text-sm">전체 <b>{p.total.count}건 {won(p.total.amount)}원</b></span>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-muted/60 px-3 py-2 text-sm">
        <span>업체: <b>{state.vendor.name}</b>{state.vendor.auto && <span className="text-fg-muted"> (자동 선택)</span>}{state.vendor.isNew && <span className="text-fg-muted"> (새 업체 서식 — 반영하면 저장)</span>}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {state.vendors.filter((v) => v !== state.vendor.name).length > 0 && (
            <Menu label="다른 업체 서식으로 읽기" disabled={busy} triggerClassName="btn-ghost btn-sm gap-1"
              items={state.vendors.filter((v) => v !== state.vendor.name).map((v) => ({ key: v, label: v, onSelect: () => onPickVendor(v) }))}>
              다른 업체 서식으로 <Caret />
            </Menu>
          )}
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onNewVendor}>새 업체로 설정</button>
        </span>
      </div>
      {p.existing.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-muted/60 px-3 py-2 text-sm">
          <p className="font-semibold">이미 올린 {ymLabelShort(ym)}분 내역</p>
          <ul className="mt-1 space-y-0.5">
            {p.existing.map((g) => (
              <li key={g.label + g.action} className="tabular">
                <b>{g.label}</b> {g.count}건 {won(g.amount)}원 —{" "}
                {g.action === "replace"
                  ? <span className="font-semibold text-amber-700">이번 파일로 바뀜 (같은 줄의 결정은 이어받음)</span>
                  : <span className="text-status-approved">그대로 둠</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.warnings.length > 0 && (
        <div className="alert alert-danger block space-y-1 text-sm" role="alert">
          <p className="font-semibold">⚠ 기존 내역을 다른 내용으로 바꾸는 것 같습니다</p>
          <ul className="list-disc pl-5">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {replacing.length > 0 && (
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            <b>{replacing.map((g) => `${g.label} ${g.count}건`).join(", ")}</b>이(가) 이번 파일 내용으로 바뀝니다. 같은 업체·같은 구분의 파일이 맞는지 확인했습니다.
          </span>
        </label>
      )}
      {p.unconfigured.length > 0 && (
        <p className="alert alert-warn text-sm">
          서식에 없는 시트는 읽지 않았어요: <b>{p.unconfigured.join(", ")}</b> — 반영하려면 [서식 수정]에서 시트를 고르세요.
        </p>
      )}
      {p.sheets.map((s) => {
        const hasDate = s.rows.some((r) => r.date);
        return (
        <div key={`${s.sheetName}|${s.label}`} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <b>{s.label}</b>{s.label !== s.sheetName && <span className="text-xs text-fg-subtle">({s.sheetName} 시트)</span>}
            <span className="tabular">{s.count}건 {won(s.amount)}원</span>
            {skipText(s.skipped) && <span className="text-xs text-fg-subtle">건너뜀: {skipText(s.skipped)}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-fg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">행</th>
                  {hasDate && <th className="px-2 py-1 text-left">날짜</th>}
                  <th className="px-2 py-1 text-left">이름</th>
                  {s.columns.map((c, i) => <th key={i} className="px-2 py-1 text-left">{nameOf.get(c) ?? c}</th>)}
                  <th className="px-2 py-1 text-right">금액(합계)</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.row} className="border-t border-line">
                    <td className="px-2 py-1 text-fg-subtle">{r.row}</td>
                    {hasDate && <td className="tabular px-2 py-1 whitespace-nowrap">{r.date && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? shortDate(r.date) : r.date}</td>}
                    <td className="px-2 py-1 whitespace-nowrap">{r.holderName}</td>
                    {r.extra.map((e, i) => <td key={i} className="px-2 py-1 whitespace-nowrap">{e.value}</td>)}
                    <td className="tabular px-2 py-1 text-right">{won(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })}
      <div>
        <h4 className="text-sm font-semibold">이름별 합계</h4>
        {otherCount > 0 && (
          <p className="mt-1 text-xs font-medium text-status-rejected">
            ⚠ 업체 내역 이름과 연결된 팀원 이름이 다른 사람 {otherCount}명 — 외부인 사용분을 팀원에게 잘못 연결한 것이 아닌지 확인하세요.
          </p>
        )}
        <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
          {people.map((x, i) => {
            const other = isOther(x);
            return (
              <li key={i} className={`flex justify-between gap-2 rounded-lg px-3 py-1.5 ${other ? "border border-rose-300 bg-rose-50 text-rose-900" : "bg-surface-muted"}`}>
                <span className="min-w-0">
                  {other && <span className="mr-1.5 rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-on-primary">다른 사람</span>}
                  {x.holderName}{" "}
                  <span className={`text-xs ${other ? "font-semibold text-status-rejected" : x.userName ? "text-fg-muted" : "text-amber-700"}`}>{x.userName ? `→ ${x.userName}` : "연결 안 된 이름"}</span>
                </span>
                <span className="tabular shrink-0">{x.count}건 {won(x.amount)}원</span>
              </li>
            );
          })}
        </ul>
      </div>
      {p.errorCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">읽을 수 없는 행 {p.errorCount}건 (반영 시 제외)</p>
          <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">{p.errors.map((e, i) => <li key={i}>{e.sheet} {e.row}행: {e.message}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>취소</button>
        <button className="btn-secondary" disabled={busy} onClick={onEdit}>서식 수정</button>
        <button className="btn-primary" disabled={busy || p.total.count === 0 || (replacing.length > 0 && !confirmed)} onClick={onApply}>{busy ? "반영 중…" : `반영 (${p.total.count}건)`}</button>
      </div>
    </div>
  );
}
