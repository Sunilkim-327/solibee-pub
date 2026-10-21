import { NextResponse } from "next/server";
import { apiUser, assertProjectRole, route } from "@/lib/access";
import { getDashboard } from "@/lib/reports";

type Params = { id: string };

/** 예산 대비 집행 현황 (PM/재무 승인) */
export const GET = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  await assertProjectRole(await apiUser(), id, ["MANAGER", "HQ", "ADMIN"]);
  return NextResponse.json(await getDashboard(id));
});
