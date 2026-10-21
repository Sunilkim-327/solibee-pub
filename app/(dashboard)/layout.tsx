import Link from "next/link";
import { Logo } from "@/components/Logo";
import {
  BottomNav, LogoutButton, MobileBarTitle, MobileMenuButton, NavRoleProvider, ProfileLink, ProjectOnly, ProjectScope, ProjectSelect, SideNav, ThemeToggle, Toaster, Today,
} from "@/components/Nav";
import { RedirectNotice } from "@/components/RedirectNotice";
import { SessionKeeper } from "@/components/SessionKeeper";
import { NavWatchdog } from "@/components/NavWatchdog";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { unreadCount } from "@/lib/notification-server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentProjectContext, isHqLike, myMemberships, requireUser } from "@/lib/access";
import { pageRedirect } from "@/lib/page-access";
import { PAGE_PATH_HEADER } from "@/lib/session-path";
import { MEMBER_GRACE_MONTHS, PHASE_LABEL } from "@/lib/lifecycle";
import { addMonths, dotDate, toYearMonth, ymLabel } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/types";
import { ReadOnlyNotice } from "@/components/ScopeToggle";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await requireUser();
  // 메뉴·역할 표시는 현재 프로젝트에서의 역할 기준 (상위 PM의 하위 조회는 조회 전용)
  // 요청 단위로 메모이즈되어 페이지의 pageContext()와 조회를 공유한다
  const { project, projects, user } = await currentProjectContext(sessionUser);
  // 첫 화면(/)·권한 없는 화면: 본문을 그리기 전에(스트리밍 시작 전) 역할별 첫 화면으로 — 실제 307 응답이 된다.
  // 경로는 미들웨어가 넣어 준 헤더 (페이지도 같은 규칙으로 다시 확인한다)
  const path = (await headers()).get(PAGE_PATH_HEADER);
  const to = path ? pageRedirect(path, { globalRole: sessionUser.role, hasProject: !!project, role: user.role, readOnly: user.readOnly }) : null;
  if (to) redirect(to);
  const roleText = user.readOnly && user.readOnlyReason === "view" ? "조회 전용" : user.role === "MANAGER" ? "PM" : ROLE_LABEL[user.role];
  const phase = project?.phase;
  // 보관된 프로젝트는 선택 목록에 없으므로, 직접 연 경우 현재 프로젝트로 함께 표시 (다른 프로젝트 이름이 보이지 않게)
  const selectable = project && !projects.some((p) => p.id === project.id) ? [project, ...projects] : projects;
  // 프로젝트마다 내 역할 (전환기 배지) — 재무 승인·시스템 관리자는 모든 프로젝트를 같은 권한으로 보므로 표시하지 않음
  // (가시성 계산에 읽은 팀원 정보를 다시 쓴다 — 추가 조회 없음)
  const memberships = isHqLike(sessionUser) ? [] : await myMemberships(sessionUser);
  const roleOf = new Map(memberships.map((m) => [m.projectId, m.isPm ? "PM" : "팀원"]));
  const roleTag = (id: string) => (isHqLike(sessionUser) ? null : roleOf.get(id) ?? "조회");
  // 이 프로젝트에서는 팀원이지만 다른 프로젝트의 PM인 경우 — PM 메뉴가 사라진 이유를 알려 준다
  const pmElsewhere = !isHqLike(sessionUser) && project && roleOf.get(project.id) !== "PM" && memberships.some((m) => m.isPm && m.projectId !== project.id);
  const profileSub = user.position ?? roleText;
  // 내 계정 화면은 팀원·PM (회사 권한 기준)
  const hasMyPage = sessionUser.role === "MEMBER" || sessionUser.role === "MANAGER";
  // 안 읽은 알림 수 — 상단 종 배지의 초깃값. 못 세면 0 (배지만 숨긴다; 이후 클라이언트가 경로 전환 때 다시 센다)
  let unread = 0;
  try { unread = await unreadCount(sessionUser.id); } catch { unread = 0; }

  return (
    <div className="min-h-dvh lg:flex">
      {/* 사이드바 */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/" aria-label="첫 화면"><Logo /></Link>
        </div>
        {/* 내 이름·소속 — 누르면 내 계정 화면 (팀원·PM) */}
        <ProfileLink href={hasMyPage ? "/me" : null} className="mx-2.5 mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-bold text-fg-muted">
            {user.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">
              {user.name} <span className="font-medium">{profileSub}</span>
            </div>
            <div className="truncate text-xs text-fg-muted">
              {user.departmentName ?? roleText}
              {user.position && <span> · {roleText}</span>}
            </div>
          </div>
        </ProfileLink>
        {pmElsewhere && (
          <p className="alert alert-info mx-4 mb-3 text-sm">
            이 프로젝트에서는 {roleText}입니다. PM 메뉴는 위 프로젝트 이름을 눌러 <b>PM</b> 표시가 있는 프로젝트를 고르면 보입니다.
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <SideNav role={user.role} globalRole={sessionUser.role} readOnly={user.readOnly} view={user.readOnlyReason === "view"} noProject={!project} passEnabled={!!project?.clientPassEnabled} />
        </div>
        <div className="flex items-center gap-1 border-t border-line px-3 py-3">
          <Link href="/account/password" className="btn-ghost btn-sm">비밀번호 변경</Link>
          <LogoutButton className="btn-ghost btn-sm" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 상단 바 — 모바일: 로고(스크롤하면 화면 제목) · 프로젝트 / PC: 프로젝트 · 날짜 (화면 제목은 본문 머리글) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-4 lg:h-16 lg:gap-3 lg:px-8">
          <MobileMenuButton />
          <span className="flex min-w-0 shrink items-center lg:hidden"><MobileBarTitle /></span>
          {project && (
            <ProjectScope>
              <div className="min-w-0">
                <ProjectSelect current={project.id}
                  projects={selectable.map((p) => ({
                    id: p.id, name: p.name, depth: p.depth, parentId: p.parentId,
                    phaseTag: p.phase === "ACTIVE" ? null : PHASE_LABEL[p.phase], ended: p.phase === "CLOSED",
                    roleTag: roleTag(p.id),
                  }))} />
              </div>
            </ProjectScope>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <span className="hidden sm:block"><Today /></span>
            <NotificationBell initialUnread={unread} />
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pt-7 lg:pb-12">
          {project && phase === "WRAPUP" && (
            <p className="alert alert-warn mb-4">
              <b>{PHASE_LABEL.WRAPUP}</b> · 기간이 {dotDate(project.endDate)}에 끝났습니다.
              팀원 입력은 {ymLabel(addMonths(toYearMonth(project.endDate), MEMBER_GRACE_MONTHS))} 말까지, 이후 PM이 마지막 달까지 마감·상신{project.clientPassEnabled ? "·출입증 월 확정" : ""}{isHqLike(user) ? "합니다" : "해 주세요"}. 모든 달이 승인돼야 종료할 수 있습니다.
            </p>
          )}
          {project && (phase === "CLOSED" || phase === "ARCHIVED") && (
            <p className="alert alert-neutral mb-4">
              <b className="text-fg">{PHASE_LABEL[phase]}된 프로젝트</b> · 조회만 할 수 있습니다. {isHqLike(user) ? `수정이 필요하면 기준 정보 → 프로젝트 카드의 상태·연차에서 ${phase === "ARCHIVED" ? "보관을 해제한 뒤 종료를" : "종료를"} 취소하세요.` : "수정이 필요하면 재무 승인 담당에게 종료 취소를 요청하세요."}
            </p>
          )}
          {project && user.readOnlyReason === "admin" && (
            <ProjectOnly>
              <p className="alert alert-info mb-4">
                <b>시스템 관리자 조회 화면</b> · 조회만 할 수 있습니다. 입력·마감은 PM, 승인은 재무 승인 담당이 합니다.
              </p>
            </ProjectOnly>
          )}
          {/* 조회 전용(상위 PM·조직장) 안내 — 프로젝트 화면마다 한 번만 */}
          {project && user.readOnlyReason === "view" && <ProjectOnly><ReadOnlyNotice /></ProjectOnly>}
          {/* 프로젝트를 바꾸면 화면을 새로 그린다 — 이전 프로젝트의 편집 상태가 남아 다른 프로젝트로 저장되는 것을 막음.
              NavRoleProvider: 로딩 뼈대의 제목이 메뉴와 같은 역할별 이름을 쓰게 */}
          <NavRoleProvider role={user.role}><div key={project?.id ?? "none"} className="contents">{children}</div></NavRoleProvider>
        </main>
      </div>
      {(project || isHqLike(sessionUser)) && <BottomNav role={user.role} globalRole={sessionUser.role} readOnly={user.readOnly} view={user.readOnlyReason === "view"}
        passEnabled={!!project?.clientPassEnabled} unread={unread}
        profile={{ name: user.name, sub: profileSub, projectName: project?.name ?? null, roleText, pmElsewhere: !!pmElsewhere, href: hasMyPage ? "/me" : null }} />}
      <Toaster />
      {/* 권한 없음·조회 전용으로 보내진 경우(?notice=) 토스트 한 번 — Toaster가 먼저 준비된 뒤 */}
      <RedirectNotice role={user.role} />
      <SessionKeeper />
      <NavWatchdog />
    </div>
  );
}
