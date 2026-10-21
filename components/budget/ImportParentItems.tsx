"use client";

import { api } from "@/lib/client";
import { useConfirm } from "../ConfirmDialog";
import { useRun } from "../hooks/useRun";

/**
 * 메인 항목 가져오기 (재무 승인, 서브 프로젝트) — 상위(메인) 프로젝트 항목을 같은 항목 코드로 복사.
 * 같은 코드 = 같은 항목: 메인 현황에서 함께 모으고, 상신 엑셀에서는 구분명으로 나뉜다
 */
export function ImportParentItems({ projectId, parentName, settleWithParent }: { projectId: string; parentName: string; settleWithParent: boolean }) {
  const { act, busy, view } = useRun();
  const { confirm, alert, dialog } = useConfirm();
  const run = async () => {
    const ok = await confirm({
      title: "메인 항목 가져오기",
      message: `${parentName}의 항목 중 이 프로젝트에 없는 항목을 같은 항목 코드로 추가합니다. 이미 있는 항목·예산·지출은 바꾸지 않습니다.${settleWithParent ? " 상신 엑셀에서는 구분명으로 나뉩니다." : ""}`,
      confirmLabel: "가져오기",
    });
    if (!ok) return;
    let text = "";
    await act(async () => {
      const r = await api<{ created: number; matched: number; mainCoded: number }>(`/api/projects/${projectId}/import-parent-items`, { method: "POST" });
      text = r.created || r.matched ? `항목 ${r.created}개 추가${r.matched ? ` · ${r.matched}개 코드 맞춤` : ""}` : "가져올 항목이 없습니다 (모두 있음)";
    });
    if (text) await alert({ title: "메인 항목 가져오기", message: text });
  };
  return (
    <>
      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={run} title={`${parentName} 항목을 같은 코드로 복사`}>메인 항목 가져오기</button>
      {view}
      {dialog}
    </>
  );
}
