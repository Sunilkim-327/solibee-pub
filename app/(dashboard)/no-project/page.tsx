import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, PageHeader } from "@/components/common";
import { getCurrentProject, isHqLike, requireUser } from "@/lib/access";

/** 아직 프로젝트에 배정되지 않은 임직원 안내 */
export default async function NoProjectPage() {
  const user = await requireUser();
  // 재무 승인·시스템 관리자는 프로젝트를 만들 수 있으므로 여기 머물지 않음
  if (isHqLike(user)) redirect("/projects");
  const { project } = await getCurrentProject(user);
  if (project) redirect("/");
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="시작하기" />
      <Empty card icon="project" title="아직 배정된 프로젝트가 없습니다"
        action={<Link href="/me" className="btn-secondary">내 계정 확인</Link>}>
        PM이나 재무 승인 담당에게 프로젝트 배정을 요청하세요. 배정되면 지출 입력·정산 메뉴가 열립니다.
      </Empty>
    </div>
  );
}
