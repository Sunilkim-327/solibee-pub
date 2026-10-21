// 팀원 '내 지출 내역'의 [카드 | 출입증] 탭과 출입증 탭 본문 (서버 컴포넌트).
// 출입증은 팀원이 입력하는 것이 아니라 업체 내역(PM이 올림)의 내 사용분을 확인하고 업무로 쓴 건에 '업무 사용'을 표시하는 것 —
// 법인카드 경비 서비스의 '사용내역 확인(업무용/개인용)'과 같은 성격이라 입력 화면이 아니라 내역 화면에 둔다.
import Link from "next/link";
import { MyPassLines } from "@/components/PassForm";
import { MarkPassSeen } from "@/components/PassCheckBanner";
import { passPeriodLabel, type PassItem } from "@/lib/pass-statement";
import { ymKo } from "@/lib/format";
import { passCheckHref } from "@/lib/page-access";
import type { PassLineRow, PassStatementInfo } from "@/lib/dto";
import type { ClosingStatus } from "@/lib/types";

const ICON_CARD = "M3 6h18v12H3zM3 10h18M7 15h4";
const ICON_PASS = "M4 5h16v14H4zM8 9h4M8 13h6M16 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z";
function TabIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** 내 지출 내역 [카드 | 출입증] — 출입증 쓰는 프로젝트만. ym: 지금 보는 달 (탭을 바꿔도 같은 달에서 시작) */
export function LedgerTabs({ pass, passName, cardYm, passYm }: { pass: boolean; passName: string; cardYm?: string; passYm?: string }) {
  return (
    <nav className="seg mb-4 flex w-full" aria-label="내역 종류">
      <Link href={cardYm ? `/dashboard?ym=${cardYm}` : "/dashboard"} className="flex-1" aria-current={!pass ? "page" : undefined}><TabIcon d={ICON_CARD} />카드</Link>
      <Link href={passCheckHref(passYm)} className="flex-1" aria-current={pass ? "page" : undefined}><TabIcon d={ICON_PASS} />{passName}</Link>
    </nav>
  );
}

export type MyPassMonth = {
  ym: string;
  /** 내 사용분이 있는 출입증 내역 월 (오래된 달부터) */
  months: string[];
  /** closingStatus: 그 달 마감 상태 (마감·상신·승인이면 확정 전이어도 표시를 바꿀 수 없다) */
  data: { statement: PassStatementInfo; lines: PassLineRow[]; closingStatus: ClosingStatus } | null;
  mine: PassLineRow[];
  items: PassItem[];
  startDay: number;
};

/** 출입증 탭 본문 — 내역 월(정산 기간 표기) + 내 사용 내역 확인·업무 사용 표시. 월 이동은 화면 머리글(MonthNav, 내 사용분이 올라온 달만) */
export function MyPassPanel({ projectId, userId, passName, pass }: { projectId: string; userId: string; passName: string; pass: MyPassMonth }) {
  const { ym, data, mine, items, startDay } = pass;
  const confirmed = data?.statement.status === "CONFIRMED";
  return (
    <section className="card px-4 py-4 sm:px-5" aria-label={`${ymKo(ym)} ${passName} 사용 내역`}>
      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="tabular text-title font-bold">{ymKo(ym)}</h2>
        {data && (confirmed ? <span className="badge badge-ok">확정</span> : <span className="badge badge-warn">확정 전</span>)}
        <span className="tabular ml-auto text-xs text-fg-muted">{passPeriodLabel(ym, startDay)} 사용분</span>
      </div>
      {!data ? (
        <p className="rounded-xl bg-surface-muted px-4 py-8 text-center text-sm text-fg-muted">
          PM이 업체 사용 내역을 올리면 여기서 내 사용분을 확인하고 &lsquo;업무 사용&rsquo;을 표시할 수 있어요.
        </p>
      ) : mine.length === 0 ? (
        <p className="rounded-xl bg-surface-muted px-4 py-8 text-center text-sm text-fg-muted">{ymKo(ym)} 업체 내역에 내 사용분이 없어요. 사용했는데 보이지 않으면 PM에게 알려 주세요.</p>
      ) : (
        <MyPassLines lines={mine} confirmed={confirmed} passName={passName} items={items} closingStatus={data.closingStatus} />
      )}
      {/* 이 달을 열어 봤음 — 지출 입력 화면의 확인 안내에서 이 달을 뺀다 */}
      {data && <MarkPassSeen projectId={projectId} userId={userId} ym={ym} />}
    </section>
  );
}
