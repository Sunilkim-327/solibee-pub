import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, route } from "@/lib/access";
import { isYearMonth } from "@/lib/format";
import { getSettlement } from "@/lib/reports";
import { canSeeAllRows } from "@/lib/rules";

type Params = { id: string };

/** 팀원별 정산 집계 (?ym=) — 팀원은 본인 금액만, 상위 PM·조직장 조회는 불가 */
export const GET = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id);
  if (user.readOnlyReason === "view") throw new HttpError(403, "조회 권한으로는 팀원별 정산을 볼 수 없습니다.");
  const ym = new URL(req.url).searchParams.get("ym");
  if (!isYearMonth(ym)) throw new HttpError(400, "ym은 YYYY-MM 형식입니다.");
  const s = await getSettlement(id, ym);
  if (canSeeAllRows(user)) return NextResponse.json(s);
  return NextResponse.json({ yearMonth: ym, rows: s.rows.filter((r) => r.id === user.id) });
});
