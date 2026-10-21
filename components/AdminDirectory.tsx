"use client";

// 시스템 관리자: 조직도(임시 자체 관리) · 사용자 계정 관리. 회사 조직도/SSO 연동 시 code·사번·externalId로 매핑한다.
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { buildTree, flattenTree } from "@/lib/org";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/types";
import { DirectorySync } from "./DirectorySync";
import { Empty } from "./common";
import { Sheet } from "./Sheet";
import { NodeIcon, TreeGuide } from "./Tree";
import { TempPasswordDialog, type TempPassword } from "./TempPasswordDialog";
import { useRun, type RunColors } from "./hooks/useRun";
import { useConfirm } from "./ConfirmDialog";
import { DeptSelect, type Dept } from "./admin/DeptSelect";
import { DeptFields, confirmDeptToggle, deptPayload, type DeptValues } from "./admin/DeptForm";
import { UserAccountActions, UserFields, accountActionPayload, userPayload, userValues, type AccountAction, type UserPatchResult } from "./admin/UserForm";
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_LABEL, BULK_RESET_MAX, accountStatus, filterUsers, type AccountStatus } from "@/lib/user-admin";
import { dotDate, kstDateTime, shortDateTime } from "@/lib/format";
import { Icon } from "./icons";
import { ListToolbar, SearchInput } from "./list/ListToolbar";

export type { Dept };
export { DeptSelect };
export type AdminUser = {
  id: string;
  name: string;
  loginId: string | null;
  role: Role;
  employeeNo: string | null;
  position: string | null;
  joinDate: string | null;
  departmentId: string | null;
  active: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  tempPasswordExpiresAt: string | null;
};

/** 조직·사용자 관리 화면의 메시지 색 */
const ADMIN_COLORS: RunColors = { ok: "text-emerald-700", error: "text-rose-600" };

