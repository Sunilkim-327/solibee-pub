import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, route } from "@/lib/access";
import { assertPassUnlocked, deletePassUpload, findStatement } from "@/lib/pass-statement-server";

type Params = { id: string };

/**
 * 올린 내역 한 묶음(업체 + 구분) 삭제 — 확정 전·마감 전 달, 이 프로젝트 PM만 (?vendor=업체&label=구분, 업체 미지정 줄은 vendor 없이)
 * 그 묶음의 회사 부담·공제 결정과 팀원 신청도 함께 지워진다. 줄이 남지 않으면 출입증 내역도 지워 그 달은 '올리기 전'으로
 */
export const DELETE = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const st = await findStatement(id);
  const { user } = await projectWriter(st.projectId, ["MANAGER"]);
  await assertPassUnlocked(st.projectId, st.yearMonth);
  const q = new URL(req.url).searchParams;
  const label = q.get("label");
  if (label === null || label.length > 100) throw new HttpError(400, "지울 구분을 고르세요.");
  const vendor = q.get("vendor") || null;
  const r = await deletePassUpload(id, { vendor, label });
  await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: "delete-lines", data: r });
  return NextResponse.json(r);
});
