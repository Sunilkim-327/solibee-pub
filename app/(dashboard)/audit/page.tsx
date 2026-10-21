import Link from "next/link";
import { PageHeader, Empty } from "@/components/common";
import { DateField } from "@/components/DatePicker";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { AUDIT_GROUPS, auditActionLabel, auditEntityLabel, auditRange } from "@/lib/audit-labels";
import { chip } from "@/components/ui";
import { ListRow } from "@/components/list/ListRow";
import { DayGroup } from "@/components/list/DayGroup";
import { ListToolbar } from "@/components/list/ListToolbar";
import { ParamSelect } from "@/components/list/ParamControls";
import { kstParts } from "@/components/list/model";
import { shortDate, shortDateTime } from "@/lib/format";

const PAGE = 50;
const FAIL_ACTIONS = ["login-fail", "locked"];
const GROUPS: [string, string][] = [["", "전체"], ["access", "접속"], ["admin", "시스템 관리 작업"], ["data", "데이터 변경"], ["download", "다운로드"]];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ g?: string; from?: string; to?: string; fail?: string; cursor?: string; u?: string }> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  // KST 날짜 기준. 잘못된 날짜는 기본 기간(최근 30일)으로
  const range = auditRange(sp.from, sp.to);
  const group = sp.g && Object.prototype.hasOwnProperty.call(AUDIT_GROUPS, sp.g) ? sp.g : "";
  const failOnly = sp.fail === "1";
  const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);
  const cursor = isId(sp.cursor) ? sp.cursor : "";
  /** 사용자 필터 (?u=userId) — 색인 (userId, createdAt) */
  const userId = isId(sp.u) ? sp.u : "";

  const base = {
    createdAt: { gte: range.gte, lte: range.lte },
    ...(userId ? { userId } : {}),
    ...(group ? { entity: { in: AUDIT_GROUPS[group] } } : {}),
  };
  const where = failOnly ? { ...base, action: { in: FAIL_ACTIONS } } : base;
  const [page, total, failures, users, projects] = await Promise.all([
    // 50건씩 (커서: 이전 페이지 마지막 기록 id)
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.count({ where: { ...base, action: { in: FAIL_ACTIONS } } }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ select: { id: true, name: true } }),
  ]);
  const logs = page.slice(0, PAGE);
  const next = page.length > PAGE ? logs[logs.length - 1].id : null;
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const isFail = (action: string) => FAIL_ACTIONS.includes(action);
  const who = (l: (typeof logs)[number]) => userName.get(l.userId) ?? (l.userId === "anonymous" ? `미등록 ID (${l.entityId})` : l.userId);

  /** 현재 조건을 유지한 주소 (바꿀 값만 덮어쓰기, 페이지는 처음으로) */
  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const v = { g: group, from: sp.from ? range.fromDay : undefined, to: sp.to ? range.toDay : undefined, fail: failOnly ? "1" : undefined, u: userId || undefined, ...over };
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val);
    return `/audit${q.size ? `?${q}` : ""}`;
  };
  const rows = logs.map((l) => ({ ...l, kst: kstParts(l.createdAt) }));

  return (
    <div>
      <PageHeader title="접속·변경 기록"
        desc="로그인·계정·데이터 변경·다운로드 기록입니다. 추가만 되고 수정·삭제할 수 없습니다." />

      {/* 구분 탭 + 로그인 실패 칩 + 사용자 */}
      <ListToolbar label="기록 필터" filters={<>
        <nav className="seg" aria-label="구분">
          {GROUPS.map(([g, label]) => (
            <Link key={g || "all"} href={href({ g: g || undefined })} aria-current={group === g ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <Link href={href({ fail: failOnly ? undefined : "1" })}
          className={`${chip(failOnly)} gap-1 ${!failOnly && failures > 0 ? "!border-rose-200 !text-rose-700" : ""}`}>
          로그인 실패 <span className="tabular">{failures}</span>{failOnly && <span aria-hidden>✕</span>}
        </Link>
      </>} sort={<ParamSelect param="u" value={userId} label="사용자" options={[["", "전체 사용자"], ...users.map((u) => [u.id, u.name] as const)]} />} />

      {/* 기간: 모바일은 접어 두고(요약 한 줄), 넓은 화면은 펼쳐 둔다 */}
      <details className="group mb-4 sm:hidden" open={!!(sp.from || sp.to)}>
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm text-fg-muted [&::-webkit-details-marker]:hidden">
          기간 <b className="tabular font-semibold text-fg">{shortDate(range.fromDay)} ~ {shortDate(range.toDay)}</b>
          <span aria-hidden className="transition-transform group-open:rotate-180">▾</span>
        </summary>
        <form className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          {group && <input type="hidden" name="g" value={group} />}
          {failOnly && <input type="hidden" name="fail" value="1" />}
          {userId && <input type="hidden" name="u" value={userId} />}
          <div className="min-w-0"><DateField name="from" defaultValue={range.fromDay} label="시작일" /></div>
          <span className="text-fg-muted">~</span>
          <div className="min-w-0"><DateField name="to" defaultValue={range.toDay} label="종료일" /></div>
          <button className="btn-secondary col-span-3">조회</button>
        </form>
      </details>
      <form className="mb-4 hidden flex-wrap items-center gap-2 sm:flex">
        {group && <input type="hidden" name="g" value={group} />}
        {failOnly && <input type="hidden" name="fail" value="1" />}
        {userId && <input type="hidden" name="u" value={userId} />}
        <div className="w-44"><DateField name="from" defaultValue={range.fromDay} label="시작일" className="py-1.5 text-sm" /></div>
        <span className="text-fg-muted">~</span>
        <div className="w-44"><DateField name="to" defaultValue={range.toDay} label="종료일" className="py-1.5 text-sm" /></div>
        <button className="btn-secondary">조회</button>
      </form>
      <p className="mb-2 text-xs text-fg-muted">
        <span className="tabular">{total}건</span> 중 {cursor ? "다음 " : "최근 "}<span className="tabular">{logs.length}</span>건
      </p>

      {logs.length === 0 ? (
        <div className="card"><Empty>{userId ? "이 사용자의 기록이 없어요." : failOnly ? "이 기간에 로그인 실패 기록이 없어요." : "이 기간에 기록이 없어요."}</Empty></div>
      ) : (
        <>
          {/* 모바일: 날짜별 2줄 행 */}
          <div className="card overflow-clip md:hidden">
            <DayGroup items={rows} dateOf={(l) => l.kst.day} sticky="surface" band headClassName="px-4" inset="text"
              right={(g) => <span className="font-medium">{g.items.length}건</span>}
              render={(l) => (
                <ListRow key={l.id} accent={isFail(l.action) ? "bad" : undefined}
                  title={<>{who(l)} <span className={isFail(l.action) ? "text-status-rejected" : "text-fg-2"}>· {auditActionLabel(l.action)}</span></>}
                  meta={<span className="tabular truncate">{[l.kst.time, auditEntityLabel(l.entity), l.projectId ? projectName.get(l.projectId) : null, l.ip].filter(Boolean).join(" · ")}</span>} />
              )} />
          </div>

          {/* 넓은 화면: 표 (머리글 고정) */}
          <div className="card hidden overflow-x-clip md:block">
            <table className="table">
              <thead className="sticky top-14 z-[5] lg:top-16">
                <tr><th>일시</th><th>사용자</th><th>구분</th><th>작업</th><th>프로젝트</th><th>IP</th></tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={`h-10 ${isFail(l.action) ? "bg-rose-50/50" : ""}`}>
                    <td className="tabular !py-1.5 whitespace-nowrap text-fg-muted">{shortDateTime(l.createdAt)}</td>
                    <td className="!py-1.5 whitespace-nowrap">{who(l)}</td>
                    <td className="!py-1.5 text-fg-muted">{auditEntityLabel(l.entity)}</td>
                    <td className={`!py-1.5 ${isFail(l.action) ? "font-semibold text-status-rejected" : ""}`}>{auditActionLabel(l.action)}</td>
                    <td className="!py-1.5 text-fg-muted">{l.projectId ? projectName.get(l.projectId) ?? "" : ""}</td>
                    <td className="tabular !py-1.5 text-fg-muted">{l.ip ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(cursor || next) && (
        <nav className="mt-4 flex items-center justify-between gap-2" aria-label="페이지">
          {cursor ? <Link href={href({})} className="btn-secondary btn-sm">« 처음으로</Link> : <span />}
          {next && <Link href={href({ cursor: next })} className="btn-secondary">다음 {PAGE}건 ›</Link>}
        </nav>
      )}
    </div>
  );
}
