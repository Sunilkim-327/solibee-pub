import { redirect } from "next/navigation";
import { pageContext } from "@/lib/access";
import { settlementRedirect } from "@/lib/page-access";

/**
 * 예전 '내 정산' 주소 — 현황(/dashboard)의 정산 구역(#settle)으로 보낸다.
 * 팀원: 내 지출 내역 아래 월별 정산(받을 돈·본인 부담 공제) / PM·재무 승인: 팀원별 정산 (달·범위 유지)
 */
export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ ym?: string; scope?: string }> }) {
  const { user } = await pageContext();
  const { scope, ym } = await searchParams;
  redirect(settlementRedirect(user.role, { ym, scope }));
}
