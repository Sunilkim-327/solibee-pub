import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common";
import { OrgChart } from "@/components/OrgChart";
import { OrgPanel, UsersPanel } from "@/components/AdminDirectory";
import { homePath, isHqLike, myProfile, requireUser } from "@/lib/access";
import { withNotice } from "@/lib/page-access";
import { getOrgChart } from "@/lib/orgchart";
import { loadAdminUsers, loadDepartments } from "../master/data";

const TABS = [["chart", "조직도"], ["users", "사용자 · 로그인"], ["sync", "연동 · 부서"]] as const;
type Tab = (typeof TABS)[number][0];

/**
 * 조직도(OBS) — 회사 조직 아래 임직원.
 * 시스템 관리자는 조직·사람 관리를 여기서 모두 한다: 임직원 카드(정보·권한·계정), 사용자·로그인(임시 비밀번호 일괄·CSV 등록), Soliday 연동·부서.
 */
export default async function OrgPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // 프로젝트와 무관한 화면 — 프로젝트가 없어도 열림 (회사 권한 기준)
  const user = await requireUser();
  // 조직도·체계도는 재무 승인·시스템 관리자 화면 (팀원·PM에게는 필요 없음)
  if (!isHqLike(user)) redirect(withNotice(await homePath(user), "role"));
  const canManage = user.role === "ADMIN";
  const canManageProjects = isHqLike(user);
  const raw = (await searchParams).tab;
  const tab: Tab = canManage && TABS.some(([k]) => k === raw) ? (raw as Tab) : "chart";

  return (
    <div>
      <PageHeader title="조직도"
        desc={canManage ? "조직·임직원·계정을 관리합니다. 임직원 카드를 누르면 정보·권한·계정을 바꿀 수 있습니다." : "조직별 임직원을 확인합니다."} />
      {canManage && (
        <nav className="seg mb-5 w-full sm:w-auto" aria-label="조직도 관리">
          {TABS.map(([k, label]) => (
            <Link key={k} href={k === "chart" ? "/org" : `/org?tab=${k}`} aria-current={tab === k ? "page" : undefined} className="flex-1 px-4 sm:flex-none">
              {label}
            </Link>
          ))}
        </nav>
      )}
      {tab === "chart" && <Chart userId={user.id} canManage={canManage} canManageProjects={canManageProjects} user={user} />}
      {tab === "users" && <UsersTab />}
      {tab === "sync" && <SyncTab />}
    </div>
  );
}

async function Chart({ user, userId, canManage, canManageProjects }: { user: Awaited<ReturnType<typeof requireUser>>; userId: string; canManage: boolean; canManageProjects: boolean }) {
  const [{ depts, people, projects }, me] = await Promise.all([
    getOrgChart(user, { includeInactive: canManage, withLoginId: canManage }),
    myProfile({ id: userId }),
  ]);
  return <OrgChart mode="people" depts={depts} people={people} projects={projects} canManage={canManage} canManageProjects={canManageProjects}
    initialDeptId={me?.departmentId ?? null} />;
}

async function UsersTab() {
  const [users, depts] = await Promise.all([loadAdminUsers(), loadDepartments()]);
  return <UsersPanel users={users} depts={depts} />;
}

async function SyncTab() {
  const [users, depts] = await Promise.all([loadAdminUsers(), loadDepartments()]);
  return <OrgPanel users={users} depts={depts} />;
}
