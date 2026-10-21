import { redirect } from "next/navigation";
import { SectionNav } from "@/components/SectionNav";
import { PartnersSettings } from "@/components/PartnersSettings";
import { PageHeader } from "@/components/common";
import { MemberItemsSettings, type MemberItemOption } from "@/components/MemberItemsSettings";
import { parseBundle } from "@/lib/budget-bundle";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";
import { PassSettings } from "@/components/PassSettings";
import { ScrollToHash } from "./ScrollToHash";
import { ChangeItemsSettings } from "@/components/ChangeItemsSettings";
import { SetupChecklist } from "@/components/SetupChecklist";
import { formatDate, formatPeriod, projectMonths, seoulToday } from "@/lib/format";
import { ProjectMembersSettings, type MemberCandidate } from "@/components/ProjectMembersSettings";
import { byPositionThenName, descendantIds } from "@/lib/org";
import { myProfile, pageContext } from "@/lib/access";
import { prisma } from "@/lib/db";
import { setupComplete, type SetupState } from "@/lib/todo";
import { teamWithoutItems, type InputSource } from "@/lib/input-capable";
import { getImportProfiles, passItems } from "@/lib/pass-statement-server";
import { displayItemsOf, sheetLabel } from "@/lib/pass-statement";
import { PassVendorSettings } from "@/components/pass/PassVendorSettings";
import { resolveYm } from "@/lib/master";
import { PAY_METHOD_LABEL } from "@/lib/types";
import { withNotice } from "@/lib/page-access";

const SECTIONS = [
  { id: "people", label: "팀원" },
  { id: "items", label: "지출 항목" },
  { id: "pass", label: "출입증 정산" },
];

