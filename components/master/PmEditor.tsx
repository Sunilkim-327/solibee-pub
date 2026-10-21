"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { sortPeople } from "@/lib/org";
import { useRun } from "../hooks/useRun";
import { Icon } from "../icons";
import { PersonPicker } from "./PersonPicker";
import type { Project, User } from "./types";

/** PM 지정 — 재무 승인·시스템 관리자는 PM만 정하고, 팀원 추가·제외는 이 프로젝트 PM이 PM 설정에서 한다 */
export function PmEditor({ project, users }: { project: Project; users: User[] }) {
  const [roleNote, setRoleNote] = useState("");
  const initial = project.members.filter((m) => m.isPm).map((m) => m.userId);
  const [pmIds, setPmIds] = useState(initial);
  const [adding, setAdding] = useState("");
  const { act: run, busy, view } = useRun();
  const byId = new Map(users.map((u) => [u.id, u]));
  const dirty = JSON.stringify([...pmIds].sort()) !== JSON.stringify([...initial].sort());
  const others = project.members.length - project.members.filter((m) => m.isPm).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {pmIds.length === 0 && <span className="badge badge-bad px-2 py-1 text-xs">PM 미지정</span>}
        {sortPeople(pmIds, (id) => ({ name: byId.get(id)?.name ?? "", position: byId.get(id)?.position })).map((id) => {
          const u = byId.get(id);
          return (
            <span key={id} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-brand-50 py-1 pr-1 pl-3.5 text-sm text-primary">
              <b className="font-semibold">{u?.name ?? "(비활성 사용자)"}</b>
              {u?.position && <span className="text-xs opacity-75">{u.position}</span>}
              <button type="button" className="flex size-8 items-center justify-center rounded-full hover:bg-surface" aria-label={`${u?.name ?? ""} PM 해제`} title="PM 해제 (팀원으로는 남습니다)"
                onClick={() => setPmIds((s) => s.filter((x) => x !== id))}><Icon name="close" className="size-3.5" /></button>
            </span>
          );
        })}
      </div>
      <div className="max-w-sm">
        <PersonPicker users={users.filter((u) => !pmIds.includes(u.id))} value={adding} placeholder="PM 추가 — 이름 검색"
          onChange={(id) => { if (id) setPmIds((s) => [...s, id]); setAdding(""); }} />
      </div>
      <p className="text-sm text-fg-muted">팀원 {project.members.length}명 (PM 외 {others}명) · 팀원 관리는 PM이 PM 설정에서 합니다</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button className="btn-primary" disabled={busy || !dirty}
          onClick={() => run(async () => {
            const r = await api<{ roleChanges: { name: string; to: string }[] }>(`/api/projects/${project.id}/members`, { method: "PUT", json: { pmIds } });
            setRoleNote(r.roleChanges.map((c) => `${c.name} ${c.to === "MANAGER" ? "PM 권한 부여" : "PM 권한 회수"}`).join(" · "));
          }, "PM 저장됨")}>
          PM 저장
        </button>
        {dirty && <button className="btn-ghost" onClick={() => setPmIds(initial)}>변경 취소</button>}
        {view}
        {roleNote && <span className="text-sm font-semibold text-primary">{roleNote}</span>}
      </div>
    </div>
  );
}