// ── 조직도 ─────────────────────────────────────────
function DeptRow({ d, depth, depts, userCount, last, hasKids, collapsed, onToggle }: {
  d: Dept; depth: number; depts: Dept[]; userCount: number; last: boolean; hasKids: boolean; collapsed: boolean; onToggle: () => void;
}) {
  const init: DeptValues = { name: d.name, code: d.code ?? "", parentId: d.parentId ?? "", order: String(d.order) };
  const [v, setV] = useState(init);
  const [edit, setEdit] = useState(false);
  const { run, act, busy, view } = useRun(ADMIN_COLORS);
  const { confirm, dialog } = useConfirm();
  const dirty = v.name !== init.name || v.code !== init.code || v.parentId !== init.parentId || v.order !== init.order;
  return (
    <li>
      <div className={`flex min-h-12 items-stretch pr-2 pl-2 sm:pr-3 sm:pl-3 ${d.active ? "" : "opacity-60"} ${edit ? "bg-brand-50/40" : ""}`}>
        <TreeGuide depth={depth} last={last} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5">
          <button type="button" aria-label={collapsed ? `${d.name} 펼치기` : `${d.name} 접기`} onClick={onToggle} aria-expanded={hasKids ? !collapsed : undefined}
            className={`flex size-8 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg ${hasKids ? "" : "invisible"}`}>
            <Icon name="chevron" className={`size-3.5 transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`} />
          </button>
          <NodeIcon icon={depth === 0 ? "company" : "org"} />
          <span className="min-w-0 truncate text-sm font-medium">{d.name}</span>
          {d.code && <span className="badge badge-neutral hidden font-medium sm:inline-flex">{d.code}</span>}
          {!d.active && <span className="badge badge-warn">사용 중지</span>}
          <span className="tabular ml-auto shrink-0 pl-2 text-xs text-fg-muted">{userCount}명</span>
          <button type="button" onClick={() => { setEdit(!edit); setV(init); }} aria-expanded={edit} aria-label={`${d.name} 수정`} title="수정"
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg transition sm:size-9 ${edit ? "bg-brand-50 text-primary" : "text-fg-subtle hover:bg-surface-muted hover:text-fg"}`}>
            <Icon name="pencil" />
          </button>
        </div>
      </div>
      {edit && (
        <div className="space-y-3 border-t border-line bg-surface-muted/40 px-4 py-4">
          <DeptFields value={v} onChange={setV} depts={depts} selfId={d.id}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_6rem]" />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary" disabled={busy}
              onClick={async () => (await confirmDeptToggle(d, confirm)) && run(() => api(`/api/admin/departments/${d.id}`, { method: "PATCH", json: { active: !d.active } }), d.active ? "사용 중지" : "사용")}>
              {d.active ? "사용 중지" : "다시 사용"}
            </button>
            {view}
            {dialog}
            <span className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={() => { setEdit(false); setV(init); }}>취소</button>
              <button className="btn-primary" disabled={!dirty || busy || !v.name.trim()}
                onClick={async () => {
                  const ok = await act(() => api(`/api/admin/departments/${d.id}`, { method: "PATCH", json: deptPayload(v) }), "저장됨");
                  if (ok) setEdit(false);
                }}>저장</button>
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

export function OrgPanel({ depts, users }: { depts: Dept[]; users: AdminUser[] }) {
  const tree = useMemo(() => flattenTree(buildTree(depts)), [depts]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(tree.filter((d) => d.depth >= 1).map((d) => d.id)));
  const [find, setFind] = useState("");
  const parentOf = useMemo(() => new Map(depts.map((d) => [d.id, d.parentId])), [depts]);
  // 행마다 목록을 다시 훑지 않도록 미리 계산: 하위 부서 유무 · 형제 중 마지막 · 활성 인원 수
  const { withKids, lastIds } = useMemo(() => {
    const withKids = new Set<string>();
    const lastOf = new Map<string | null, string>();
    for (const d of tree) {
      if (d.parentId) withKids.add(d.parentId);
      lastOf.set(d.parentId, d.id);
    }
    return { withKids, lastIds: new Set(lastOf.values()) };
  }, [tree]);
  const activeCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of users) if (u.active && u.departmentId) m.set(u.departmentId, (m.get(u.departmentId) ?? 0) + 1);
    return m;
  }, [users]);
  const hasKids = (id: string) => withKids.has(id);
  const hiddenByCollapse = (id: string) => {
    let cur = parentOf.get(id) ?? null;
    while (cur) { if (collapsed.has(cur)) return true; cur = parentOf.get(cur) ?? null; }
    return false;
  };
  // 검색 시: 일치 부서와 상위 경로만, 모두 펼친 상태로
  const q = find.trim().toLowerCase();
  const matchPath = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>();
    for (const d of depts) {
      if (!d.name.toLowerCase().includes(q) && !(d.code ?? "").toLowerCase().includes(q)) continue;
      let cur: string | null = d.id;
      while (cur && !keep.has(cur)) { keep.add(cur); cur = parentOf.get(cur) ?? null; }
    }
    return keep;
  }, [q, depts, parentOf]);
  const rows = tree.filter((d) => (matchPath ? matchPath.has(d.id) : !hiddenByCollapse(d.id)));
  const [form, setForm] = useState({ name: "", code: "", parentId: "" });
  const add = useRun(ADMIN_COLORS);
  return (
    <div className="space-y-5">
      <DirectorySync />
      <section className="card">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
          <h3 className="section-title">부서 <span className="tabular text-sm font-medium text-fg-muted">{depts.length}</span></h3>
          <div className="flex w-full items-center gap-1 sm:ml-auto sm:w-auto">
            <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
              <SearchInput placeholder="부서명·부서코드 검색" aria-label="부서 검색" value={find} onChange={(e) => setFind(e.target.value)} />
            </div>
            <button className="btn-ghost btn-sm min-h-10 sm:min-h-8" onClick={() => setCollapsed(new Set())}>펼치기</button>
            <button className="btn-ghost btn-sm min-h-10 sm:min-h-8" onClick={() => setCollapsed(new Set(withKids))}>접기</button>
          </div>
        </header>
        {tree.length === 0 ? <Empty>등록된 부서가 없습니다.</Empty>
          : rows.length === 0 ? <Empty>검색 결과가 없습니다.</Empty> : (
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <DeptRow key={d.id} d={d} depth={d.depth} depts={depts} last={lastIds.has(d.id)} hasKids={hasKids(d.id)}
                  collapsed={!matchPath && collapsed.has(d.id)}
                  onToggle={() => setCollapsed((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}
                  userCount={activeCount.get(d.id) ?? 0} />
              ))}
            </ul>
          )}
        <div className="rounded-b-xl border-t border-line bg-surface-muted/40 px-4 py-4 sm:px-5">
          <h4 className="mb-2 text-sm font-bold">부서 추가</h4>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
            <input className="input" placeholder="부서명" aria-label="부서명" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="부서코드 (선택)" aria-label="부서코드" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <DeptSelect depts={depts} value={form.parentId} onChange={(parentId) => setForm({ ...form, parentId })} empty="(최상위)" label="상위 부서" />
            <button className="btn-primary" disabled={add.busy || !form.name.trim()}
              onClick={async () => (await add.act(() => api("/api/admin/departments", { method: "POST", json: deptPayload(form) }), "추가됨"))
                && setForm({ name: "", code: "", parentId: form.parentId })}>추가</button>
          </div>
          {add.view && <div className="mt-2">{add.view}</div>}
        </div>
      </section>
    </div>
  );
}

// ── 사용자 ─────────────────────────────────────────
const STATUS_BADGE: Record<AccountStatus, string> = {
  INACTIVE: "badge-neutral",
  LOCKED: "badge-bad",
  NOT_ISSUED: "bg-sky-100 text-sky-800",
  TEMP: "badge-warn",
  TEMP_EXPIRED: "badge-warn",
  IN_USE: "badge-ok",
};

function AccountBadge({ u }: { u: AdminUser }) {
  const s = accountStatus(u);
  if (s === "IN_USE") {
    return <span className="text-xs text-fg-muted">{u.lastLoginAt ? `최근 ${kstDateTime(u.lastLoginAt).slice(0, 10)}` : "미접속"}</span>;
  }
  const title = s === "NOT_ISSUED" ? "임시 비밀번호를 발급해야 로그인할 수 있습니다"
    : s === "TEMP" && u.tempPasswordExpiresAt ? `${kstDateTime(u.tempPasswordExpiresAt)}까지 유효`
    : s === "TEMP_EXPIRED" ? "임시 비밀번호가 만료되었습니다. 다시 발급하세요" : undefined;
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className={`badge ${STATUS_BADGE[s]}`}>{ACCOUNT_STATUS_LABEL[s]}</span>
      {s === "TEMP" && u.tempPasswordExpiresAt && <span className="tabular text-xs text-fg-muted">~{shortDateTime(u.tempPasswordExpiresAt)}</span>}
    </span>
  );
}

const ACTION_OK: Record<AccountAction, (active: boolean) => string> = {
  resetPassword: () => "임시 비밀번호 발급",
  unlock: () => "잠금 해제",
  toggleActive: (active) => (active ? "비활성화" : "활성화"),
};

/** 사용자 한 명 관리 — 정보 수정 · 로그인(임시 비밀번호·잠금) · 계정 활성 */
function UserSheet({ u, depts, onTemp, onClose }: { u: AdminUser; depts: Dept[]; onTemp: (t: TempPassword[]) => void; onClose: () => void }) {
  const [v, setV] = useState(() => userValues(u));
  const { run, busy, view } = useRun(ADMIN_COLORS);
  const locked = !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
  const patch = (json: Record<string, unknown>, ok: string) =>
    run(() => api<UserPatchResult>(`/api/admin/users/${u.id}`, { method: "PATCH", json }), ok);

  async function onAction(a: AccountAction) {
    const r = await patch(accountActionPayload(a, u.active), ACTION_OK[a](u.active));
    if (a === "resetPassword" && r?.tempPassword) {
      onTemp([{ name: u.name, loginId: u.loginId ?? "", tempPassword: r.tempPassword, expiresAt: r.user?.tempPasswordExpiresAt ?? null }]);
      onClose();
    }
  }

  return (
    <Sheet title={`${u.name} 계정`} onClose={onClose}>
      <div className="space-y-5">
        <UserFields value={v} onChange={setV} depts={depts} />
        <button className="btn-primary w-full" disabled={busy} onClick={() => patch(userPayload(v), "저장됨")}>저장</button>

        <div className="rounded-xl border border-line">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="text-sm font-bold">로그인</span>
            <span className="ml-auto"><AccountBadge u={u} /></span>
          </div>
          <UserAccountActions user={u} locked={locked} busy={busy} onAction={onAction} className="flex flex-wrap gap-2 px-4 py-3" />
        </div>
        {view && <div>{view}</div>}
      </div>
    </Sheet>
  );
}

const CSV_SAMPLE = "이름,아이디,사번,부서,직급,역할\n홍길동,hong@example.com,E2026101,플랫폼사업팀,선임,팀원";
const PAGE = 100;

export function UsersPanel({ users, depts }: { users: AdminUser[]; depts: Dept[] }) {
  const [temps, setTemps] = useState<TempPassword[]>([]);
  const [q, setQ] = useState("");
  const [deptId, setDeptId] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<AccountStatus | "">("");
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const bulk = useRun(ADMIN_COLORS);
  const { confirm, alert, dialog } = useConfirm();

  // users는 서버에서 직급 → 성명 순으로 정렬되어 온다
  const list = useMemo(
    () => filterUsers(users, depts, { q, deptId, role, status, includeInactive: showInactive }),
    [users, depts, q, deptId, role, status, showInactive],
  );
  const shown = list.slice(0, limit);
  const deptName = useMemo(() => new Map(depts.map((d) => [d.id, d.name])), [depts]);
  // 선택은 조건에 맞는 활성 사용자 기준
  const selectable = list.filter((u) => u.active);
  const picked = selectable.filter((u) => selected.has(u.id));
  const allPicked = selectable.length > 0 && picked.length === selectable.length;
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const toggleAll = (on: boolean) => setSelected((s) => { const n = new Set(s); for (const u of selectable) if (on) n.add(u.id); else n.delete(u.id); return n; });
  const filtered = !!(q || deptId || role || status);
  const editing = editId ? users.find((u) => u.id === editId) : undefined;
  const resetLimit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setLimit(PAGE); };

  async function issueBulk() {
    if (!picked.length) return;
    if (picked.length > BULK_RESET_MAX) {
      await alert({ message: `한 번에 최대 ${BULK_RESET_MAX}명까지 발급할 수 있습니다. 필터로 나눠서 발급하세요.` });
      return;
    }
    if (!(await confirm({ message: `선택한 ${picked.length}명에게 임시 비밀번호를 발급할까요?\n기존 비밀번호는 사용할 수 없게 되고, 24시간 안에 로그인해 변경해야 합니다.`, confirmLabel: "발급" }))) return;
    const r = await bulk.run(() => api<{ id: string; name: string; loginId: string; tempPassword: string; expiresAt: string }[]>(
      "/api/admin/users/reset-bulk", { method: "POST", json: { userIds: picked.map((u) => u.id) } }), "임시 비밀번호 발급");
    if (r) {
      setTemps(r.map((x) => ({ name: x.name, loginId: x.loginId, tempPassword: x.tempPassword, expiresAt: x.expiresAt })));
      setSelected(new Set());
    }
  }

  return (
    <div className="space-y-5">
      <TempPasswordDialog items={temps} onClose={() => setTemps([])} />
      {dialog}
      {editing && <UserSheet key={editing.id} u={editing} depts={depts} onTemp={setTemps} onClose={() => setEditId(null)} />}

      {/* 필터 — 목록 공통 도구 줄 (검색 오른쪽, 선택 필터 왼쪽) */}
      <ListToolbar label="사용자 목록 도구" className="mb-0"
        filters={<>
          <DeptSelect depts={depts} value={deptId} onChange={resetLimit(setDeptId)} empty="전체 부서 (하위 포함)" label="부서" className="w-full sm:w-56" />
          <select className="input w-auto" value={role} onChange={(e) => resetLimit(setRole)(e.target.value)} aria-label="역할">
            <option value="">전체 역할</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <select className="input w-auto" value={status} onChange={(e) => resetLimit(setStatus)(e.target.value as AccountStatus | "")} aria-label="상태">
            <option value="">전체 상태</option>
            {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{ACCOUNT_STATUS_LABEL[s]}</option>)}
          </select>
          <label className="flex min-h-10 cursor-pointer items-center gap-2 px-1 text-sm whitespace-nowrap text-fg-muted sm:min-h-8">
            <input type="checkbox" checked={showInactive} onChange={(e) => resetLimit(setShowInactive)(e.target.checked)} /> 비활성 포함
          </label>
        </>}
        search={<SearchInput placeholder="이름·이메일·사번 검색" aria-label="사용자 검색" value={q} onChange={(e) => resetLimit(setQ)(e.target.value)} />} />

      {/* 일괄 발급 바 */}
      {picked.length > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm shadow-sm lg:top-20">
          <span><b className="tabular">{picked.length}명</b> 선택</span>
          <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>선택 해제</button>
          {bulk.view}
          <button className="btn-primary btn-sm ml-auto" disabled={bulk.busy} onClick={issueBulk}>
            {bulk.busy ? "발급 중…" : "임시 비밀번호 발급"}
          </button>
        </div>
      )}
      {picked.length === 0 && bulk.view && <div>{bulk.view}</div>}

      {/* 목록 */}
      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
          <h3 className="section-title">사용자 <span className="tabular text-sm font-medium text-fg-muted">{list.length}명</span></h3>
          {filtered && (
            <button className="btn-ghost btn-sm" onClick={() => { setQ(""); setDeptId(""); setRole(""); setStatus(""); setLimit(PAGE); }}>필터 지우기</button>
          )}
          <label className="ml-auto flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg-muted md:hidden">
            <input type="checkbox" checked={allPicked} disabled={selectable.length === 0} onChange={(e) => toggleAll(e.target.checked)} /> 전체 선택
          </label>
        </header>

        {list.length === 0 ? <Empty>조건에 맞는 사용자가 없습니다.</Empty> : (
          <>
            {/* 모바일: 카드 목록 */}
            <ul className="divide-y divide-line md:hidden">
              {shown.map((u) => (
                <li key={u.id} className={`flex items-start gap-1 py-2 pr-3 pl-1 ${u.active ? "" : "opacity-60"} ${selected.has(u.id) && u.active ? "bg-brand-50/40" : ""}`}>
                  <label className="flex size-10 shrink-0 cursor-pointer items-center justify-center">
                    <input type="checkbox" className="size-4" aria-label={`${u.name} 선택`} checked={u.active && selected.has(u.id)} disabled={!u.active} onChange={(e) => toggle(u.id, e.target.checked)} />
                  </label>
                  <button type="button" className="min-w-0 flex-1 py-1.5 text-left" onClick={() => setEditId(u.id)}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{u.name}</span>
                      {u.position && <span className="text-xs text-fg-muted">{u.position}</span>}
                      <span className="badge badge-neutral ml-auto">{ROLE_LABEL[u.role]}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-fg-muted">{u.loginId ?? "아이디 없음"}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                      <span>{(u.departmentId && deptName.get(u.departmentId)) ?? "부서 없음"}</span>
                      {u.employeeNo && <span className="tabular">{u.employeeNo}</span>}
                      <AccountBadge u={u} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {/* 넓은 화면: 표 */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input type="checkbox" className="size-4" aria-label="전체 선택" title="전체 선택 (조건에 맞는 활성 사용자)"
                        checked={allPicked} disabled={selectable.length === 0} onChange={(e) => toggleAll(e.target.checked)} />
                    </th>
                    <th>이름</th><th>사번</th><th>부서</th><th>직급</th><th>입사일</th><th>역할</th><th>로그인</th><th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} className={`${u.active ? "" : "opacity-60"} ${selected.has(u.id) && u.active ? "bg-brand-50/40" : ""}`}>
                      <td>
                        <input type="checkbox" className="size-4" aria-label={`${u.name} 선택`} checked={u.active && selected.has(u.id)} disabled={!u.active} onChange={(e) => toggle(u.id, e.target.checked)} />
                      </td>
                      <td className="min-w-40">
                        <div className="font-medium">{u.name}</div>
                        <div className="max-w-56 truncate text-fg-muted">{u.loginId ?? "-"}</div>
                      </td>
                      <td className="tabular text-fg-muted">{u.employeeNo ?? "-"}</td>
                      <td className="max-w-44 truncate">{(u.departmentId && deptName.get(u.departmentId)) ?? "-"}</td>
                      <td className="whitespace-nowrap">{u.position ?? ""}</td>
                      <td className="tabular text-xs whitespace-nowrap text-fg-muted">{u.joinDate ? dotDate(u.joinDate) : "-"}</td>
                      <td className="whitespace-nowrap">{ROLE_LABEL[u.role]}</td>
                      <td className="whitespace-nowrap"><AccountBadge u={u} /></td>
                      <td className="text-right">
                        <button className="btn-ghost btn-sm" onClick={() => setEditId(u.id)}>관리</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > shown.length && (
              <div className="border-t border-line px-4 py-3 text-center">
                <button className="btn-secondary" onClick={() => setLimit(limit + PAGE)}>더 보기 <span className="tabular text-xs text-fg-subtle">{shown.length}/{list.length}</span></button>
              </div>
            )}
          </>
        )}
      </section>

      <AddUsers depts={depts} onTemp={setTemps} />
    </div>
  );
}

/** 사용자 추가 — 직접 입력 / CSV 일괄 등록 */
function AddUsers({ depts, onTemp }: { depts: Dept[]; onTemp: (t: TempPassword[]) => void }) {
  const [mode, setMode] = useState<"one" | "csv">("one");
  const [form, setForm] = useState({ name: "", loginId: "", employeeNo: "", position: "", departmentId: "", role: "MEMBER" as Role });
  const [csv, setCsv] = useState("");
  const [importResult, setImportResult] = useState<{ row: number; name: string; ok: boolean; message: string }[] | null>(null);
  const add = useRun(ADMIN_COLORS);
  const imp = useRun(ADMIN_COLORS);

  return (
    <section className="card">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h3 className="section-title">사용자 추가</h3>
        <div className="seg ml-auto" aria-label="추가 방법">
          <button type="button" aria-pressed={mode === "one"} onClick={() => setMode("one")}>직접 입력</button>
          <button type="button" aria-pressed={mode === "csv"} onClick={() => setMode("csv")}>CSV 일괄</button>
        </div>
      </header>

      {mode === "one" ? (
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label><span className="label">이름 *</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="lg:col-span-2"><span className="label">아이디 (이메일)</span><input className="input" type="email" value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} /></label>
            <label><span className="label">부서</span><DeptSelect depts={depts} value={form.departmentId} onChange={(departmentId) => setForm({ ...form, departmentId })} /></label>
            <label><span className="label">직급</span><input className="input" placeholder="선택" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></label>
            <label><span className="label">사번</span><input className="input" placeholder="선택" value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} /></label>
            <label><span className="label">역할</span>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select></label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-muted">추가하면 임시 비밀번호가 발급됩니다.</span>
            {add.view}
            <button className="btn-primary ml-auto" disabled={add.busy || !form.name.trim()}
              onClick={async () => {
                const r = await add.run(() => api<{ user: AdminUser; tempPassword: string }>("/api/admin/users", {
                  method: "POST", json: { ...form, employeeNo: form.employeeNo || null, position: form.position || null, departmentId: form.departmentId || null },
                }), "추가됨");
                if (r) {
                  onTemp([{ name: r.user.name, loginId: r.user.loginId ?? "", tempPassword: r.tempPassword }]);
                  setForm({ ...form, name: "", loginId: "", employeeNo: "", position: "" });
                }
              }}>추가</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <p className="text-xs leading-relaxed text-fg-muted">
            첫 줄 헤더 <code className="rounded bg-surface-muted px-1 py-0.5">이름,아이디,사번,부서,직급,역할</code> · 부서는 부서명 또는 부서코드 · 역할은 시스템 관리자/재무 승인/프로젝트 PM/팀원 · 이미 있는 아이디는 건너뜁니다.
          </p>
          <textarea className="input font-mono sm:text-xs" rows={5} placeholder={CSV_SAMPLE} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="CSV 내용" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-secondary cursor-pointer">
              CSV 파일 선택
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
            </label>
            {imp.view}
            <button className="btn-primary ml-auto" disabled={imp.busy || !csv.trim()}
              onClick={async () => {
                const r = await imp.run(() => api<{ created: number; results: { row: number; name: string; email: string; ok: boolean; message: string; tempPassword?: string }[] }>(
                  "/api/admin/users/import", { method: "POST", json: { csv } }));
                if (r) {
                  setImportResult(r.results);
                  onTemp(r.results.filter((x) => x.tempPassword).map((x) => ({ name: x.name, loginId: x.email, tempPassword: x.tempPassword! })));
                }
              }}>
              등록 실행
            </button>
          </div>
          {importResult && (
            <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line text-xs">
              {importResult.map((r) => (
                <li key={r.row} className="flex items-center gap-2 px-3 py-1.5">
                  <span className={`badge ${r.ok ? "badge-ok" : "badge-bad"}`}>{r.ok ? "등록" : "실패"}</span>
                  <span className="tabular text-fg-muted">{r.row}행</span>
                  <span className="font-medium">{r.name}</span>
                  <span className="min-w-0 truncate text-fg-muted">{r.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

