import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { summarize } from "@/lib/directory";
import { applyPlan, buildPlan, fetchSoliday, parseUpload, previewSamples, solidayConfig } from "@/lib/directory-sync";

/** 연동 상태: API 토큰 설정 여부, 마지막 동기화 */
export const GET = route(async () => {
  await apiUser(["ADMIN"]);
  const cfg = solidayConfig();
  const last = await prisma.auditLog.findFirst({ where: { entity: "Directory", action: "sync" }, orderBy: { createdAt: "desc" } });
  const [syncedUsers, syncedDepts, pending] = await Promise.all([
    prisma.user.count({ where: { externalSource: "soliday" } }),
    prisma.department.count({ where: { externalSource: "soliday" } }),
    prisma.directoryImport.findFirst({
      where: { appliedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, deptCount: true, userCount: true, createdAt: true },
    }),
  ]);
  return NextResponse.json({
    source: "Soliday",
    baseUrl: cfg.baseUrl,
    apiConfigured: cfg.configured,
    lastSync: last ? { at: last.createdAt, summary: last.data ? JSON.parse(last.data) : null } : null,
    syncedUsers,
    syncedDepts,
    pending,
  });
});

/**
 * 조직도 동기화 (시스템 관리자)
 * body: { mode: "api" | "upload", dryRun?: boolean, departments?, employees? }
 *  - api: 서버가 Soliday API를 직접 호출 (SOLIDAY_API_TOKEN 필요)
 *  - upload: Soliday의 /api/departments, /api/org/employees 응답 JSON을 올리기
 *  - pending: Soliday 화면에서 전송 링크로 보낸 데이터 (importId)
 *  - dryRun: 변경 계획만 미리보기
 */
export const POST = route(async (req) => {
  const admin = await apiUser(["ADMIN"]);
  const body = await readJson<{ mode?: string; dryRun?: boolean; departments?: unknown; employees?: unknown; importId?: string; departmentsOnly?: boolean }>(req);
  const deptOnly = !!body.departmentsOnly;
  let pending: { id: string } | null = null;
  let raw;
  if (body.mode === "api") raw = await fetchSoliday();
  else if (body.mode === "pending") {
    const imp = await prisma.directoryImport.findUnique({ where: { id: body.importId ?? "" } });
    if (!imp || imp.appliedAt) throw new HttpError(404, "적용할 전송 데이터가 없습니다. Soliday에서 다시 보내 주세요.");
    pending = imp;
    raw = parseUpload({ departments: JSON.parse(imp.departments), employees: JSON.parse(imp.employees) });
  } else raw = parseUpload(body, deptOnly);
  const { src, plan } = await buildPlan(raw, deptOnly);
  const summary = summarize(plan);
  if (body.dryRun) {
    return NextResponse.json({ dryRun: true, summary, samples: previewSamples(plan), source: { departments: src.departments.length, users: src.users.length } });
  }
  const warnings = await applyPlan(src, plan);
  if (pending) await prisma.directoryImport.update({ where: { id: pending.id }, data: { appliedAt: new Date() } });
  const result = { ...summary, warnings, mode: body.mode ?? "upload", departmentsOnly: deptOnly };
  await audit(admin, { entity: "Directory", entityId: "soliday", action: "sync", data: result });
  return NextResponse.json({ dryRun: false, summary: result });
});
