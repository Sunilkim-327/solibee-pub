import { PageHeader } from "@/components/common";
import { MasterAdmin } from "@/components/MasterAdmin";
import { requireUser } from "@/lib/access";
import { loadCategoriesEnsured, loadDepartments, loadMasterProjects, loadPeople } from "./data";

const CARD_TABS = ["info", "pm", "life", "changes"] as const;

/** 기준 정보 — 프로젝트 설정(PM·준비 상태·연차·변경계약)과 회사 공통 분류·항목 */
export default async function MasterPage({ searchParams }: { searchParams: Promise<{ project?: string; tab?: string }> }) {
  const user = await requireUser(["HQ", "ADMIN"]);
  // ?project=&tab= — 할 일(종료 처리 가능 등)에서 그 프로젝트 카드의 해당 영역을 바로 연다
  const { project: focusId, tab } = await searchParams;
  const focusTab = CARD_TABS.find((t) => t === tab) ?? "info";
  const [categories, users, projects, depts] = await Promise.all([loadCategoriesEnsured(), loadPeople(), loadMasterProjects(), loadDepartments()]);
  return (
    <div>
      <PageHeader title="기준 정보"
        desc={user.role === "HQ"
          ? "프로젝트의 PM·시작 준비·연차·변경계약과 회사 공통 분류·항목을 관리합니다."
          : "프로젝트의 PM·시작 준비·연차·변경계약을 관리합니다. 조직·임직원·계정은 조직도에서 관리합니다."} />
      <MasterAdmin role={user.role} categories={categories} depts={depts} users={users} projects={projects}
        focus={focusId && projects.some((p) => p.id === focusId) ? { projectId: focusId, tab: focusTab } : undefined} />
    </div>
  );
}
