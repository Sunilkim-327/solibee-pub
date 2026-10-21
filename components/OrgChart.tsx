"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { dotDate, won } from "@/lib/format";
import type { OrgDept, OrgPerson, OrgProject } from "@/lib/dto";
import { OpenProjectButton } from "./OpenProjectButton";
import { descendantIds, epsDepartments, positionTier, type PositionTier } from "@/lib/org";
import { nonDefaultRole } from "@/lib/directory";
import { NodeIcon, TreeView, type TreeNode } from "./Tree";
import { TempPasswordDialog, type TempPassword } from "./TempPasswordDialog";
import { Sheet } from "./Sheet";
import { Meter } from "./Meter";
import { Empty } from "./common";
import { useRun } from "./hooks/useRun";
import { useConfirm } from "./ConfirmDialog";
import { DeptSelect } from "./admin/DeptSelect";
import { DeptFields, confirmDeptToggle, deptPayload, type DeptValues } from "./admin/DeptForm";
import { UserAccountActions, UserFields, accountActionPayload, userPayload, userValues, type AccountAction, type UserPatchResult } from "./admin/UserForm";
import { CreateProject } from "./master/CreateProject";
import type { Category, Project, User } from "./master/types";
import type { Dept } from "./admin/DeptSelect";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { Icon } from "./icons";

/** 체계도에서 프로젝트를 만들 때 쓰는 기준 정보 (재무 승인·시스템 관리자) — 기준 정보 화면에 있던 '새 프로젝트' 양식을 그대로 쓴다 */
export type CreateData = { projects: Project[]; users: User[]; depts: Dept[]; categories: Category[] };

/** mode: "people" = 조직도(조직 아래 사람), "projects" = 프로젝트 체계도(EPS, 조직 아래 프로젝트) */
type Props = { mode: "people" | "projects"; depts: OrgDept[]; people: OrgPerson[]; projects: OrgProject[]; canManage: boolean; canManageProjects: boolean;
  /** 조직(부서) 추가·수정·조직장 지정 — 시스템 관리자, 조직도에서 */
  canManageDepts?: boolean;
  /** 처음 고를 조직 (내 조직) — 목록에 없으면 가장 가까운 상위, 그래도 없으면 최상위 */
  initialDeptId?: string | null;
  /** 체계도에서 프로젝트를 만들 수 있음 (재무 승인·시스템 관리자) — 양식 데이터는 처음 열 때 불러온다 */
  canCreate?: boolean;
  /** 체계도에서 조직 수정은 조직도로 (시스템 관리자) */
  orgLink?: boolean };

const ROLE_STYLE: Record<Role, string> = {
  ADMIN: "bg-line text-fg",
  HQ: "bg-sky-100 text-sky-800",
  MANAGER: "bg-brand-50 text-primary",
  MEMBER: "bg-surface-muted text-fg-muted",
};

