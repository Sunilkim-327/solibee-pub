import Link from "next/link";
import { Empty, PageHeader, StatusBadge } from "@/components/common";
import { Meter, PaceTag } from "@/components/Meter";
import { OpenProjectButton } from "@/components/OpenProjectButton";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { dash0, won, ymKo, ymShort } from "@/lib/format";
import { descendantIds } from "@/lib/org";
import { DeptTreeSelect } from "@/components/DeptTreeSelect";
import { getPortfolio, type PortfolioRow } from "@/lib/portfolio";
import { buildHqTodos } from "@/lib/hq-todo";
import { HqTodoPanel } from "@/components/HqTodoPanel";
import { PACE_META, PACE_RANK, paceStatus, type PaceStatus } from "@/lib/settlement";
import { BOARD_ORDER, boardLabel, defaultBoardYm, monthBoard } from "@/lib/portfolio-view";
import { addMonths, currentYearMonth, seoulToday } from "@/lib/format";
import { monthPhase } from "@/lib/month-phase";
import { Icon } from "@/components/icons";
import { ListToolbar } from "@/components/list/ListToolbar";
import { ParamSearch } from "@/components/list/ParamControls";
import { CLOSING_STATUSES, type ClosingStatus } from "@/lib/types";

type Row = PortfolioRow & { status: PaceStatus };
// 처리 대기(승인 대기·반려)는 월별 마감 현황 보기와 할 일에서 본다 — 예산 위험순 보기는 예산 기준 필터만
type Filter = "all" | "risk";
const FILTERS: [Filter, string][] = [["all", "전체"], ["risk", "주의"]];

const isRisk = (r: Row) => PACE_META[r.status].tone !== "neutral";
const isWaiting = (r: Row) => r.submitted.length + r.rejected.length > 0;
/** 아래 접힘 그룹: 예산 없음·시작 전·종료 (비교 대상이 아님) */
const isQuiet = (r: Row) => !r.hasBudget || r.planned === 0 || r.phase === "UPCOMING" || r.phase === "CLOSED" || r.phase === "ARCHIVED";
/** 위험순: 초과 → 빠름 → 처리 대기 → 초과 예상 → 느림 → 정상, 같은 단계는 집행률-경과 차이 큰 순 */
const rank = (r: Row) => Math.min(PACE_RANK[r.status], isWaiting(r) ? 1.5 : 9);

const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** 처리 필요 월 배지 (short: 표 칸처럼 좁은 곳) */
function Pending({ r, short = false }: { r: Row; short?: boolean }) {
  const label = short ? ymShort : ymKo;
  return (
    <>
      {r.submitted.map((m) => <span key={m} className="badge badge-info whitespace-nowrap" title={`${ymKo(m)} 승인 대기`}>{label(m)} 승인 대기</span>)}
      {r.rejected.map((m) => <span key={m} className="badge badge-bad whitespace-nowrap" title={`${ymKo(m)} 반려`}>{label(m)} 반려</span>)}
    </>
  );
}

