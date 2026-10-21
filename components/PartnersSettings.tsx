"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { useRun, type RunColors } from "./hooks/useRun";
import { PARTNER_TEXT_MAX, partnerLabel } from "@/lib/partners";
import { Switch } from "./Switch";
import { Icon } from "./icons";
import { SaveBar } from "./SaveBar";

const SETTINGS_COLORS: RunColors = { ok: "text-emerald-700", error: "text-rose-600" };
type Row ={ id?: string; key: string; name: string; company: string | null; active: boolean };

/**
 * PM 설정 — 협력 인력 (협력사 프리랜서 등 우리 회사 인력이 아닌 프로젝트 인력).
 * 등록하면 지출 입력의 참석자 칩으로 나온다. 철수하면 '참석자에 표시'를 끈다.
 * 삭제해도 지출 참석자 기록이 있는 사람은 서버가 삭제 대신 '참석자에 표시'만 끄고 남긴다 (저장 결과 kept로 알려 준다).
 */
export function PartnersSettings({ projectId, initial }: { projectId: string; initial: { id: string; name: string; company: string | null; active: boolean }[] }) {
  const start = initial.map((p) => ({ ...p, key: p.id }));
  const [rows, setRows] = useState<Row[]>(start);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const { run, busy, view, setMsg } = useRun(SETTINGS_COLORS);
  const strip = (rs: Row[]) => JSON.stringify(rs.map(({ id, name, company, active }) => [id, name, company, active]));
  const dirty = strip(rows) !== strip(start);
  // 저장 후 새로 받은 목록(새 id 포함)으로 맞춘다 — 안 그러면 새로 추가한 줄이 계속 "변경"으로 남는다
  const resync = useRef(false);
  const initialKey = strip(start);
  useEffect(() => {
    if (!resync.current) return;
    resync.current = false;
    setRows(initial.map((p) => ({ ...p, key: p.id })));
  }, [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = /[,()]/;

  function add() {
    const n = name.trim();
    const c = company.trim() || null;
    if (!n) return;
    if (bad.test(n) || (c && bad.test(c))) { setMsg({ ok: false, text: "이름·소속에는 쉼표나 괄호를 쓸 수 없습니다." }); return; }
    if (rows.some((r) => partnerLabel(r) === partnerLabel({ name: n, company: c }))) { setMsg({ ok: false, text: "이미 등록된 협력 인력입니다." }); return; }
    setRows([...rows, { key: `new-${Date.now()}`, name: n, company: c, active: true }]);
    setName("");
    setMsg(null);
  }

  const save = async () => {
    resync.current = true;
    const res = await run(() => api<{ ok: true; kept: string[] }>(`/api/projects/${projectId}/partners`, { method: "PUT", json: { partners: rows.map(({ id, name, company, active }) => ({ id, name, company, active })) } }));
    if (!res) { resync.current = false; return; }
    setMsg({ ok: true, text: res.kept.length ? `저장되었습니다. ${res.kept.join(", ")}은(는) 지출 기록이 있어 삭제 대신 '참석자에 표시'를 껐어요.` : "저장되었습니다." });
  };

  const on = rows.filter((r) => r.active).length;
  return (
    <div className="card overflow-clip">
      <div className="card-head flex-col items-start gap-1">
        <h2 className="section-title">협력 인력 <span className="font-medium text-fg-muted">{on}명</span></h2>
        <p className="text-sm text-fg-muted">협력사 프리랜서 등 외부 인력을 등록하면 지출 입력에서 참석자로 고를 수 있어요.</p>
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} className={`flex min-h-12 items-center gap-3 px-4 py-2 ${r.active ? "" : "text-fg-subtle"}`}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-sm font-bold text-fg-muted">{r.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.name}</div>
                <div className="truncate text-xs text-fg-muted">{r.company ?? "소속 미입력"}</div>
              </div>
              <label className="flex items-center gap-2 text-xs text-fg-muted" title="끄면 참석자 선택에서 숨겨요 (철수 등)">
                <Switch checked={r.active} label={`${r.name} 참석자에 표시`} onChange={() => setRows(rows.map((x) => (x.key === r.key ? { ...x, active: !x.active } : x)))} />
                <span className="hidden sm:inline">참석자에 표시</span>
              </label>
              <button type="button" aria-label={`${r.name} 삭제`} title="삭제"
                className="flex size-10 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-rose-50 hover:text-rose-600"
                onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="grid grid-cols-1 gap-2 border-t sm:grid-cols-[10rem_minmax(0,1fr)_auto] border-line bg-surface-muted/40 px-4 py-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input min-w-0" placeholder="이름" aria-label="협력 인력 이름" value={name} maxLength={PARTNER_TEXT_MAX.name} onChange={(e) => setName(e.target.value)} />
        <input className="input min-w-0" placeholder="소속 (선택, 예: ○○테크)" aria-label="소속" value={company} maxLength={PARTNER_TEXT_MAX.company} onChange={(e) => setCompany(e.target.value)} />
        <button className="btn-secondary" disabled={!name.trim()}>목록에 추가</button>
      </form>

      <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setRows(start)} status={view}
        note={rows.length ? undefined : "[저장]을 눌러야 반영돼요."} />
    </div>
  );
}
