import Link from "next/link";
import { Empty, PageHeader } from "@/components/common";
import { OpenProjectButton } from "@/components/OpenProjectButton";
import { ListRow } from "@/components/list/ListRow";
import { NodeIcon } from "@/components/Tree";
import { getCurrentProject, myProfile, requireUser, isHqLike } from "@/lib/access";
import { ROLE_LABEL } from "@/lib/types";
import { prisma } from "@/lib/db";
import { currentYearMonth, formatPeriod, kstDateTime, seoulTodayDate, ymKo } from "@/lib/format";
import { currentMemberWhere } from "@/lib/membership";
import { buildTree, flattenTree, sortPeople } from "@/lib/org";
import { PHASE_LABEL, projectPhase } from "@/lib/lifecycle";
import { settlementRedirect } from "@/lib/page-access";

/**
 * 내 계정 — 계정 정보(아이디·역할·마지막 로그인·비밀번호 변경), 정산 링크 한 줄(현황의 정산 구역으로), 소속 프로젝트.
 * 동료 목록·조직장은 조직도의 몫이라 여기서는 보이지 않는다.
 */
export default async function MyAccountPage() {
  const user = await requireUser();
  const today = seoulTodayDate();
  const ym = currentYearMonth();
  const me = await myProfile(user);
  const [depts, memberships, { project: current }, account] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true, parentId: true, order: true } }),
    prisma.projectMember.findMany({
      where: { userId: user.id, ...currentMemberWhere(today) },
      include: {
        project: {
          select: {
            id: true, name: true, code: true, startDate: true, endDate: true, closedAt: true, archivedAt: true,
            department: { select: { name: true } },
            parent: { select: { name: true } },
            members: { where: { isPm: true, ...currentMemberWhere(today) }, select: { user: { select: { name: true, position: true } } } },
          },
        },
      },
      orderBy: { project: { startDate: "desc" } },
    }),
    getCurrentProject(user),
    prisma.user.findUnique({ where: { id: user.id }, select: { loginId: true, employeeNo: true, lastLoginAt: true } }),
  ]);
  const dept = depts.find((d) => d.id === me.departmentId) ?? null;
  const path = dept ? flattenTree(buildTree(depts)).find((d) => d.id === dept.id)?.path ?? dept.name : null;
  // 역할표 자리라 역할 이름 그대로 (프로젝트 PM) — 용어집
  // 정산은 현황의 정산 구역에서 — 팀원: 내 지출 내역 아래 월별 정산, PM: 팀원별 정산 (숫자는 그 화면에만, 여기는 링크 한 줄)
  const settleHref = settlementRedirect(user.role, { ym });
  const showSettle = !!current && user.role !== "HQ" && user.role !== "ADMIN";

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-medium">{value}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="내 계정" />

      {/* 계정 */}
      <section className="card p-5 sm:p-6" aria-label="계정 정보">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-base font-bold text-brand-700">{user.name.slice(0, 1)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-title font-bold">{user.name} {me.position && <span className="text-base font-medium text-fg-muted">{me.position}</span>}</div>
            <div className="truncate text-sm text-fg-muted">{path ? path.split(" > ").join(" › ") : "소속팀 미지정 — 시스템 관리자에게 소속 등록을 요청하세요"}</div>
          </div>
          <Link href="/account/password" className="btn-secondary btn-sm shrink-0">비밀번호 변경</Link>
        </div>
        <dl className="mt-4 divide-y divide-line border-t border-line">
          {row("아이디", account?.loginId ?? "-")}
          {account?.employeeNo && row("사번", <span className="tabular">{account.employeeNo}</span>)}
          {/* 역할은 회사 단위 권한(재무 승인·시스템 관리자)일 때만 — 팀원·PM은 프로젝트마다 달라 아래 소속 프로젝트 카드의 배지가 보여 준다 (2026-10-15) */}
          {isHqLike(user) && row("역할", ROLE_LABEL[user.role])}
          {row("마지막 로그인", account?.lastLoginAt ? <span className="tabular">{kstDateTime(account.lastLoginAt)}</span> : "-")}
        </dl>
        <p className="mt-3 text-xs text-fg-muted">이름·직급·소속은 조직도 기준이에요. 바꿔야 하면 시스템 관리자에게 요청하세요.</p>
      </section>

      {/* 정산 — 링크 한 줄 (숫자는 현황의 정산 구역에서) */}
      {showSettle && (
        <section className="card overflow-hidden" aria-label="정산">
          <ListRow href={settleHref} chevron title={user.role === "MEMBER" ? `${ymKo(ym)} 내 정산` : `${ymKo(ym)} 팀원별 정산`}
            meta={<span className="truncate">{current?.name} ·{user.role === "MEMBER" ? "받을 돈 · 본인 부담 공제" : "팀원별 받을 돈 · 공용 · 본사"}</span>} />
        </section>
      )}

      {/* 소속 프로젝트 */}
      <section aria-label="소속 프로젝트">
        <h2 className="section-title mb-3">소속 프로젝트 <span className="font-medium text-fg-muted">{memberships.length}개</span></h2>
        {memberships.length === 0 ? (
          <Empty card icon="project" title="아직 배정된 프로젝트가 없습니다">PM이나 재무 승인 담당에게 배정을 요청하세요.</Empty>
        ) : (
          <div className="space-y-3">
            {memberships.map((m) => {
              const p = m.project;
              const phase = projectPhase(p);
              const ongoing = phase === "ACTIVE";
              const pms = sortPeople(p.members, (x) => x.user).map((x) => `${x.user.name}${x.user.position ? ` ${x.user.position}` : ""}`);
              const isCurrent = current?.id === p.id;
              return (
                <div key={p.id} className={`card p-4 sm:p-5 ${isCurrent ? "ring-2 ring-primary/30" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <NodeIcon icon={p.parent ? "subproject" : "project"} />
                        <span className="text-base font-bold">{p.name}</span>
                        <span className={`badge ${m.isPm ? "badge-primary" : "badge-neutral"}`}>{m.isPm ? "PM" : "팀원"}</span>
                        <span className={`badge ${ongoing ? "badge-info" : "badge-neutral"}`}>{ongoing ? "진행 중" : PHASE_LABEL[phase]}</span>
                        {isCurrent && <span className="badge badge-primary">지금 보는 프로젝트</span>}
                      </div>
                      <div className="mt-1 text-sm text-fg-muted">
                        {[p.code, p.department?.name, p.parent ? `상위: ${p.parent.name}` : null].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {!isCurrent && <OpenProjectButton projectId={p.id} name={p.name} href="/" label="이 프로젝트 열기" className={m.isPm ? "btn-primary btn-sm" : "btn-secondary btn-sm"} />}
                  </div>
                  {/* PM · 기간 두 줄(PC는 두 칸). '정산표 결제자'는 정산표 내부 설정이라 보이지 않는다 (2026-10-15) */}
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                    <div className="flex gap-3"><dt className="w-10 shrink-0 text-xs leading-5 text-fg-muted">PM</dt><dd className="min-w-0 font-medium">{pms.join(", ") || "미지정"}</dd></div>
                    <div className="flex gap-3"><dt className="w-10 shrink-0 text-xs leading-5 text-fg-muted">기간</dt><dd className="tabular font-medium">{formatPeriod(p.startDate, p.endDate)}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
