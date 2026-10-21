import { NextResponse } from "next/server";
import { HttpError, apiUser, assertProjectRole, route } from "@/lib/access";
import { isYearMonth } from "@/lib/format";
import { listPassUsages } from "@/lib/pass-server";

type Params = { id: string };

/** 이전 방식 출입증 사용 목록 (?ym=, 조회 전용) — 팀원은 본인 건 */
export const GET = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id);
  const ym = new URL(req.url).searchParams.get("ym");
  if (!isYearMonth(ym)) throw new HttpError(400, "ym은 YYYY-MM 형식입니다.");
  return NextResponse.json(await listPassUsages(user, id, ym));
});
