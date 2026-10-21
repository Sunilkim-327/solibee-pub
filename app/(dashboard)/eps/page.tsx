import Link from "next/link";
import { PageHeader } from "@/components/common";
import { OrgChart } from "@/components/OrgChart";
import { redirect } from "next/navigation";
import { getCurrentProject, homePath, isHqLike, myProfile, requireUser } from "@/lib/access";
import { withNotice } from "@/lib/page-access";
import { getOrgChart } from "@/lib/orgchart";

/**
 * 프로젝트 체계도 (EPS · Enterprise Project Structure)
 * 조직도가 "조직 아래 사람"이라면, 체계도는 "조직 아래 프로젝트" — 모든 프로젝트는 하나의 조직에 속한다.
 * 재무 승인·시스템 관리자는 조직을 골라 프로젝트를 만들고(기준 정보의 '새 프로젝트' 양식) 다른 조직으로 옮긴다. 조직 수정은 조직도에서.
 * 금액은 조회 권한이 있는 프로젝트만 보인다.
 */
export default async function EpsPage() {
  // 프로젝트와 무관한 화면 — 프로젝트가 없어도 열림 (회사 권한 기준)
  const user = await requireUser();
  // 조직도·체계도는 재무 승인·시스템 관리자 화면 (팀원·PM에게는 필요 없음)
  if (!isHqLike(user)) redirect(withNotice(await homePath(user), "role"));
  const canManageProjects = isHqLike(user);
  // 프로젝트 만들기 양식 데이터는 양식을 열 때 불러온다 (/api/master/create-data)
  const [{ depts, people, projects }, me, current] = await Promise.all([
    getOrgChart(user, { includeInactive: false, withLoginId: false, withPeople: canManageProjects }),
    myProfile(user),
    getCurrentProject(user),
  ]);
  // 처음 고를 조직: 지금 보는 프로젝트의 조직 → 내 조직
  const start = current.project?.departmentId ?? me?.departmentId ?? null;
  return (
    <div>
      <PageHeader title="프로젝트 체계도"
        desc={canManageProjects
          ? "조직별 프로젝트를 관리합니다. 조직을 골라 프로젝트를 만들거나 다른 조직으로 옮기세요."
          : "조직별 프로젝트를 확인합니다. 권한이 있는 프로젝트는 열어 볼 수 있습니다."}>
        {canManageProjects && <Link href="/master" className="btn-secondary">PM 지정·준비 상태는 기준 정보 ›</Link>}
      </PageHeader>
      <OrgChart mode="projects" depts={depts} people={people} projects={projects} canManage={false} canManageProjects={canManageProjects}
        canManageDepts={false} orgLink={user.role === "ADMIN"} initialDeptId={start} canCreate={canManageProjects} />
    </div>
  );
}