export default async function SettingsPage() {
  // 이 프로젝트 PM만 (재무 승인·시스템 관리자는 레이아웃의 화면 규칙에서 첫 화면으로)
  const { user, project } = await pageContext(["MANAGER"]);
  // 조회 전용(종료·상위 PM 조회)이면 현황으로 — 안내 토스트와 함께 (레이아웃 규칙과 같음, 여기는 예비)
  if (user.readOnly) redirect(withNotice("/dashboard", "readonly"));
  const [lines, memberItems, members, users, depts, me, changes, passCandidates, projectItems, partners, passProfiles] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { projectId: project.id },
      include: { item: { include: { category: true } } },
      orderBy: { order: "asc" },
    }),
    prisma.memberItem.findMany({ where: { projectId: project.id }, select: { itemId: true } }),
    prisma.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true, isPayer: true, isPm: true, leftAt: true } })
      .then((list) => list.map((m) => ({ ...m, leftAt: m.leftAt ? formatDate(m.leftAt) : null }))),
    // 팀원 후보: 재직 중인 일반 임직원 (재무 승인·시스템 관리자 계정은 팀원 대상 아님)
    prisma.user.findMany({ where: { active: true, role: { in: ["MEMBER", "MANAGER"] } }, select: { id: true, name: true, position: true, departmentId: true } }),
    prisma.department.findMany({ select: { id: true, name: true, parentId: true, order: true } }),
    myProfile(user),
    prisma.contractChange.findMany({
      where: { projectId: project.id }, orderBy: { seq: "asc" },
      include: { manager: { select: { name: true } }, items: { select: { itemId: true } } },
    }),
    passItems(project.id),
    // 이 프로젝트의 항목 전체 (예산 없는 항목도 안내용으로 보여 줌)
    prisma.item.findMany({
      where: { projectId: project.id, active: true, categoryId: { not: PASS_CATEGORY_ID } },
      include: { category: true }, orderBy: [{ category: { order: "asc" } }, { order: "asc" }],
    }),
    prisma.projectPartner.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" }, select: { id: true, name: true, company: true, active: true } }),
    // 출입증 업체 서식 (출입증을 쓰는 프로젝트만)
    project.clientPassEnabled ? getImportProfiles(project.id) : [],
  ]);
  // 추천: PM 소속 조직 + 프로젝트 주관 조직 (하위 조직 포함)
  const near = new Set<string>();
  for (const root of [me?.departmentId, project.departmentId]) if (root) descendantIds(depts, root).forEach((id) => near.add(id));
  // 조직 이름은 한 번만 보내고 사람은 조직 id로 (전체 임직원 목록이 크므로)
  const deptNames = Object.fromEntries(depts.map((d) => [d.id, d.name]));
  const candidates: MemberCandidate[] = [...users].sort(byPositionThenName).map((u) => ({
    id: u.id, name: u.name, position: u.position, deptId: u.departmentId,
    ...(u.departmentId && near.has(u.departmentId) ? { near: true as const } : {}),
  }));
  // 예산 항목: 예산 행의 항목 + 묶음으로 들어간 항목 (중복은 하나로)
  const itemInfo = new Map(projectItems.map((i) => [i.id, i]));
  const items = new Map<string, MemberItemOption>();
  for (const l of lines) {
    const it = items.get(l.itemId) ?? { id: l.itemId, name: l.item.name, categoryName: l.item.category.name, planned: 0 };
    it.planned += l.planned;
    items.set(l.itemId, it);
    for (const x of parseBundle(l.bundleItemIds)) {
      const info = itemInfo.get(x);
      if (info && !items.has(x)) items.set(x, { id: x, name: info.name, categoryName: info.category.name, planned: 0, note: `${l.item.name} 묶음 예산` });
    }
  }
  // 예산이 없는 항목 — 고를 수 없지만 왜 없는지 보이도록
  const unbudgeted = projectItems.filter((i) => !items.has(i.id)).map((i) => ({ id: i.id, name: i.name, categoryName: i.category.name }));

  // 현재 팀원 (PM 제외, 철수일이 지나지 않은 사람)
  const today = seoulToday();
  const team = members.filter((m) => !m.isPm && (!m.leftAt || m.leftAt >= today));
  const setup: SetupState = { hasBudget: items.size > 0, hasMemberItems: memberItems.length > 0, hasMembers: team.length > 0 };
  // 팀원은 있는데 입력할 수 있는 항목이 없는 사람 (팀원 지출 항목 없음 — 과업 담당 항목이 있으면 입력 가능) → PM만 입력한다는 사실 안내
  const sources: InputSource[] = [
    ...lines.map((l) => ({ projectId: project.id, kind: "budget" as const, itemId: l.itemId, bundleItemIds: l.bundleItemIds, managerId: null })),
    ...memberItems.map((m) => ({ projectId: project.id, kind: "member" as const, itemId: m.itemId, bundleItemIds: null, managerId: null })),
    ...changes.flatMap((c) => c.managerId ? c.items.map((i) => ({ projectId: project.id, kind: "change" as const, itemId: i.itemId, bundleItemIds: null, managerId: c.managerId })) : []),
  ];
  const pmOnlyCount = setup.hasBudget ? teamWithoutItems(project.id, team, sources) : 0;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="PM 설정"
        desc="팀원, 팀원 지출 항목, 출입증 정산을 설정합니다." />
      {/* 시작 준비 — 필수는 재무 승인이 등록한 예산뿐, 팀원·팀원 지출 항목은 팀원도 입력할 때만 (PM만 입력하는 프로젝트도 정상) */}
      {!setupComplete(setup) && <SetupChecklist setup={setup} onSettingsPage className="card mb-5 p-5" />}
      {pmOnlyCount > 0 && (
        <p className="alert alert-info mb-5 text-sm">
          <span>팀원 {pmOnlyCount}명은 입력할 지출 항목이 없어 PM만 입력합니다. 팀원도 입력하게 하려면 &apos;팀원 지출 항목&apos;에서 항목을 고르세요.</span>
        </p>
      )}
      {/* 섹션 바로가기 — 화면이 길어 상단에 붙여 둔다 */}
      <nav aria-label="설정 섹션" className="sticky top-14 z-20 -mx-4 mb-5 bg-canvas/95 px-4 py-2 backdrop-blur lg:top-16 lg:mx-0 lg:px-0">
        <SectionNav sections={SECTIONS} />
      </nav>

      <section id="people" aria-labelledby="people-h" className="scroll-mt-32 space-y-4">
        <h2 id="people-h" className="section-title">팀원</h2>
        <ProjectMembersSettings projectId={project.id} candidates={candidates} deptNames={deptNames} initial={members} today={seoulToday()} />
        <PartnersSettings projectId={project.id} initial={partners} />
      </section>

      <section id="items" aria-labelledby="items-h" className="mt-10 scroll-mt-32 space-y-4">
        <h2 id="items-h" className="section-title">지출 항목</h2>
        <MemberItemsSettings projectId={project.id} items={[...items.values()]} unbudgeted={unbudgeted}
          categoryOrder={[...new Set(projectItems.map((i) => i.category.name))]} initial={memberItems.map((m) => m.itemId)} />
        <p className="text-sm text-fg-muted">
          팀원 입력의 결제방법은 {PAY_METHOD_LABEL.PERSONAL_CARD}로 고정됩니다.
        </p>
        {changes.length > 0 && (
          <ChangeItemsSettings memberItemIds={memberItems.map((m) => m.itemId)}
            items={[...items.values()].map((i) => ({ id: i.id, name: i.name, categoryName: i.categoryName }))}
            changes={changes.map((c) => ({
              id: c.id, seq: c.seq, title: c.title, period: formatPeriod(c.startDate, c.endDate),
              managerName: c.manager?.name ?? null, itemIds: c.items.map((i) => i.itemId),
            }))} />
        )}
      </section>

      <section id="pass" aria-labelledby="pass-h" className="mt-10 scroll-mt-32 space-y-4">
        <h2 id="pass-h" className="section-title">출입증 정산</h2>
        <PassSettings projectId={project.id} enabled={project.clientPassEnabled} name={project.clientPassName} items={passCandidates} />
        {project.clientPassEnabled && (
          <PassVendorSettings projectId={project.id} ym={resolveYm(undefined, projectMonths(project.startDate, project.endDate))} canEdit
            displayItems={displayItemsOf(project.passDisplayItems, passProfiles)}
            vendors={passProfiles.map((p) => ({
              id: p.id, vendorName: p.vendorName, periodStartDay: p.periodStartDay,
              sheets: p.sheets.map((s) => ({
                label: sheetLabel(s), sheetName: s.sheetName, explicitLabel: !!s.label?.trim(),
                nameCol: s.nameCol, amountCols: s.amountCols, dateCol: s.dateCol ?? null, timeCol: s.timeCol ?? null,
                links: s.display.map((d) => ({ item: d.item, col: d.col })),
              })),
            }))} />
        )}
      </section>
      <div className="h-16 lg:hidden" aria-hidden />
      <ScrollToHash />
    </div>
  );
}
