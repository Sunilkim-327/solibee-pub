"use client";

import { useState } from "react";
import type { Role } from "@/lib/types";
import type { Dept } from "./AdminDirectory";
import { CatalogTab } from "./master/CatalogTab";
import { ProjectsTab } from "./master/ProjectsTab";
import type { Category, Project, User } from "./master/types";
import type { CardSection } from "./master/ProjectCard";

type Props = {
  role: Role; categories: Category[]; users: User[]; projects: Project[]; depts: Dept[];
  /** 주소로 연 프로젝트 카드 (?project=&tab=) — 예: 종료 처리 가능 할 일 → 상태·연차 */
  focus?: { projectId: string; tab: CardSection };
};
type Tab = "projects" | "catalog";

/**
 * 기준 정보 — 재무 승인: 프로젝트 설정(PM 지정·준비 상태·연차·변경계약) + 회사 공통 분류·항목 / 시스템 관리자: 프로젝트 설정.
 * 프로젝트 만들기는 여기 또는 프로젝트 체계도, 조직 이동은 프로젝트 체계도, 조직·임직원·계정은 조직도에서 한다.
 */
export function MasterAdmin(props: Props) {
  const tabs: [Tab, string, number | null][] =
    props.role === "HQ" ? [["projects", "프로젝트 설정", props.projects.length], ["catalog", "분류·항목", null]] : [["projects", "프로젝트 설정", props.projects.length]];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  return (
    <div>
      {tabs.length > 1 && (
        <div className="seg mb-5 w-full sm:w-auto" role="tablist" aria-label="기준 정보">
          {tabs.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="flex-1 px-4 sm:flex-none">
              {label}
              {n !== null && <span className="tabular text-xs font-medium text-fg-muted">{n}</span>}
            </button>
          ))}
        </div>
      )}
      {tab === "projects" && <ProjectsTab projects={props.projects} users={props.users} depts={props.depts} role={props.role} categories={props.categories} focus={props.focus} />}
      {tab === "catalog" && <CatalogTab categories={props.categories} projects={props.projects} />}
    </div>
  );
}
