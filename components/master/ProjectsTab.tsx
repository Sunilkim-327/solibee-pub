"use client";

import Link from "next/link";
import { useState } from "react";
import { useRun } from "../hooks/useRun";
import { CreateProject } from "./CreateProject";
import type { CardSection } from "./ProjectCard";
import type { Role } from "@/lib/types";
import type { Dept } from "../AdminDirectory";
import { Empty } from "../common";
import { TreeGuide } from "../Tree";
import { chip } from "../ui";
import { ProjectCard } from "./ProjectCard";
import { Icon } from "../icons";
import { ListToolbar, SearchInput } from "../list/ListToolbar";
import { FILTERS, matchFilter, type Filter } from "./model";
import type { Category, Project, User } from "./types";

/** 프로젝트 설정 — 필터 칩·검색, 트리(전체) 또는 평평한 목록. 새 프로젝트는 여기서(재무 승인) 또는 프로젝트 체계도에서 같은 양식으로 만든다 */
export function ProjectsTab({ projects, users, depts, role, categories, focus }: { projects: Project[]; users: User[]; depts: Dept[]; role: Role; categories: Category[];
  /** 주소로 연 프로젝트 카드 (?project=&tab=) */
  focus?: { projectId: string; tab: CardSection } }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const created = useRun();
  const canCreate = role === "HQ";
  const [q, setQ] = useState("");
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const query = q.trim().toLowerCase();
  const visible = projects.filter((p) => matchFilter(p, filter) && (!query || [
    p.name, p.code ?? "", p.departmentName ?? "", ...p.members.filter((m) => m.isPm).map((m) => nameOf.get(m.userId) ?? ""),
  ].join(" ").toLowerCase().includes(query)));
  // 필터·검색 중에는 트리 대신 평평한 목록
  const flat = filter !== "all" || !!query;

  return (
    <div className="space-y-4">
      <ListToolbar label="프로젝트 목록 도구" className="mb-0"
        filters={
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="프로젝트 필터">
            {FILTERS.map(([k, label]) => {
              const n = projects.filter((p) => matchFilter(p, k)).length;
              const on = filter === k;
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setFilter(k)} className={`${chip(on)} shrink-0 gap-1.5`}>
                  {label}
                  <span className={`tabular text-xs ${on ? "" : k === "setup" && n ? "font-bold text-amber-800" : "text-fg-muted"}`}>{n}</span>
                </button>
              );
            })}
          </div>
        }
        search={<SearchInput placeholder="프로젝트·조직·PM 검색" value={q} aria-label="프로젝트 검색" onChange={(e) => setQ(e.target.value)} />}
        actions={canCreate
          ? <button type="button" className="btn-secondary shrink-0" aria-expanded={creating} onClick={() => setCreating(true)}><Icon name="plus" /> 새 프로젝트</button>
          : <Link href="/eps" className="btn-secondary shrink-0" title="새 프로젝트는 프로젝트 체계도에서 조직을 골라 만듭니다"><Icon name="plus" /> 새 프로젝트</Link>} />

      {creating && (
        <CreateProject projects={projects} users={users} depts={depts} categories={categories} run={created}
          onClose={(done) => { if (!done) created.setMsg(null); setCreating(false); }} />
      )}

      <div className="space-y-3">
        {visible.length === 0 && (
          <Empty card icon={projects.length ? "search" : "project"} title={projects.length ? "조건에 맞는 프로젝트가 없습니다" : "아직 프로젝트가 없습니다"}
            action={projects.length ? undefined : canCreate
              ? <button type="button" className="btn-primary" onClick={() => setCreating(true)}>새 프로젝트 만들기</button>
              : <Link href="/eps" className="btn-primary">체계도에서 프로젝트 만들기</Link>} />
        )}
        {visible.map((p, i) => (
          <div key={p.id} className="flex items-stretch">
            {!flat && <TreeGuide depth={p.depth} last={!visible.slice(i + 1).some((x) => x.parentId === p.parentId)} />}
            <ProjectCard project={p} projects={projects} users={users} depts={depts} canBudget={role === "HQ"}
              initialOpen={focus?.projectId === p.id ? focus.tab : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
