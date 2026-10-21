import { NextResponse } from "next/server";
import { audit, projectWriter, route } from "@/lib/access";
import { assertPassUnlocked, deletePassUpload, findStatement } from "@/lib/pass-statement-server";

type Params = { id: string };

/** 그 달 올린 내역 전체 삭제 (출입증 내역도 삭제 → '올리기 전') — 확정 전·마감 전 달, 이 프로젝트 PM만 */
export const DELETE = route<Params>(async (_req, { params }) => {
  const { id } = await params;
  const st = await findStatement(id);
  const { user } = await projectWriter(st.projectId, ["MANAGER"]);
  await assertPassUnlocked(st.projectId, st.yearMonth);
  const r = await deletePassUpload(id);
  await audit(user, { projectId: st.projectId, entity: "PassStatement", entityId: id, action: "delete", data: r });
  return NextResponse.json(r);
});
