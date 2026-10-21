import Link from "next/link";
import { PageHeader } from "@/components/common";
import { ExpenseForm } from "@/components/ExpenseForm";
import { canManage, pageContext } from "@/lib/access";
import { allowedPayMethods } from "@/lib/rules";
import { listExpenses, type ExpenseRow } from "@/lib/expenses";
import { addMonths, currentYearMonth, projectMonths, todayString, won } from "@/lib/format";
import { FoldSection } from "@/components/FoldSection";
import { ledgerHref, passCheckHref } from "@/lib/page-access";
import { redirect } from "next/navigation";
import { MyExpenseList } from "@/components/MyExpenseList";
import { getInputContext, getInputMaster, getInputTasks, resolveYm } from "@/lib/master";
import { memberInputOpen, projectPhase } from "@/lib/lifecycle";
import { TodoBanner } from "@/components/TodoBanner";
import { maxNotices, type RejectedMonth } from "@/lib/member-todo";
import { daysToDeadline, inputDeadlineLabel, inputOpen } from "@/lib/month-phase";
import { myOpenPassMonths, openPassMonths } from "@/lib/pass-statement-server";
import { isUnexplained } from "@/lib/policy";
import { budgetLinesOf, closingRows, getLockedMonths } from "@/lib/queries";
import { revokedMonths } from "@/lib/closing-server";
import { getPmNames, getPayers } from "@/lib/reports";
import { PAY_METHOD_LABEL } from "@/lib/types";

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ mode?: string; ym?: string }> }) {
  const { mode, ym: requestedYm } = await searchParams;
  // 예전 출입증 탭 주소 — 출입증 확인은 내 지출 내역의 출입증 탭으로 옮겼다 (미들웨어가 먼저 옮기고, 여기는 예비)
  if (mode === "pass") redirect(passCheckHref(requestedYm));
  const { user, project } = await pageContext();
  const months = projectMonths(project.startDate, project.endDate);
  const ym = resolveYm(undefined, months);
  const passName = project.clientPassName ?? "출입증";
  // 출입증 확인 화면: 팀원은 내 지출 내역의 출입증 탭, PM·재무 승인은 출입증 정산 (조회 권한은 출입증 화면을 쓰지 않는다)
  const passHref = !project.clientPassEnabled || user.readOnlyReason === "view" ? null : user.role === "MEMBER" ? passCheckHref() : "/pass";
  // 종료된 프로젝트·팀원 입력 마감 후에는 입력 화면 대신 안내
  if (user.readOnly || (user.role === "MEMBER" && !memberInputOpen(project))) {
    // PM 이름은 이 안내에서만 쓴다
    const pmNames = user.readOnly ? [] : await getPmNames(project.id);
    const pmText = pmNames.length ? `PM(${pmNames.join(", ")})` : "PM";
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="지출 입력" />
        <div className="card px-6 py-10 text-center">
          <p className="text-base font-bold">{user.readOnly ? "이 프로젝트는 입력할 수 없습니다" : "팀원 입력이 마감되었습니다"}</p>
          <p className="mt-2 text-sm text-fg-muted">
            {user.readOnly
              ? user.readOnlyReason === "closed" ? "종료된 프로젝트라 조회만 할 수 있습니다." : user.readOnlyReason === "admin" ? "시스템 관리자는 조회만 할 수 있습니다." : "조회 권한으로 보고 있는 프로젝트입니다."
              : `프로젝트 기간이 끝났습니다. 늦게 입력할 지출은 ${pmText}에게 전달해 주세요.`}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href={ledgerHref()} className="btn-secondary inline-flex">{user.role === "MEMBER" ? "내 지출 내역 보기" : "지출 내역 보기"}</Link>
            {passHref && <Link href={passHref} className="btn-secondary inline-flex">{passName} 내역 확인</Link>}
          </div>
        </div>
      </div>
    );
  }
  // 내 지출 내역의 달: 이번 달, 또는 아직 마감 전인 지난달 (월초에 지난달 영수증을 늦게 입력할 때)
  const prevYm = addMonths(ym, -1);
  const listYm = requestedYm === prevYm && months.includes(prevYm) ? prevYm : ym;
  const [categories, context, lockedMonths, monthRows, tasks, passOpen, pmNames, rejected, budgetLines] = await Promise.all([
    getInputMaster(user, project.id),
    getInputContext(user, project.id),
    getLockedMonths(project.id),
    listExpenses(user, project.id, listYm),
    getInputTasks(user, project.id),
    // 출입증 안내 — PM: 확정 전인 달(월 확정이 PM 할 일), 팀원: 확정 전 출입증 내역에 내 사용분이 있는 달
    !project.clientPassEnabled ? [] : (canManage(user) && !user.readOnly ? openPassMonths(project.id) : myOpenPassMonths(project.id, user.id))
      .then((list) => list.filter((m) => m <= currentYearMonth())),
    // 입력 화면의 "수정은 PM(○○)에게 요청" 안내용
    getPmNames(project.id),
    // 팀원: 반려·승인 취소된 달을 사유와 함께 알린다 (PM은 팀 현황 할 일에서 본다)
    user.role === "MEMBER"
      ? closingRows(project.id).then(async (rows): Promise<RejectedMonth[]> => {
          const revoked = await revokedMonths(rows);
          return rows.filter((c) => c.status === "REJECTED").sort((x, y) => x.yearMonth.localeCompare(y.yearMonth))
            .map((c) => ({ ym: c.yearMonth, note: c.reviewNote, revoked: revoked.has(c.yearMonth) }));
        })
      : ([] as RejectedMonth[]),
    // 예산 행 — 입력 항목 계산(getInputMaster)과 같은 요청 캐시 (추가 조회 없음)
    budgetLinesOf(project.id),
  ]);
  // 팀원 지출 항목이 없는 팀원: 이 프로젝트 지출은 PM이 입력한다 (예산은 있는데 나에게 열린 항목이 없음) — 빈 폼 대신 안내
  const pmInputs = user.role === "MEMBER" && categories.length === 0 && budgetLines.length > 0;
  const byDate = (a: ExpenseRow, b: ExpenseRow) => b.date.localeCompare(a.date);
  const mine = monthRows.filter((e) => e.payerId === user.id).sort(byDate);
  const myTotal = mine.filter((e) => e.payMethod === "PERSONAL_CARD" && !e.isHq).reduce((a, e) => a + e.amount, 0);

  const pm = canManage(user);
  // 대신 입력: PM은 결제자 목록의 현재 팀원(본인 제외, 직급 → 성명 순) 대신 입력할 수 있다
  const proxyPayers = pm && !user.readOnly ? (await getPayers(project.id)).filter((p) => p.id !== user.id && !p.leftAt).map(({ id, name, position }) => ({ id, name, position })) : undefined;
  // 개인 법인카드를 쓰지 않는 역할(재무 승인: 본사지출만)은 개인 법인카드 요약이 항상 0이라 숨김
  const noCard = !allowedPayMethods(user.role).includes("PERSONAL_CARD");
  const mLabel = `${Number(listYm.slice(5))}월`;
  const today = todayString();
  // 지난달이 아직 열려 있으면 '지난달 / 이번 달' 고르기 (그 밖의 달은 내 지출 내역에서) — 팀원은 입력 기한(다음 달 3일, lib/month-phase)까지만
  const monthChoice = months.includes(prevYm) && !lockedMonths.includes(prevYm) && (user.role !== "MEMBER" || inputOpen(prevYm, today)) ? [prevYm, ym] : null;
  // 확인 → 추가: 이번 달 내가 입력한 것을 먼저 보고(카드 문자·영수증과 대조), 빠진 것을 바로 이어서 추가
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="지출 입력"
        desc={pm ? "본인 사용분을 입력합니다. 팀원 대신 입력하려면 결제자를 바꾸세요." : undefined} />
      {/* 안내 — 반려 > 소명 필요 > 출입증 확인 > 입력 기한 지남 > 입력 기한 D-5 순으로 최대 2개 (레이아웃의 종료 대기 알림이 있으면 1개).
          출입증 — PM: 월 확정이 할 일이라 확정하면 사라진다 / 팀원: 내 지출 내역의 출입증 탭에서 그 달을 열어 보면 사라진다 */}
      <TodoBanner projectId={project.id} userId={user.id} ym={listYm} count={mine.length} unexplained={mine.filter(isUnexplained).length}
        rejected={rejected} passMonths={passOpen} passName={passName} pm={pm} canInput={!pmInputs}
        dDay={daysToDeadline(listYm, today)} maxShown={maxNotices(projectPhase(project) === "WRAPUP")} />

      {pmInputs && (
        <section className="card mb-4 px-5 py-8 text-center sm:px-6" aria-labelledby="pm-input-h">
          <h2 id="pm-input-h" className="text-base font-bold">이 프로젝트 지출은 PM이 입력합니다</h2>
          <p className="mt-2 text-sm text-fg-muted">
            {PAY_METHOD_LABEL.PERSONAL_CARD}로 결제한 건이 있으면 영수증을 {pmNames.length ? `PM(${pmNames.join(", ")})` : "PM"}에게 전달해 주세요.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {passHref && <Link href={passHref} className="btn-primary inline-flex">{passName} 내역 확인</Link>}
            <Link href={ledgerHref()} className="btn-secondary inline-flex">내 지출 내역 보기</Link>
          </div>
        </section>
      )}

      {/* 1. 확인 — 이번 달 내가 결제한 건 (5건을 넘으면 목록 안에서 스크롤 — 입력 칸이 밀려나지 않게). PM이 입력하는 프로젝트의 팀원은 내 결제 건이 있을 때만 */}
      {(!pmInputs || mine.length > 0) && (
        <>
          {monthChoice && (
            <div className="seg mb-2 flex w-full" role="tablist" aria-label="내 지출 달">
              {monthChoice.map((m) => (
                <Link key={m} href={m === ym ? "/expenses/new" : `/expenses/new?ym=${m}`} role="tab" aria-selected={m === listYm} className="flex-1 text-center">
                  {Number(m.slice(5))}월{rejected.some((r) => r.ym === m) ? " (반려 · 수정 가능)" : m === prevYm ? (user.role === "MEMBER" ? ` (${inputDeadlineLabel(m)}까지)` : " (마감 전)") : ""}
                </Link>
              ))}
            </div>
          )}
          {/* 접어 두면 건수·금액만 — 입력 칸이 바로 보이게. 펼침 상태는 브라우저에 기억 */}
          <FoldSection storageKey="opex:mineOpen" className="mb-4" label={`${mLabel} 내 지출`}
            head={(
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="section-title">{mLabel} 내 지출 <span className="tabular font-normal text-fg-muted">{mine.length}건</span></h2>
                  <p className="mt-0.5 text-sm text-fg-muted">{pmInputs ? "내 결제로 입력된 건입니다." : "카드 문자·영수증과 맞춰 보고, 빠진 건을 추가하세요."}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-fg-muted">{noCard ? "합계" : "정산 예정"}</div>
                  <div className="tabular font-bold">{won(noCard ? mine.reduce((a, e) => a + e.amount, 0) : myTotal)}원</div>
                </div>
              </div>
            )}>
            <MyExpenseList rows={mine} projectId={project.id} role={user.role} categories={categories} context={context} tasks={tasks}
              lockedMonths={lockedMonths} pmNames={pmNames} userId={user.id} />
            <Link href={ledgerHref(listYm)} className="flex min-h-11 items-center justify-center border-t border-line text-sm font-semibold text-primary hover:bg-surface-muted">
              {pm ? "다른 달은 팀 현황에서 보기 ›" : "다른 달은 내 지출 내역에서 보기 ›"}
            </Link>
          </FoldSection>
        </>
      )}

      {/* 2. 추가 */}
      {!pmInputs && <section className="card p-4 sm:p-6" aria-labelledby="add-h">
        <h2 id="add-h" className="section-title mb-4">지출 입력</h2>
        <ExpenseForm key={project.id} projectId={project.id} role={user.role} categories={categories} context={context} tasks={tasks}
          lockedMonths={lockedMonths} pmNames={pmNames} userId={user.id} proxyPayers={proxyPayers} stickySubmit />
      </section>}
      {/* 하단 고정 등록 바에 가려지지 않도록 */}
      <div className="h-16 lg:hidden" aria-hidden />
    </div>
  );
}
