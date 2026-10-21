import Link from "next/link";
import { MonthNav } from "@/components/MonthNav";
import { BackTo } from "@/components/BackTo";
import { Empty, PageHeader } from "@/components/common";
import { PassList } from "@/components/PassForm";
import { PassStatementBoard, PassSteps } from "@/components/PassStatementBoard";
import { PassUpload } from "@/components/PassUpload";
import { pageContext } from "@/lib/access";
import { addMonths, formatDate, projectMonths, won, ymKo } from "@/lib/format";
import { resolveYm } from "@/lib/master";
import { wantedYm } from "@/lib/page-ctx-server";
import { canAssumeExternal, canManagePass, canReopenPass, canSeeAllPass, passLockedProblem, passPeriodLabel, sheetLabel } from "@/lib/pass-statement";
import { listPassUsages } from "@/lib/pass-server";
import { getImportProfiles, loadStatement, passClosingStatus, passItems, passMembers } from "@/lib/pass-statement-server";
import { CLOSING_LABEL } from "@/lib/types";
import { prisma, sqlRows } from "@/lib/db";
import { budgetLinesOf, budgetMonthSums } from "@/lib/queries";
import { bundleRemaining } from "@/lib/budget-bundle";
import { cardDayKey, sumByItem } from "@/lib/pass-budget";
import { PASS_CATEGORY_ID } from "@/lib/pass-category";
import type { PassBudgetLink } from "@/components/PassStatementBoard";

/**
 * 회사 부담 항목 → 연결 예산 항목 잔액(카드 + 출입증 확정분 기준), 그 달 출입증 내역 기간의 카드 지출 날 (중복 의심 경고)
 * PM·재무 승인·시스템 관리자만 보는 화면이라 예산 금액을 보여 준다
 */
async function passBudgetContext(projectId: string, ym: string) {
  // 회사 부담 항목 + 연결 예산 항목(같은 프로젝트) 이름 — 항목을 두 번 읽지 않고 한 번에 (직접 SQL)
  const linkedItems = await sqlRows<{ id: string; linkedItemId: string; name: string }>(
    `SELECT p."id", p."linkedItemId", b."name" FROM "Item" p JOIN "Item" b ON b."id" = p."linkedItemId" AND b."projectId" = p."projectId"
     WHERE p."projectId" = ? AND p."categoryId" = ? AND p."linkedItemId" IS NOT NULL`,
    [projectId, PASS_CATEGORY_ID],
  );
  const budgetIds = [...new Set(linkedItems.map((i) => i.linkedItemId))];
  if (!budgetIds.length) return { links: {}, cardDays: [] };
  const [lines, sums, cards] = await Promise.all([
    budgetLinesOf(projectId),
    budgetMonthSums(projectId),
    // 업체 정산 기간이 달을 걸치므로 (예: 21일~20일) 그 달과 앞 달 카드 지출
    prisma.expense.findMany({ where: { projectId, isHq: false, itemId: { in: budgetIds }, yearMonth: { in: [addMonths(ym, -1), ym] } }, select: { payerId: true, date: true, itemId: true } }),
  ]);
  const remaining = bundleRemaining(lines, sumByItem(sums));
  const links: Record<string, PassBudgetLink> = {};
  for (const i of linkedItems) links[i.id] = { itemId: i.linkedItemId, name: String(i.name), remaining: remaining[i.linkedItemId] ?? null };
  return { links, cardDays: [...new Set(cards.map((c) => cardDayKey(c.payerId, formatDate(c.date), c.itemId)))] };
}

/**
 * 출입증 — 업체가 보낸 월 사용 내역을 올려 팀원별로 나누고, 회사 부담(야근 등)·본인 부담(급여 공제)을 정해 확정한다.
 * 개인 법인카드 정산과는 따로 처리하되, 예산 항목에 연결한 회사 부담 확정분은 그 달 마감·상신 엑셀(본사 집행내역)과 예산 집행에 합쳐진다 (lib/pass-budget).
 */