function Rate({ r }: { r: Row }) {
  return (
    <span className="tabular whitespace-nowrap text-sm">
      <b className={r.status === "over" ? "text-status-rejected" : ""}>{r.rate === null ? "-" : `${r.rate}%`}</b>
      <span className="text-xs text-fg-muted"> / 경과 {r.timeRate}%</span>
    </span>
  );
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ dept?: string; f?: string; view?: string; ym?: string; st?: string; q?: string }> }) {
  const user = await requireUser(["HQ", "ADMIN"]);
  const { dept, f, view: viewParam, ym: ymParam, st, q: qParam } = await searchParams;
  /** 검색어 (프로젝트·PM·조직) — 목록만 거르고 전체 예산 합계는 조직 범위 기준 그대로 */
  const q = (qParam ?? "").trim().slice(0, 50);
  /** 보기: 월별 마감 현황(기본) / 예산 위험순 */
  const view = viewParam === "risk" ? "risk" : "month";
  const filter: Filter = f === "risk" ? f : "all";
  const [all, depts] = await Promise.all([
    getPortfolio(user),
    prisma.department.findMany({ select: { id: true, name: true, parentId: true, order: true } }),
  ]);
  const scope = dept ? descendantIds(depts, dept) : null;
  const scoped = scope ? all.filter((r) => r.departmentId && scope.has(r.departmentId)) : all;
  const rows: Row[] = scoped.map((r) => ({ ...r, status: paceStatus({ rate: r.rate, timeRate: r.timeRate }) }));
  // 조직별 프로젝트 수 (하위 조직 포함)
  const deptOptions = depts.map((d) => { const ids = descendantIds(depts, d.id); return { ...d, count: all.filter((r) => r.departmentId && ids.has(r.departmentId)).length }; });
  const todos = buildHqTodos(scoped, user.role === "HQ");

  // 전체 집행: 금액 합계 + 계획 가중 기간 경과 (진행 비교 대상만)
  const live = rows.filter((r) => !isQuiet(r));
  const planned = rows.reduce((a, r) => a + r.planned, 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  const livePlanned = live.reduce((a, r) => a + r.planned, 0);
  const timeRate = livePlanned > 0 ? Math.round(live.reduce((a, r) => a + r.planned * r.timeRate, 0) / livePlanned * 10) / 10 : null;
  const rate = pct1(spent, planned);
  // 잔액이 음수(배정 초과)인 프로젝트 수
  const overCount = rows.filter((r) => r.planned > 0 && r.spent > r.planned).length;
  const needle = q.toLowerCase();
  const listed = needle ? rows.filter((r) => [r.name, r.code ?? "", r.departmentPath, ...r.pms].join(" ").toLowerCase().includes(needle)) : rows;
  const counts: Record<Filter, number> = { all: listed.length, risk: listed.filter(isRisk).length };

  const sorted = [...listed].sort((a, b) => rank(a) - rank(b) || ((b.rate ?? 0) - b.timeRate) - ((a.rate ?? 0) - a.timeRate));
  const shown = filter === "risk" ? sorted.filter(isRisk) : sorted;
  const main = filter === "all" ? shown.filter((r) => !isQuiet(r)) : shown;
  const quiet = filter === "all" ? shown.filter(isQuiet) : [];
  // 월별 마감 현황
  const allMonths = [...new Set(rows.flatMap((r) => r.months))].sort();
  // 기본 달: 승인 대기가 있으면 그중 가장 오래된 달 (재무 승인이 지금 처리할 달), 없으면 이번 달
  const picked = ymParam && allMonths.includes(ymParam) ? null : defaultBoardYm(rows, currentYearMonth());
  const ym = picked ? picked.ym : (ymParam as string);
  const movedToPending = !!picked?.moved;
  // 작성중 달은 오늘 기준 단계로 (팀원 입력 기한이 지난 지난달 = 마감 대기, 앞으로의 달 = 예정) — lib/month-phase
  const today = seoulToday();
  const stFilter = (CLOSING_STATUSES as readonly string[]).includes(st ?? "") ? (st as ClosingStatus) : null;
  const board = monthBoard(listed, ym, stFilter);
  const boardTotal = Object.values(board.counts).reduce((a, n) => a + n, 0);
  const link = (x: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    if (dept) p.set("dept", dept);
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(x)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/projects?${qs}` : "/projects";
  };
  const prevYm = allMonths.length && addMonths(ym, -1) >= allMonths[0] ? addMonths(ym, -1) : null;
  const nextYm = allMonths.length && addMonths(ym, 1) <= allMonths[allMonths.length - 1] ? addMonths(ym, 1) : null;
  // 승인은 재무 승인 담당만 — 시스템 관리자는 조회 전용이므로 '열기'
  const canApprove = user.role === "HQ";
  const openOf = (st: ClosingStatus) => (st === "SUBMITTED" ? { href: "/closing", label: canApprove ? "승인하러 가기" : "열기" } : { href: "/dashboard", label: "열기" });

  const href = (k: Filter) => link({ view: "risk", f: k !== "all" ? k : undefined });
  const search = <ParamSearch placeholder="프로젝트·PM·조직 검색" label="프로젝트 검색" reset={[]} />;
  const openHref = (r: Row) => (r.submitted.length ? "/closing" : "/dashboard");
  const openLabel = (r: Row) => (r.submitted.length && canApprove ? "승인하러 가기" : "열기");

  const card = (r: Row) => (
    <li key={r.id} className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-base font-semibold">{r.name}</span>
            {r.phaseLabel && <span className="badge badge-neutral shrink-0">{r.phaseLabel}</span>}
          </div>
          <div className="mt-0.5 truncate text-xs text-fg-muted">PM {r.pms.join(", ") || "-"} · {r.memberCount}명 · {r.departmentPath || "-"}</div>
        </div>
        <OpenProjectButton projectId={r.id} href={openHref(r)} label={openLabel(r)} />
      </div>
      {r.planned > 0 ? (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Rate r={r} />
            <PaceTag status={r.status} />
          </div>
          <Meter rate={r.rate} status={r.status} marker={r.timeRate} size="md" className="mt-1.5 w-full" />
          <div className="tabular mt-1.5 flex justify-between gap-2 text-xs text-fg-muted">
            <span>{won(r.spent)} / {won(r.planned)}</span>
            <span className={r.remaining < 0 ? "font-semibold text-status-rejected" : ""}>잔액 {won(r.remaining)}</span>
          </div>
        </>
      ) : <p className="mt-2 text-xs text-fg-muted">{r.hasBudget ? "배정 0원" : "예산 미등록"}</p>}
      {(isWaiting(r) || r.thisMonth) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
          {r.thisMonth && (
            <>
              <span className="text-fg-muted">이번 달</span>
              <StatusBadge status={monthPhase(r.thisMonth.ym, r.thisMonth.status, today)} />
              <span className="tabular text-fg-muted">{won(r.thisMonth.amount)}원</span>
            </>
          )}
          <Pending r={r} />
        </div>
      )}
    </li>
  );

  const tableRow = (r: Row) => (
    <tr key={r.id}>
      <td className="min-w-48">
        <div className="flex items-center gap-1.5 font-semibold">{r.name}{r.phaseLabel && <span className="badge badge-neutral">{r.phaseLabel}</span>}</div>
        <div className="max-w-60 truncate text-xs text-fg-muted" title={r.departmentPath}>{[r.code, r.departmentPath].filter(Boolean).join(" · ") || "-"}</div>
        <div className="text-xs text-fg-muted 2xl:hidden">PM {r.pms.join(", ") || "-"} · {r.memberCount}명</div>
      </td>
      <td className="hidden whitespace-nowrap 2xl:table-cell">{r.pms.join(", ") || "-"} <span className="text-xs text-fg-muted">· {r.memberCount}명</span></td>
      <td className="tabular hidden text-right 2xl:table-cell">{won(r.planned)}</td>
      <td className="tabular hidden text-right 2xl:table-cell">{won(r.spent)}</td>
      <td className={`tabular text-right ${r.remaining < 0 ? "font-semibold text-status-rejected" : ""}`}>{won(r.remaining)}</td>
      <td className="min-w-44">
        {r.planned > 0 ? (
          <div>
            <div className="flex items-center justify-between gap-2"><Rate r={r} /><PaceTag status={r.status} /></div>
            <Meter rate={r.rate} status={r.status} marker={r.timeRate} className="mt-1 w-full" />
            <div className="tabular mt-1 text-xs text-fg-muted 2xl:hidden">{won(r.spent)} / {won(r.planned)}</div>
          </div>
        ) : <span className="text-xs text-fg-muted">{r.hasBudget ? "배정 0원" : "예산 미등록"}</span>}
      </td>
      {/* 이번 달 + 처리 필요 (한 칸에 쌓아 표가 넘치지 않게) */}
      <td className="w-40">
        {r.thisMonth ? (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <StatusBadge status={monthPhase(r.thisMonth.ym, r.thisMonth.status, today)} />
            <span className="tabular text-xs text-fg-muted">{won(r.thisMonth.amount)}</span>
          </span>
        ) : <span className="text-xs text-fg-muted">기간 외</span>}
        {isWaiting(r) && <div className="mt-1 flex flex-col items-start gap-1 text-xs"><Pending r={r} short /></div>}
      </td>
      <td className="whitespace-nowrap text-right">
        <OpenProjectButton projectId={r.id} href={openHref(r)} label={openLabel(r)} />
      </td>
    </tr>
  );

  const table = (list: Row[]) => (
    <div className="card hidden overflow-x-auto md:block">
      <table className="table">
        <thead>
          <tr>
            <th>프로젝트</th><th className="hidden 2xl:table-cell">PM</th>
            <th className="hidden text-right 2xl:table-cell">배정</th><th className="hidden text-right 2xl:table-cell">집행</th><th className="text-right">잔액</th>
            <th>집행률 / 기간 경과</th><th>이번 달 · 처리 필요</th><th />
          </tr>
        </thead>
        <tbody>{list.map(tableRow)}</tbody>
      </table>
    </div>
  );

  return (
    <div>
      <PageHeader title="전체 프로젝트 현황" desc="프로젝트를 열면 그 프로젝트의 화면으로 바뀝니다.">
        <DeptTreeSelect depts={deptOptions} value={dept ?? null} total={all.length} />
      </PageHeader>

      <HqTodoPanel todos={todos} />

      {/* 전체 예산 — 잔액이 주인공(배정·사용·집행률은 보조), 기간 경과 비교 */}
      <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="전체 예산 잔액">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">전체 예산 · 프로젝트 {rows.length}개</h2>
          {timeRate !== null && <span className="tabular text-xs text-fg-muted">기간 경과(배정 가중) {timeRate}%</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm text-fg-muted">잔액</span>
          <span className={`tabular text-amount font-bold tracking-tight ${planned - spent < 0 ? "text-status-rejected" : ""}`}>{won(planned - spent)}<span className="ml-0.5 text-base font-semibold">원</span></span>
          {overCount > 0 && <span className="badge badge-bad">초과 프로젝트 {overCount}</span>}
        </div>
        <p className="tabular mt-0.5 text-sm text-fg-muted">
          배정 {won(planned)}원 중 <b className="font-semibold text-fg">{won(spent)}원</b> 집행{rate !== null && ` · ${rate}%`}
        </p>
        <Meter rate={rate} marker={timeRate} size="lg" className="mt-3 w-full" label="전체 집행률" />
        <p className="mt-2 text-xs text-fg-muted">세로 눈금 = 기간 경과</p>
      </section>

      {/* 보기 전환: 월별 마감 현황(안 끝난 곳 먼저) / 예산 위험순 */}
      <nav className="seg mb-3" aria-label="보기">
        <Link href={link({ ym: ymParam })} aria-current={view === "month" ? "page" : undefined}>월별 마감 현황</Link>
        <Link href={link({ view: "risk" })} aria-current={view === "risk" ? "page" : undefined}>예산 위험순</Link>
      </nav>

      {view === "month" ? (
        <>
          <ListToolbar label="월별 마감 현황 도구" search={search} filters={<>
            <div className="flex items-center">
              {prevYm ? <Link href={link({ ym: prevYm, st })} aria-label="이전 달" className="flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface sm:size-9"><Icon name="prev" className="size-4" /></Link> : <span className="size-10 sm:size-9" />}
              <h2 className="tabular text-title font-bold">{ymKo(ym)}</h2>
              {nextYm ? <Link href={link({ ym: nextYm, st })} aria-label="다음 달" className="flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface sm:size-9"><Icon name="next" className="size-4" /></Link> : <span className="size-10 sm:size-9" />}
            </div>
            {movedToPending && <span className="text-sm text-fg-muted">승인 대기가 있는 달 · <Link href={link({ ym: currentYearMonth(), st })} className="font-semibold text-primary hover:underline">이번 달 보기</Link></span>}
            <nav className="seg" aria-label="마감 상태 필터">
              <Link href={link({ ym: ymParam })} aria-current={!stFilter ? "page" : undefined}>전체 <span className="tabular text-xs text-fg-muted">{boardTotal}</span></Link>
              {BOARD_ORDER.map((k) => (
                <Link key={k} href={link({ ym: ymParam, st: k })} aria-current={stFilter === k ? "page" : undefined}>
                  <span className={k === "REJECTED" && board.counts[k] ? "text-status-rejected" : ""}>{boardLabel(k, ym, today)}</span> <span className="tabular text-xs text-fg-muted">{board.counts[k]}</span>
                </Link>
              ))}
            </nav>
          </>} />
          {board.list.length === 0 ? (
            <div className="card"><Empty>{q ? "검색에 맞는 프로젝트가 없어요." : stFilter ? "해당 상태의 프로젝트가 없어요." : "이 달이 기간에 들어가는 프로젝트가 없어요."}</Empty></div>
          ) : (
            <>
              {/* 모바일 */}
              <ul className="card divide-y divide-line overflow-hidden md:hidden">
                {board.list.map((r) => {
                  const flagged = r.flagged[ym] ?? 0;
                  const open = openOf(r.monthStatus);
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <StatusBadge status={monthPhase(ym, r.monthStatus, today)} />
                            <span className="truncate text-base font-semibold">{r.name}</span>
                          </div>
                          <div className="tabular mt-0.5 text-sm text-fg-muted">
                            {Number(ym.slice(5))}월 지출 {won(r.monthSpent[ym] ?? 0)}원
                            {flagged > 0 && <span className="font-semibold text-amber-800"> · 규정 점검 {flagged}건</span>}
                          </div>
                        </div>
                        <OpenProjectButton projectId={r.id} href={open.href} label={open.label} />
                      </div>
                      {r.planned > 0 ? (
                        <>
                          <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-fg-muted">
                            <span className="tabular">잔액 <b className={`text-sm ${r.remaining < 0 ? "text-status-rejected" : "text-fg"}`}>{won(r.remaining)}원</b></span>
                            <span className="tabular">{r.rate ?? 0}% / 경과 {r.timeRate}%</span>
                          </div>
                          <Meter rate={r.rate} status={r.status} marker={r.timeRate} className="mt-1 w-full" />
                        </>
                      ) : <p className="mt-1 text-xs text-fg-muted">{r.hasBudget ? "배정 0원" : "예산 미등록"}</p>}
                    </li>
                  );
                })}
              </ul>
              {/* 넓은 화면 */}
              <div className="card hidden overflow-x-auto md:block">
                <table className="table">
                  <thead>
                    <tr><th>마감 상태</th><th>프로젝트</th><th className="text-right">{Number(ym.slice(5))}월 지출</th><th className="text-right">규정 점검</th><th>집행률 / 기간 경과</th><th className="text-right">잔액</th><th /></tr>
                  </thead>
                  <tbody>
                    {board.list.map((r) => {
                      const flagged = r.flagged[ym] ?? 0;
                      const open = openOf(r.monthStatus);
                      return (
                        <tr key={r.id}>
                          <td className="w-24"><StatusBadge status={monthPhase(ym, r.monthStatus, today)} /></td>
                          <td className="min-w-48">
                            <div className="font-semibold">{r.name}</div>
                            <div className="max-w-72 truncate text-xs text-fg-muted">PM {r.pms.join(", ") || "-"} · {r.departmentPath || "-"}</div>
                          </td>
                          <td className={`tabular text-right ${r.monthSpent[ym] ? "" : "text-fg-subtle"}`}>{dash0(r.monthSpent[ym] ?? 0)}</td>
                          <td className={`tabular text-right ${flagged ? "font-semibold text-amber-800" : "text-fg-subtle"}`}>{flagged ? `${flagged}건` : "-"}</td>
                          <td className="min-w-44">
                            {r.planned > 0 ? (
                              <div>
                                <div className="flex items-center justify-between gap-2"><Rate r={r} /><PaceTag status={r.status} /></div>
                                <Meter rate={r.rate} status={r.status} marker={r.timeRate} className="mt-1 w-full" />
                              </div>
                            ) : <span className="text-xs text-fg-muted">{r.hasBudget ? "배정 0원" : "예산 미등록"}</span>}
                          </td>
                          <td className={`tabular text-right font-semibold ${r.remaining < 0 ? "text-status-rejected" : ""}`}>{won(r.remaining)}</td>
                          <td className="whitespace-nowrap text-right"><OpenProjectButton projectId={r.id} href={open.href} label={open.label} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="mt-3 text-sm text-fg-muted">
            안 끝난 곳 먼저: 작성중 → 반려 → 마감 → 상신 → 승인.{board.outside > 0 && ` 이 달이 기간 밖인 프로젝트 ${board.outside}개는 빠져 있습니다.`}
          </p>
        </>
      ) : (
        <>
      {/* 목록 필터 (위험순 정렬) */}
      <ListToolbar label="예산 위험순 도구" search={search} filters={<>
        <nav className="seg" aria-label="목록 필터">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={href(k)} aria-current={filter === k ? "page" : undefined}>
              {label} <span className="tabular text-xs text-fg-muted">{counts[k]}</span>
            </Link>
          ))}
        </nav>
        <span className="text-xs text-fg-muted">위험순 정렬 · 초과 → 빠름 → 처리 대기 → 초과 예상 → 느림 → 정상</span>
      </>} />

      {main.length === 0 && quiet.length === 0 ? (
        <div className="card"><Empty>{q ? "검색에 맞는 프로젝트가 없어요." : filter !== "all" ? "주의할 프로젝트가 없어요." : dept ? "이 조직에 프로젝트가 없어요." : "아직 프로젝트가 없어요."}</Empty></div>
      ) : (
        <>
          {main.length > 0 && (
            <>
              <ul className="space-y-3 md:hidden">{main.map(card)}</ul>
              {table(main)}
            </>
          )}
          {quiet.length > 0 && (
            <details className="group mt-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-fg-muted hover:text-fg">
                <span className="transition group-open:rotate-90" aria-hidden>›</span>
                예산 미등록·시작 전·종료 {quiet.length}개
              </summary>
              <ul className="mt-2 space-y-3 md:hidden">{quiet.map(card)}</ul>
              <div className="mt-2">{table(quiet)}</div>
            </details>
          )}
        </>
      )}
      <p className="mt-3 text-sm text-fg-muted">
        상태: 배정 초과 = 빨강 · 기간 경과보다 10%p 넘게 빠름·종료 시 초과 예상 = 경고색 · 20%p 넘게 느림·정상 = 색 없음.
      </p>
        </>
      )}
    </div>
  );
}
