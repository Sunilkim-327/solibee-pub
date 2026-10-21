import { NextResponse } from "next/server";
import { HttpError, audit, projectWriter, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { str } from "@/lib/validate";

type Params = { id: string };

/** 출입증 사용 설정 (이 프로젝트 PM — PM 설정 화면): { enabled, name } — 회사 부담 항목은 재무 승인이 pass-items에서 */
export const PUT = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await projectWriter(id, ["MANAGER"]);
  const { enabled, name } = await readJson<{ enabled?: boolean; name?: unknown }>(req);
  const passName = str(name, "출입증 이름", 40) ?? null;
  if (enabled && !passName) throw new HttpError(400, "출입증 이름을 입력하세요. (예: 고객사 출입증)");
  const project = await prisma.project.update({
    where: { id },
    data: { clientPassEnabled: !!enabled, clientPassName: passName },
    select: { clientPassEnabled: true, clientPassName: true },
  });
  await audit(user, { projectId: id, entity: "Project", entityId: id, action: "update", data: { clientPass: project } });
  return NextResponse.json(project);
});