export default async function PassPage({ searchParams }: { searchParams: Promise<{ ym?: string; from?: string }> }) {
  const { user, project } = await pageContext(["MANAGER", "HQ", "ADMIN"]);
  const passName = project.clientPassName ?? "출입증";
  const canSet = !user.readOnly;

  if (!project.clientPassEnabled) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="출입증 정산" />
        <Empty card icon="inbox" title={`${project.name}은(는) 출입증을 쓰지 않습니다`}
          action={canSet ? <Link href="/settings#pass" className="btn-primary">PM 설정에서 사용 켜기</Link> : undefined}>
          {canSet
            ? "고객사 출입증으로 식당·카페를 쓰는 프로젝트라면 켜세요."
            : user.readOnlyReason === "closed" ? "종료된 프로젝트라 설정을 바꿀 수 없습니다." : "출입증 사용 설정은 이 프로젝트의 PM이 할 수 있습니다."}
        </Empty>
      </div>
    );
  }

  // 상위 PM·조직장 조회: 개인별 사용·본인 부담 내역은 이 프로젝트 PM·재무 승인·시스템 관리자만
  if (!canSeeAllPass(user)) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={`${passName} 정산`} />
        <Empty card icon="lock" title="이 프로젝트 PM·재무 승인·시스템 관리자만 볼 수 있습니다">개인별 사용 내역과 본인 부담 금액이 들어 있어요.</Empty>
      </div>
    );
  }

  const months = projectMonths(project.startDate, project.endDate);
  const sp = await searchParams;
  // ?ym= → 마지막 본 달(쿠키) → 이번 달
  const ym = resolveYm(await wantedYm(sp.ym, months), months);
  const [data, members, profiles, items, budget, closingStatus] = await Promise.all([
    loadStatement(user, project.id, ym), passMembers(project.id, ym), getImportProfiles(project.id), passItems(project.id), passBudgetContext(project.id, ym),
    // 이 달 마감 상태 (출입증 내역이 아직 없어도 마감된 달에는 올릴 수 없다) — loadStatement와 같은 요청 안에서 한 번만 조회
    passClosingStatus(project.id, ym),
  ]);
  // 상신·승인된 달: 결정·확정·확정 취소·올리기·삭제 모두 잠김 — 마감(상신 전)은 수정 가능 (lib/pass-statement passLockedProblem)
  const lockMsg = passLockedProblem(closingStatus);
  const legacy = data ? [] : (await listPassUsages(user, project.id, ym)).map((r) => ({ ...r, editable: false }));
  const canEdit = canManagePass(user);
  // 업체 서식 목록 (업체마다 구분·정산 기간) — 올릴 때 파일 머리글과 가장 잘 맞는 업체를 자동으로 고른다
  const profileText = profiles.length
    ? profiles.map((p) => `${p.vendorName}(${[...new Set(p.sheets.map(sheetLabel))].join("·")}, ${passPeriodLabel(ym, p.periodStartDay)})`).join(" / ") + ` — ${ymKo(ym)}분`
    : null;

  const confirmed = data?.statement.status === "CONFIRMED";
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title={`${passName} 정산`}
        meta={(data || closingStatus !== "DRAFT") ? (
          <span className="flex flex-wrap items-center gap-1">
            {data && <span className={`badge ${confirmed ? "badge-ok" : "badge-neutral"}`}>{confirmed ? "확정" : "확정 전"}</span>}
            {/* 월 마감 상태 (작성중이면 표시하지 않음) — 잠긴 달·반려된 달을 한눈에 */}
            {closingStatus !== "DRAFT" && <span className={`badge ${closingStatus === "REJECTED" ? "badge-bad" : closingStatus === "APPROVED" ? "badge-ok" : "badge-neutral"}`}>{CLOSING_LABEL[closingStatus]}</span>}
          </span>
        ) : undefined}
        desc="업체 월 사용 내역에서 회사 부담(야근 식사 등)과 본인 부담(급여 공제)을 정합니다."
        month={<MonthNav months={months} value={ym} />} />
      <BackTo from={sp.from} ym={ym} />

      {/* 흐름: 진행 단계·지금 할 일(올린 파일·추가 올리기 포함) → 요약 → 팀원별 → 합계·수금·내려받기. 위에서부터 차례로 처리 */}
      {data ? (
        <PassStatementBoard key={`board:${project.id}:${ym}`} statement={data.statement} lines={data.lines} items={items} links={budget.links} cardDays={budget.cardDays}
          members={members.map((m) => ({ userId: m.userId, name: m.name, position: m.position, leftAt: m.leftAt }))} canEdit={canEdit} canAssume={canAssumeExternal(user)} canReopen={canReopenPass(user)}
          canDelete={canEdit} closingStatus={closingStatus}
          upload={canEdit ? <PassUpload key={`upload:${project.id}:${ym}`} projectId={project.id} ym={ym} profileText={profileText} locked={confirmed || !!lockMsg} lockedText={lockMsg ?? undefined} defaultOpen={false} /> : null} />
      ) : !canEdit ? (
        <Empty card icon="upload" title={`${ymKo(ym)} 업체 내역이 아직 없습니다`}>PM이 업체가 보낸 사용 내역을 올리면 여기에 보입니다.</Empty>
      ) : (
        <section className="card overflow-hidden" aria-label="진행 단계">
          <PassSteps step={0} />
          <div className="p-4">
            <PassUpload key={`upload:${project.id}:${ym}`} projectId={project.id} ym={ym} profileText={profileText} locked={!!lockMsg} lockedText={lockMsg ?? undefined} defaultOpen />
          </div>
        </section>
      )}

      {legacy.length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3">
            <div>
              <h2 className="text-base font-bold">이전 방식으로 입력된 내역</h2>
              <p className="text-xs text-fg-muted">팀원이 직접 입력했던 출입증 사용분입니다 (조회 전용). 합계 {won(legacy.reduce((a, r) => a + r.amount, 0))}원 · {legacy.length}건</p>
            </div>
            <a className="btn-secondary text-sm" href={`/api/projects/${project.id}/pass-usages/export?ym=${ym}`}>이전 내역 엑셀</a>
          </div>
          <PassList rows={legacy} showUser />
        </section>
      )}
    </div>
  );
}