/** 직급 구분 색 — 임원 · 조직장(그룹장·팀장) · 책임급(수석·책임) · 실무(담당·사원) · 인턴·임시 */
const TIER_STYLE: Record<PositionTier, { avatar: string; chip: string; dot: string; label: string }> = {
  exec: { avatar: "bg-primary text-on-primary", chip: "bg-primary text-on-primary", dot: "bg-primary", label: "임원" },
  lead: { avatar: "bg-amber-100 text-amber-800 ring-2 ring-amber-200", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500", label: "조직장" },
  senior: { avatar: "bg-sky-100 text-sky-800", chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500", label: "책임급" },
  staff: { avatar: "bg-brand-50 text-brand-700", chip: "bg-surface-muted text-fg", dot: "bg-fg-subtle", label: "실무" },
  temp: { avatar: "border border-dashed border-line-strong bg-surface text-fg-muted", chip: "border border-dashed border-line-strong text-fg-muted", dot: "bg-line-strong", label: "인턴·임시" },
  none: { avatar: "bg-surface-muted text-fg-muted", chip: "bg-surface-muted text-fg-muted", dot: "bg-line-strong", label: "직급 없음" },
};

/** 한 번에 그리는 수 — 더 보기로 늘린다 (모바일에서 수백 명이 한꺼번에 그려지지 않게) */
const PEOPLE_PAGE = 30;
const PROJECT_PAGE = 20;

function Avatar({ name, inactive, tier = "staff" }: { name: string; inactive?: boolean; tier?: PositionTier }) {
  return (
    <span className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${inactive ? "bg-surface-muted text-fg-subtle" : TIER_STYLE[tier].avatar}`}>
      {name.slice(0, 1)}
    </span>
  );
}

/** 직급 → 성명 순 목록을 직급별로 묶는다 */
function groupByPosition(list: OrgPerson[]) {
  const groups: { position: string; tier: PositionTier; people: OrgPerson[] }[] = [];
  for (const p of list) {
    const position = p.position?.trim() || "직급 없음";
    const last = groups[groups.length - 1];
    if (last && last.position === position) last.people.push(p);
    else groups.push({ position, tier: positionTier(p.position), people: [p] });
  }
  return groups;
}

/** 처음 고를 조직: 원하는 조직 → 목록에 있는 가장 가까운 상위 → 최상위 */
function startDept(all: OrgDept[], shown: { id: string }[], want: string | null | undefined, fallback: string) {
  const ids = new Set(shown.map((d) => d.id));
  const parentOf = new Map(all.map((d) => [d.id, d.parentId]));
  let cur = want ?? null;
  while (cur) { if (ids.has(cur)) return cur; cur = parentOf.get(cur) ?? null; }
  return fallback;
}

export function OrgChart({ mode, depts: allDepts, people, projects, canManage, canManageProjects, canManageDepts = canManage, initialDeptId, canCreate, orgLink }: Props) {
  const [showAllEps, setShowAllEps] = useState(false);
  // 프로젝트 체계도: 체계도 사용 부서와 그 상위(묶음)만. 조직도: 전체
  const depts: (OrgDept & { group?: boolean })[] = useMemo(
    () => (mode === "projects" && !showAllEps ? epsDepartments(allDepts) : allDepts.map((d) => ({ ...d, group: mode === "projects" && !d.epsEnabled }))),
    [mode, showAllEps, allDepts],
  );
  const roots = depts.filter((d) => d.depth === 0).map((d) => d.id);
  const [selected, setSelected] = useState<string>(() => startDept(allDepts, depts, initialDeptId, roots[0] ?? ""));
  // 모바일 2단계: 조직 고르기(tree) → 목록(list). 내 조직이 정해져 있으면 바로 목록부터
  const [step, setStep] = useState<"tree" | "list">(() => (initialDeptId && !roots.includes(selected) ? "list" : "tree"));
  const [q, setQ] = useState("");
  // 조직도는 고른 조직의 직속부터 (하위 포함은 필요할 때 켠다) · 체계도는 하위 포함
  const [withSub, setWithSub] = useState(mode === "projects");
  const [showInactive, setShowInactive] = useState(false);
  const pageSize = mode === "people" ? PEOPLE_PAGE : PROJECT_PAGE;
  const [limit, setLimit] = useState(pageSize);
  const tab = mode;
  const [editing, setEditing] = useState<OrgPerson | "new" | null>(null);
  const [deptEdit, setDeptEdit] = useState<"new" | "edit" | null>(null);
  const [creating, setCreating] = useState(false);
  const created = useRun();
  const [createData, setCreateData] = useState<CreateData | null>(null);
  const loader = useRun();
  // 만들기 양식 열기 — 기준 정보(프로젝트·사람·조직·분류)는 처음 열 때 한 번만 불러온다
  const openCreate = async () => {
    if (!createData) {
      const data = await loader.run(() => api<CreateData>("/api/master/create-data"), undefined, { refresh: false });
      if (!data) return;
      setCreateData(data);
    }
    setCreating(true);
  };
  const [notice, setNotice] = useState<string | null>(null);
  const [temps, setTemps] = useState<TempPassword[]>([]);

  const children = useMemo(() => {
    const m = new Map<string | null, (OrgDept & { group?: boolean })[]>();
    for (const d of depts) m.set(d.parentId, [...(m.get(d.parentId) ?? []), d]);
    return m;
  }, [depts]);
  const subtree = (id: string): string[] => [id, ...(children.get(id) ?? []).flatMap((c) => subtree(c.id))];
  const visiblePeople = people.filter((p) => showInactive || p.active);
  // 조직별 직속 인원·프로젝트 수 — 노드마다 전체 목록을 훑지 않도록 한 번만 센다
  const directCount = useMemo(() => {
    const m = new Map<string, number>();
    const add = (id: string | null) => { if (id) m.set(id, (m.get(id) ?? 0) + 1); };
    if (mode === "projects") for (const p of projects) add(p.departmentId);
    else for (const p of people) if (showInactive || p.active) add(p.departmentId);
    return m;
  }, [mode, projects, people, showInactive]);
  /** 하위 조직 포함 수 */
  const countIn = (id: string) => subtree(id).reduce((a, d) => a + (directCount.get(d) ?? 0), 0);
  const dept = depts.find((d) => d.id === selected);
  const deptIds = new Set(selected ? (withSub ? subtree(selected) : [selected]) : []);
  const query = q.trim().toLowerCase();
  const deptNames = useMemo(() => new Map(allDepts.map((d) => [d.id, d.name])), [allDepts]);
  const deptName = (id: string | null) => (id && deptNames.get(id)) || "부서 없음";
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const list = query
    ? visiblePeople.filter((p) => `${p.name} ${p.position ?? ""} ${p.employeeNo ?? ""} ${deptName(p.departmentId)}`.toLowerCase().includes(query))
    : visiblePeople.filter((p) => p.departmentId && deptIds.has(p.departmentId));
  const projectList = query
    ? projects.filter((p) => `${p.name} ${p.code ?? ""}`.toLowerCase().includes(query))
    : projects.filter((p) => p.departmentId && deptIds.has(p.departmentId));
  const unassigned = visiblePeople.filter((p) => !p.departmentId);
  const total = mode === "projects" ? projectList.length : list.length;

  // 공통 트리 노드: 조직(회사·조직·묶음) + 체계도 모드에서는 프로젝트
  const treeNodes: TreeNode[] = useMemo(() => {
    // 체계도 조회(관리 권한 없음): 프로젝트가 하나도 없는 조직은 숨긴다
    const hideEmpty = mode === "projects" && !canManageProjects;
    const out: TreeNode[] = depts
      .map((d): TreeNode => ({
        id: d.id,
        parentId: d.parentId,
        label: d.name,
        icon: d.depth === 0 ? "company" : d.group ? "group" : "org",
        count: countIn(d.id),
        tag: mode === "projects" && !d.epsEnabled ? (showAllEps ? "체계도 미사용" : "묶음") : null,
        muted: !!d.group,
        strike: !d.active,
      }))
      .filter((n) => !hideEmpty || (n.count ?? 0) > 0);
    if (mode === "projects") {
      const shownIds = new Set(out.map((d) => d.id));
      for (const p of projects) {
        if (!p.departmentId || !shownIds.has(p.departmentId)) continue;
        const parent = p.parentId ? projectById.get(p.parentId) : null;
        out.push({
          id: `p:${p.id}`,
          parentId: parent && parent.departmentId === p.departmentId ? `p:${parent.id}` : p.departmentId,
          label: p.name,
          icon: parent ? "subproject" : "project",
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depts, projects, mode, showAllEps, showInactive, people, canManageProjects]);

  const pick = (id: string) => { setSelected(id); setStep("list"); setLimit(pageSize); setCreating(false); };
  const canCreateHere = canManageProjects && !!canCreate && tab === "projects" && !!dept && dept.epsEnabled && !query;
  const listStep = step === "list" || !!query;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/* 조직 트리 (부서 + 프로젝트) — 모바일은 1단계 화면 */}
      <aside className={`card h-fit overflow-hidden p-3 lg:sticky lg:top-20 lg:block ${listStep ? "hidden" : ""}`}>
        <div className="mb-2 flex min-h-9 items-center justify-between gap-2 px-1">
          <span className="section-title">{mode === "projects" ? "체계도 조직" : "조직"}</span>
          {canManageDepts && (
            <button type="button" className="btn-ghost btn-sm text-primary"
              onClick={() => setDeptEdit("new")} title={dept ? `${dept.name} 아래에 부서 추가` : "부서 추가"}>
              <Icon name="plus" className="size-3.5" /> 부서 추가
            </button>
          )}
          {orgLink && <Link href="/org" className="btn-ghost btn-sm text-primary" title="부서·조직장 수정은 조직도에서">조직 수정 ›</Link>}
        </div>
        <div className="relative mb-2">
          <Icon name="find" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input className="input pl-9" placeholder={mode === "projects" ? "프로젝트 검색" : "이름·직급·부서 검색"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색" />
        </div>
        {mode === "projects" && canManageProjects && (
          <label className="mb-1 flex min-h-10 items-center gap-2 px-1 text-sm text-fg-muted sm:min-h-8">
            <input type="checkbox" checked={showAllEps} onChange={(e) => setShowAllEps(e.target.checked)} /> 체계도 미사용 조직도 보기
          </label>
        )}
        <div className="lg:max-h-[calc(100dvh-15rem)] lg:overflow-y-auto">
          <TreeView nodes={treeNodes} selectedId={query ? null : selected} query={mode === "projects" ? q : ""} empty="등록된 조직이 없습니다."
            onSelect={(n) => {
              if (n.id.startsWith("p:")) {
                const proj = projectById.get(n.id.slice(2));
                if (proj?.departmentId) pick(proj.departmentId);
              } else pick(n.id);
              if (mode === "people") setQ("");
            }} />
        </div>
      </aside>

      <section className={`min-w-0 lg:block ${listStep ? "" : "hidden"}`}>
        {/* 모바일: 조직 고르기로 돌아가기 */}
        <button type="button" className="btn-ghost btn-sm -ml-2 mb-2 lg:hidden" onClick={() => { setStep("tree"); setQ(""); }}>
          <Icon name="prev" className="size-4" /> 조직 고르기
        </button>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs text-fg-muted">{query ? "검색 결과" : dept?.path.split(" > ").slice(0, -1).join(" › ")}</p>
            <h2 className="text-title font-bold">{query ? `“${q.trim()}”` : dept?.name ?? "조직도"}</h2>
            {!query && dept && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
                <span>조직장 · <b className="text-fg">{dept.headName ?? "미지정"}</b></span>
                {canManageDepts && (
                  <>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setDeptEdit("edit")}>부서 수정 · 조직장 지정</button>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setDeptEdit("new")}>+ 하위 부서</button>
                  </>
                )}
              </div>
            )}
            {!query && dept && mode === "projects" && !dept.epsEnabled && (
              <p className="mt-1 text-xs text-fg-muted">묶음 조직입니다. 프로젝트는 하위 조직에 둡니다.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {!query && (
              <label className="flex min-h-10 items-center gap-2 text-fg-muted sm:min-h-9">
                <input type="checkbox" checked={withSub} onChange={(e) => { setWithSub(e.target.checked); setLimit(pageSize); }} /> 하위 조직 포함
              </label>
            )}
            {canManage && tab === "people" && (
              <>
                <label className="flex min-h-10 items-center gap-2 text-fg-muted sm:min-h-9">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> 비활성 포함
                </label>
                <button className="btn-primary" onClick={() => setEditing("new")}><Icon name="plus" /> 임직원 추가</button>
              </>
            )}
            {canCreateHere && !creating && (
              <button className="btn-primary" disabled={loader.busy} onClick={openCreate}><Icon name="plus" /> 이 조직에 프로젝트</button>
            )}
          </div>
        </div>

        <p className="mb-3 text-sm text-fg-muted">
          {mode === "projects" ? `프로젝트 ${projectList.length}개` : `임직원 ${list.length}명`}{!query && withSub ? " (하위 조직 포함)" : ""}
        </p>

        {notice && (
          <div className="alert alert-ok mb-3 flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setNotice(null)}>닫기</button>
          </div>
        )}
        {!creating && created.view && <div className="mb-3">{created.view}</div>}
        {!creating && loader.view && <div className="mb-3">{loader.view}</div>}

        {creating && createData && dept && (
          <div className="mb-4">
            <CreateProject key={dept.id} projects={createData.projects} users={createData.users} depts={createData.depts} categories={createData.categories}
              run={created} initialDeptId={dept.id}
              onClose={(done) => { if (!done) created.setMsg(null); setCreating(false); }} />
          </div>
        )}

        {tab === "people" ? (
          list.length === 0 ? (
            <Empty card icon={query ? "search" : "people"}>{query ? "검색 결과가 없습니다." : withSub ? "이 조직에 등록된 임직원이 없습니다." : "이 조직에 직접 소속된 임직원이 없습니다. ‘하위 조직 포함’을 켜 보세요."}</Empty>
          ) : (
            <div className="space-y-5">
              {groupByPosition(list.slice(0, limit)).map((g, gi) => (
                <section key={`${g.position}-${gi}`}>
                  <h3 className="section-title mb-2 flex items-center gap-2">
                    <span className={`size-2 rounded-full ${TIER_STYLE[g.tier].dot}`} />
                    {g.position}
                    <span className="font-normal text-fg-muted">{g.people.length}명</span>
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {g.people.map((p) => (
                      <button key={p.id} type="button" disabled={!canManage} onClick={() => canManage && setEditing(p)}
                        className={`card flex min-w-0 items-start gap-3 p-4 text-left transition ${canManage ? "hover:ring-2 hover:ring-brand-100" : "cursor-default"} ${p.active ? "" : "opacity-60"}`}>
                        <Avatar name={p.name} inactive={!p.active} tier={positionTier(p.position)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-base font-bold sm:text-sm">{p.name}</span>
                            {p.position && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${TIER_STYLE[positionTier(p.position)].chip}`}>{p.position}</span>}
                            {(() => {
                              const r = nonDefaultRole({ role: p.role, position: p.position, deptName: deptName(p.departmentId) });
                              return r && <span title="기본(팀원·재무회계팀) 외 서비스 권한" className={`rounded px-1.5 py-0.5 text-xs font-bold ${ROLE_STYLE[r]}`}>{ROLE_LABEL[r]}</span>;
                            })()}
                            {!p.active && <span className="badge badge-neutral">비활성</span>}
                          </div>
                          {(query || withSub || p.joinDate) && (
                            <div className="truncate text-xs text-fg-muted">
                              {[(query || withSub) && deptName(p.departmentId), p.joinDate && `입사 ${dotDate(p.joinDate)}`].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          {p.projects.length > 0 && (
                            <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                              {/* 긴 프로젝트 이름은 카드 너비에서 말줄임 (전체 이름은 title) */}
                              {p.projects.map((pr) => (
                                <span key={pr.name} title={`${pr.isPm ? "PM · " : ""}${pr.name}`}
                                  className={`badge min-w-0 max-w-full shrink rounded-full px-2 ${pr.isPm ? "badge-primary" : "badge-neutral font-medium"}`}>
                                  {pr.isPm && <span className="shrink-0">PM ·</span>}
                                  <span className="min-w-0 truncate">{pr.name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              <MoreButton shown={Math.min(limit, total)} total={total} onMore={() => setLimit(limit + pageSize)} unit="명" />
            </div>
          )
        ) : projectList.length === 0 ? (
          <Empty card icon={query ? "search" : "project"}
            action={canCreateHere && !creating ? <button className="btn-primary" disabled={loader.busy} onClick={openCreate}><Icon name="plus" /> 이 조직에 프로젝트 만들기</button> : undefined}>
            {query ? "검색 결과가 없습니다." : "이 조직에 속한 프로젝트가 없습니다."}
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {projectList.slice(0, limit).map((p) => (
                <ProjectCard key={p.id} p={p} depts={allDepts} parentName={(p.parentId && projectById.get(p.parentId)?.name) || null}
                  deptName={deptName} canMove={canManageProjects}
                  onMoved={(text) => { setNotice(text); }} />
              ))}
            </div>
            <MoreButton shown={Math.min(limit, total)} total={total} onMore={() => setLimit(limit + pageSize)} unit="개" />
          </>
        )}

        {canManage && tab === "people" && unassigned.length > 0 && !query && (
          <p className="mt-4 text-xs text-fg-muted">
            부서 미지정 {unassigned.length}명 — 검색해서 부서를 지정하세요: {unassigned.slice(0, 8).map((p) => p.name).join(", ")}{unassigned.length > 8 ? " …" : ""}
          </p>
        )}
      </section>

      {editing && (
        <PersonEditor person={editing === "new" ? null : editing} depts={depts} defaultDept={selected}
          onClose={() => setEditing(null)}
          onTemp={(t) => setTemps([t])}
          onSaved={(text) => { setEditing(null); setNotice(text); }} />
      )}
      <TempPasswordDialog items={temps} onClose={() => setTemps([])} />
      {deptEdit && (
        <DeptEditor mode={deptEdit} dept={deptEdit === "edit" ? dept ?? null : null} depts={depts} people={people} parentId={selected} deptName={deptName}
          onClose={() => setDeptEdit(null)}
          onSaved={(text) => { setDeptEdit(null); setNotice(text); }} />
      )}
    </div>
  );
}

/** 목록 더 보기 */
function MoreButton({ shown, total, onMore, unit }: { shown: number; total: number; onMore: () => void; unit: string }) {
  if (shown >= total) return null;
  return (
    <div className="mt-4 text-center">
      <button type="button" className="btn-secondary" onClick={onMore}>
        더 보기 <span className="tabular text-xs text-fg-muted">{shown}/{total}{unit}</span>
      </button>
    </div>
  );
}

function ProjectCard({ p, depts, deptName, parentName, canMove, onMoved }: {
  p: OrgProject; depts: OrgDept[]; deptName: (id: string | null) => string; parentName: string | null; canMove: boolean; onMoved: (text: string) => void;
}) {
  // 소속 조직 선택은 제어 컴포넌트 — 옮기기에 실패하면 원래 조직으로 되돌린다
  const [deptId, setDeptId] = useState(p.departmentId ?? "");
  const [savedDeptId, setSavedDeptId] = useState(p.departmentId ?? "");
  if ((p.departmentId ?? "") !== savedDeptId) { setSavedDeptId(p.departmentId ?? ""); setDeptId(p.departmentId ?? ""); }
  // 소속 조직 선택은 "조직 옮기기"를 눌렀을 때만 (평소에는 카드가 조회 정보만 보이게)
  const [moveOpen, setMoveOpen] = useState(false);
  const { act, busy: moving, view } = useRun();
  const rate = p.planned ? Math.round(((p.spent ?? 0) / p.planned) * 1000) / 10 : null;
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-start gap-1.5 text-title font-bold"><NodeIcon icon={parentName ? "subproject" : "project"} />{p.name}</div>
          <div className="mt-0.5 text-sm text-fg-muted">
            {p.code ? <span className="tabular">{p.code} · </span> : null}{deptName(p.departmentId)}{parentName ? ` · 상위: ${parentName}` : ""} · {p.dates}
          </div>
          <div className="mt-0.5 text-sm text-fg-muted">PM {p.pms.join(", ") || "미지정"} · 팀원 {p.memberCount}명</div>
        </div>
        {p.accessible && <OpenProjectButton projectId={p.id} name={p.name} href="/dashboard" label="열기" />}
      </div>
      {p.accessible && p.planned === 0 && <p className="mt-2 text-xs text-fg-muted">예산 미등록</p>}
      {p.accessible && !!p.planned && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-fg-muted">
            <span className="tabular">배정 {won(p.planned)}원 중 {won(p.spent ?? 0)}원 집행</span>
            <span className={rate !== null && rate > 100 ? "font-bold text-status-rejected" : ""}>{rate === null ? "-" : `${rate}%`}</span>
          </div>
          <Meter rate={rate} className="mt-1" />
        </div>
      )}
      {canMove && !moveOpen && (
        <div className="mt-2 -ml-2"><button type="button" className="btn-ghost btn-sm" onClick={() => setMoveOpen(true)}>조직 옮기기</button></div>
      )}
      {canMove && moveOpen && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <span className="shrink-0 text-xs text-fg-muted">소속 조직</span>
          <DeptSelect depts={depts} value={deptId} empty={null} epsOnly className="input py-1.5" label="소속 조직" disabled={moving}
            onChange={async (next) => {
              const prev = deptId;
              setDeptId(next);
              const ok = await act(() => api(`/api/projects/${p.id}`, { method: "PATCH", json: { departmentId: next } }));
              if (ok) { onMoved(`${p.name} 프로젝트를 ${deptName(next)} 조직으로 옮겼습니다.`); setMoveOpen(false); }
              else setDeptId(prev);
            }} />
          <button type="button" className="btn-ghost btn-sm" disabled={moving} onClick={() => setMoveOpen(false)}>취소</button>
        </div>
      )}
      {view && <p className="mt-2 text-xs">{view}</p>}
    </div>
  );
}

function PersonEditor({ person, depts, defaultDept, onClose, onSaved, onTemp }: {
  person: OrgPerson | null; depts: OrgDept[]; defaultDept: string; onClose: () => void; onSaved: (text: string) => void; onTemp: (t: TempPassword) => void;
}) {
  const [v, setV] = useState(() => userValues(person, defaultDept));
  const { run, busy, view } = useRun();

  async function save() {
    if (person) {
      const r = await run(() => api(`/api/admin/users/${person.id}`, { method: "PATCH", json: userPayload(v) }));
      if (r) onSaved(`${v.name}님 정보를 저장했습니다.`);
    } else {
      const r = await run(() => api<{ tempPassword: string }>("/api/admin/users", { method: "POST", json: userPayload(v) }));
      if (r) {
        onTemp({ name: v.name, loginId: v.loginId.trim().toLowerCase(), tempPassword: r.tempPassword });
        onSaved(`${v.name}님을 추가했습니다.`);
      }
    }
  }

  async function onAction(a: AccountAction) {
    if (!person) return;
    const r = await run(() => api<UserPatchResult>(`/api/admin/users/${person.id}`, { method: "PATCH", json: accountActionPayload(a, person.active) }));
    if (!r) return;
    if (a === "resetPassword") {
      if (r.tempPassword) onTemp({ name: person.name, loginId: person.loginId ?? v.loginId, tempPassword: r.tempPassword, expiresAt: r.user?.tempPasswordExpiresAt ?? null });
      onSaved(`${person.name}님 임시 비밀번호를 발급했습니다.`);
    } else if (a === "unlock") onSaved(`${person.name}님 로그인 잠금을 해제했습니다.`);
    else onSaved(person.active ? `${person.name}님을 비활성화했습니다. 즉시 로그아웃됩니다.` : `${person.name}님을 다시 활성화했습니다.`);
  }

  return (
    <Sheet title={person ? `${person.name} 정보` : "임직원 추가"} onClose={onClose}>
      {person?.external && (
        <p className="alert alert-info mb-3 text-sm">Soliday 연동 임직원입니다. 이름·부서·직급·입사일은 다음 연동 때 Soliday 기준으로 덮어씁니다.</p>
      )}
      <UserFields value={v} onChange={setV} depts={depts} />

      {view && <p className="mt-3">{view}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button className="btn-primary flex-1 py-2.5" disabled={busy || !v.name.trim() || !v.loginId.trim()} onClick={save}>
          {person ? "저장" : "추가하고 임시 비밀번호 발급"}
        </button>
      </div>

      {person && <UserAccountActions user={person} busy={busy} onAction={onAction} className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4" />}
    </Sheet>
  );
}

function DeptEditor({ mode, dept, depts, people, parentId, deptName, onClose, onSaved }: {
  mode: "new" | "edit"; dept: OrgDept | null; depts: OrgDept[]; people: OrgPerson[]; parentId: string; deptName: (id: string | null) => string;
  onClose: () => void; onSaved: (text: string) => void;
}) {
  const [v, setV] = useState<DeptValues>({ name: dept?.name ?? "", code: dept?.code ?? "", parentId: mode === "new" ? parentId : dept?.parentId ?? "", epsEnabled: dept?.epsEnabled ?? true });
  const [headId, setHeadId] = useState(dept?.headId ?? "");
  const { act, busy, view } = useRun();
  const { confirm, dialog } = useConfirm();
  // 조직장 후보: 이 조직 소속(직급 → 성명 순), 필요하면 하위 조직까지. 현재 조직장은 다른 조직이어도 남겨 둔다
  const [headFromSub, setHeadFromSub] = useState(false);
  const headCandidates = useMemo(() => {
    if (!dept) return [];
    const ids = headFromSub ? descendantIds(depts, dept.id) : new Set([dept.id]);
    const list = people.filter((p) => p.active && p.departmentId && ids.has(p.departmentId));
    const current = people.find((p) => p.id === dept.headId);
    return current && !list.includes(current) ? [current, ...list] : list;
  }, [dept, depts, people, headFromSub]);
  return (
    <Sheet title={mode === "new" ? "부서 추가" : `${dept?.name} 수정`} onClose={onClose}>
      <DeptFields value={v} onChange={setV} depts={depts} selfId={dept?.id}>
        {mode === "edit" && dept && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="label">조직장 — 이 조직과 하위 조직의 프로젝트를 조회·취합</span>
              <label className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                <input type="checkbox" checked={headFromSub} onChange={(e) => setHeadFromSub(e.target.checked)} /> 하위 조직 포함
              </label>
            </div>
            <select className="input" value={headId} aria-label="조직장" onChange={(e) => setHeadId(e.target.value)}>
              <option value="">미지정</option>
              {headCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.position ?? ""}{p.departmentId !== dept.id ? ` · ${deptName(p.departmentId)}` : ""}
                </option>
              ))}
            </select>
            {headCandidates.length === 0 && (
              <p className="mt-1 text-xs text-fg-subtle">이 조직에 소속된 임직원이 없습니다. 하위 조직 포함을 켜 보세요.</p>
            )}
          </div>
        )}
      </DeptFields>
      {view && <p className="mt-3">{view}</p>}
      {dialog}
      <div className="mt-5 flex flex-wrap gap-2">
        {mode === "edit" && dept && (
          <button className="btn-secondary text-status-rejected" disabled={busy}
            onClick={async () => {
              if (!(await confirmDeptToggle(dept, confirm))) return;
              const ok = await act(() => api(`/api/admin/departments/${dept.id}`, { method: "PATCH", json: { active: !dept.active } }));
              if (ok) onSaved(dept.active ? `${dept.name} 부서 사용을 중지했습니다.` : `${dept.name} 부서를 다시 사용합니다.`);
            }}>{dept.active ? "부서 사용 중지" : "다시 사용"}</button>
        )}
        <button className="btn-primary flex-1 py-2.5" disabled={busy || !v.name.trim()}
          onClick={async () => {
            const json = { ...deptPayload(v), ...(mode === "edit" ? { headId: headId || null } : {}) };
            const ok = await act(() => mode === "new"
              ? api("/api/admin/departments", { method: "POST", json })
              : api(`/api/admin/departments/${dept!.id}`, { method: "PATCH", json }));
            if (ok) onSaved(mode === "new" ? `${v.name} 부서를 추가했습니다.` : `${v.name} 부서를 저장했습니다.`);
          }}>{mode === "new" ? "추가" : "저장"}</button>
      </div>
    </Sheet>
  );
}
