"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useRun, type RunColors } from "./hooks/useRun";
import { won } from "@/lib/format";
import { PAY_METHOD_LABEL } from "@/lib/types";
import { Switch } from "./Switch";
import { SaveBar } from "./SaveBar";

/** 결과는 알림 상자로 (span이므로 block) */
const ALERT_COLORS: RunColors = { ok: "text-status-approved", error: "text-status-rejected" };
type PassItemView ={ id: string; name: string; perPersonLimit: number | null };

/** 출입증 사용 설정 (PM·재무 승인·시스템 관리자): 사용 여부·이름. 회사 부담 항목은 재무 승인이 정하고 여기서는 보기만 */
export function PassSettings({ projectId, enabled, name, items = [] }: {
  projectId: string; enabled: boolean; name: string | null;
  /** 재무 승인이 프로젝트 운영비에서 등록한 출입증 회사 부담 항목 */
  items?: PassItemView[];
}) {
  const [on, setOn] = useState(enabled);
  const [passName, setPassName] = useState(name ?? "");
  const { act, busy, view } = useRun(ALERT_COLORS);

  const passItems = items;
  const dirty = on !== enabled || passName.trim() !== (name ?? "");

  const save = () => act(
    () => api(`/api/projects/${projectId}/client-pass`, { method: "PUT", json: { enabled: on, name: passName } }),
    on ? "저장했어요. 팀원의 내 지출 내역에 [카드 | 출입증] 탭이 나타나요." : "출입증 사용을 껐어요. 기존 사용 내역은 그대로 남아 있어요.",
  );

  return (
    <div className="card overflow-clip">
      <div className="card-head items-start gap-4">
        <div>
          <h2 className="section-title">출입증</h2>
          <p className="mt-1 text-sm text-fg-muted">
            고객사 출입증으로 식사·커피를 결제하는 프로젝트라면 켜세요. 사용분은 {PAY_METHOD_LABEL.PERSONAL_CARD} 정산과 따로 처리하고, 예산 항목에 연결한 회사 부담 확정분만 그 달 상신 엑셀과 예산 집행에 합쳐집니다.
          </p>
        </div>
        <Switch checked={on} onChange={setOn} label="출입증 사용" className="mt-0.5" />
      </div>
      <div className="space-y-4 p-5">
      {on && (
        <>
          <label className="block">
            <span className="text-sm font-semibold">출입증 이름</span>
            <input className="input mt-1" placeholder="예) 고객사 출입증" value={passName} maxLength={40} onChange={(e) => setPassName(e.target.value)} />
          </label>
          <div>
            <div className="text-sm font-semibold">회사 부담 항목</div>
            <p className="mt-0.5 text-sm text-fg-muted">
              기본은 <b>본인 부담(급여 공제)</b>이고, 회사 부담 항목은 재무 승인 담당이 프로젝트 운영비 › 출입증 회사 부담 항목에서 정합니다.
            </p>
            {passItems.length === 0 ? (
              <p className="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg-muted">아직 항목이 없어 모든 사용분이 본인 부담입니다. 필요하면 재무 승인 담당에게 요청하세요.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {passItems.map((c) => (
                  <span key={c.id} className="rounded-full bg-surface-muted px-3 py-1 text-sm">
                    {c.name}{c.perPersonLimit ? <span className="text-fg-muted"> · 1일 {won(c.perPersonLimit)}원</span> : null}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {!on && <p className="text-sm text-fg-muted">사용하지 않음 — 켜면 출입증 이름과 회사 부담 항목을 확인할 수 있어요.</p>}
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} status={view}
        onReset={() => { setOn(enabled); setPassName(name ?? ""); }} />
    </div>
  );
}
