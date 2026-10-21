import { redirect } from "next/navigation";
import { legacyRedirect } from "@/lib/page-access";

/**
 * 월별 현황은 현황(/dashboard)의 지출 내역으로 합쳤다 — 예전 주소·즐겨찾기는 미들웨어가 쿼리째 옮긴다.
 * 미들웨어를 거치지 않은 경우를 위한 예비 이동.
 */
export default async function MonthlyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of [v].flat()) if (x !== undefined) q.append(k, x);
  redirect(legacyRedirect("/monthly", q.toString()) ?? "/dashboard");
}
