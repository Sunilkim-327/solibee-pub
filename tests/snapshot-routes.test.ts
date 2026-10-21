// 상신본·승인본 스냅샷 — 실제 라우트 (e2e.db를 임시 파일로 복사해 가상의 프로젝트·사람을 넣고 호출한다) 설계 검토(2026-10-14) P0-2
// - 마감 기록에 총합계 → 마감 후 지출이 바뀌면 상신 409
// - 상신·승인 직후 스냅샷 저장(version 1), 응답 snapshot {id, version}
// - 승인된 달 엑셀(?ym=)은 저장된 승인본 파일 그대로 (X-Snapshot, 바이트·SHA-256 일치), ?live=1은 재무만
// - 스냅샷 내려받기 라우트, 결재 문서번호 PATCH, 승인된 달이 있는 예산 PUT의 사유 필수
// e2e.db·dev.db는 바꾸지 않는다. e2e.db가 없으면 건너뛴다.
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SRC = path.resolve(__dirname, "../prisma/e2e.db");
const has = existsSync(SRC);
const TMP = path.join(os.tmpdir(), `solibee-snapshot-${process.pid}-${Date.now()}.db`);
if (has) {
  const src = new DatabaseSync(SRC, { readOnly: true });
  src.exec(`VACUUM INTO '${TMP.replace(/'/g, "''")}'`);
  src.close();
  process.env.DATABASE_URL = `file:${TMP.split(path.sep).join("/")}`;
}

let token: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "opex_session" && token ? { value: token } : undefined) }),
  headers: async () => new Headers(),
}));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ids = { pm: "", hq: "", project: "", item: "", expense: "", closing: "" };
let closingRoute: { POST: Handler };
let reviewRoute: { POST: Handler };
let exportRoute: { GET: Handler };
let snapshotRoute: { GET: Handler };
let closingPatch: { PATCH: Handler };
let budgetRoute: { PUT: Handler };
let as: (userId: string) => void;
let db: typeof import("@/lib/db").prisma;

const YM = "2026-03";
const json = async (h: Handler, params: Record<string, string>, init: RequestInit = {}) => {
  const res = await h(new Request("http://localhost/api", { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};
const file = async (h: Handler, url: string, params: Record<string, string>) => {
  const res = await h(new Request(url), { params: Promise.resolve(params) });
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const cd = res.headers.get("content-disposition") ?? "";
  const filename = decodeURIComponent(cd.replace(/^.*filename\*=UTF-8''/, ""));
  return { status: res.status, buf, filename, snapshot: res.headers.get("x-snapshot"), error: res.ok ? null : await res.json().catch(() => null) };
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => {
  if (!has) return;
  const { prisma } = await import("@/lib/db");
  db = prisma;
  const { createSessionToken } = await import("@/lib/session");
  as = (userId: string) => { token = createSessionToken(userId, 0); };
  const user = (name: string, role: string, position: string) => prisma.user.create({ data: { name, role, position, passwordHash: "x", loginId: `${name}-${Date.now()}@test.local` } });
  const [pm, hq] = await Promise.all([user("가상PM", "MANAGER", "팀장"), user("가상재무", "HQ", "책임")]);
  const project = await prisma.project.create({ data: { name: "가상 스냅샷", startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), fiscalStart: 1 } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: pm.id, isPm: true, isPayer: true } });
  const cat = await prisma.category.findFirstOrThrow({ where: { id: { not: "client-pass" } }, orderBy: { order: "asc" } });
  const item = await prisma.item.create({ data: { projectId: project.id, categoryId: cat.id, name: "가상 야근식대", code: "snap-01", needsAttendees: false } });
  await prisma.budgetLine.create({ data: { projectId: project.id, itemId: item.id, detail: "가상", unitPrice: 100_000, periods: 12, planned: 1_200_000 } });
  const e = await prisma.expense.create({
    data: { projectId: project.id, payerId: pm.id, date: new Date("2026-03-10T00:00:00Z"), amount: 12_000, payMethod: "PERSONAL_CARD", itemId: item.id, detail: "가상 지출", yearMonth: YM, createdBy: pm.id },
  });
  Object.assign(ids, { pm: pm.id, hq: hq.id, project: project.id, item: item.id, expense: e.id });
  closingRoute = await import("@/app/api/projects/[id]/closings/[ym]/[action]/route") as unknown as typeof closingRoute;
  reviewRoute = await import("@/app/api/closings/[id]/review/route") as unknown as typeof reviewRoute;
  exportRoute = await import("@/app/api/projects/[id]/export/route") as unknown as typeof exportRoute;
  snapshotRoute = await import("@/app/api/closings/[id]/snapshots/[sid]/route") as unknown as typeof snapshotRoute;
  closingPatch = await import("@/app/api/closings/[id]/route") as unknown as typeof closingPatch;
  budgetRoute = await import("@/app/api/projects/[id]/budget/route") as unknown as typeof budgetRoute;
}, 60_000);

afterAll(async () => {
  if (!has) return;
  await db.$disconnect();
  rmSync(TMP, { force: true });
});

describe.skipIf(!has)("상신본·승인본 스냅샷 — API", () => {
  it("마감 기록에 총합계가 남고, 마감 후 지출이 바뀌면 상신 409 — 되돌리면 상신되고 상신본 v1 저장", async () => {
    as(ids.pm);
    const closed = await json(closingRoute.POST, { id: ids.project, ym: YM, action: "close" }, { method: "POST" });
    expect(closed.status).toBe(200);
    ids.closing = closed.body!.id as string;
    const log = await db.auditLog.findFirst({ where: { entity: "MonthlyClosing", entityId: ids.closing, action: "close" }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(log!.data!)).toMatchObject({ from: "DRAFT", to: "CLOSED", total: 12_000, hq: 0, pass: 0 });

    // 마감 뒤 지출이 바뀐 상황 (API는 403으로 막지만, 출입증 확정 취소·직접 변경 등) → 상신 전 감지
    await db.expense.update({ where: { id: ids.expense }, data: { amount: 15_000 } });
    const drift = await json(closingRoute.POST, { id: ids.project, ym: YM, action: "submit" }, { method: "POST" });
    expect(drift.status).toBe(409);
    expect(drift.body?.error).toContain("마감 12,000원 → 지금 15,000원");
    await db.expense.update({ where: { id: ids.expense }, data: { amount: 12_000 } });

    const submitted = await json(closingRoute.POST, { id: ids.project, ym: YM, action: "submit" }, { method: "POST" });
    expect(submitted.status).toBe(200);
    expect(submitted.body?.status).toBe("SUBMITTED");
    expect(submitted.body?.snapshot).toMatchObject({ version: 1 });
    const snaps = await db.closingSnapshot.findMany({ where: { closingId: ids.closing }, select: { kind: true, version: true, size: true, sha256: true, fileName: true, summary: true } });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ kind: "SUBMIT", version: 1 });
    expect(snaps[0].fileName).toMatch(/운영비\(26\.03\)_상신_\d{4}-\d{2}-\d{2} \d{4}\.xlsx$/);
    expect(JSON.parse(snaps[0].summary)).toMatchObject({ ym: YM, total: 12_000, hq: 0, sharedCard: 0, groupIds: [ids.project] });
  });

  it("상신된 달의 엑셀(?ym=)은 저장된 상신본 그대로 (X-Snapshot submit/v1, 바이트·SHA-256 일치)", async () => {
    as(ids.pm);
    const r = await file(exportRoute.GET, `http://localhost/api?ym=${YM}`, { id: ids.project });
    expect(r.status).toBe(200);
    expect(r.snapshot).toBe("submit/v1");
    const stored = await db.closingSnapshot.findFirstOrThrow({ where: { closingId: ids.closing, kind: "SUBMIT" } });
    expect(sha(r.buf)).toBe(stored.sha256);
    expect(Buffer.from(stored.file, "base64").equals(r.buf)).toBe(true);
    expect(r.buf.byteLength).toBe(stored.size);
    expect(r.filename).toBe(stored.fileName);
    // 다운로드 감사 기록: entityId = 스냅샷 id, data에 snapshotId·sha256
    const log = await db.auditLog.findFirst({ where: { entity: "Export", entityId: stored.id }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(log!.data!)).toMatchObject({ snapshotId: stored.id, sha256: stored.sha256 });
    // PM은 ?live=1 불가
    expect((await file(exportRoute.GET, `http://localhost/api?ym=${YM}&live=1`, { id: ids.project })).status).toBe(403);
  });

  it("승인: 결재 문서번호 저장 + 승인본 v1, 승인된 달 엑셀은 승인본, 재무의 ?live=1은 현재 데이터(_수정본_현재)", async () => {
    as(ids.hq);
    const approved = await json(reviewRoute.POST, { id: ids.closing }, { method: "POST", body: JSON.stringify({ decision: "approve", note: "", approvalRef: "BW-2026-1005-0123" }) });
    expect(approved.status).toBe(200);
    expect(approved.body?.status).toBe("APPROVED");
    expect(approved.body?.approvalRef).toBe("BW-2026-1005-0123");
    expect(approved.body?.snapshot).toMatchObject({ version: 1 });
    const stored = await db.closingSnapshot.findFirstOrThrow({ where: { closingId: ids.closing, kind: "APPROVE" } });
    expect(stored.fileName).toContain("_승인본_");
    // 크기: 실측 약 58 KB(12개월 양식, 지출 1건) — D1 행 한도(2 MB)보다 훨씬 작다. base64는 원본의 4/3
    expect(stored.size).toBe(Buffer.from(stored.file, "base64").byteLength);
    expect(stored.file.length).toBeLessThan(2_000_000);

    as(ids.pm);
    const r = await file(exportRoute.GET, `http://localhost/api?ym=${YM}`, { id: ids.project });
    expect(r.snapshot).toBe("approve/v1");
    expect(sha(r.buf)).toBe(stored.sha256);
    expect(r.filename).toContain("_승인본_");

    as(ids.hq);
    const live = await file(exportRoute.GET, `http://localhost/api?ym=${YM}&live=1`, { id: ids.project });
    expect(live.status).toBe(200);
    expect(live.snapshot).toBeNull();
    expect(live.filename).toContain("_수정본_현재_");
    // 월 단독 시트는 현재 데이터 (상태 접미 승인)
    const month = await file(exportRoute.GET, `http://localhost/api?ym=${YM}&sheet=month`, { id: ids.project });
    expect(month.status).toBe(200);
    expect(month.snapshot).toBeNull();
    expect(month.filename).toContain("시트_승인");
  });

  it("스냅샷 내려받기 라우트 — 권한은 엑셀과 같고, 다른 마감의 스냅샷 id는 404", async () => {
    const stored = await db.closingSnapshot.findFirstOrThrow({ where: { closingId: ids.closing, kind: "APPROVE" } });
    as(ids.pm);
    const r = await file(snapshotRoute.GET, "http://localhost/api", { id: ids.closing, sid: stored.id });
    expect(r.status).toBe(200);
    expect(r.snapshot).toBe("approve/v1");
    expect(sha(r.buf)).toBe(stored.sha256);
    expect((await file(snapshotRoute.GET, "http://localhost/api", { id: "nope", sid: stored.id })).status).toBe(404);
    const logs = await db.auditLog.count({ where: { entity: "Export", entityId: stored.id } });
    expect(logs).toBe(2); // ?ym= 승인본 + 스냅샷 라우트
  });

  it("결재 문서번호 PATCH — 재무만, 승인된 달만", async () => {
    as(ids.pm);
    expect((await json(closingPatch.PATCH, { id: ids.closing }, { method: "PATCH", body: JSON.stringify({ approvalRef: "X" }) })).status).toBe(403);
    as(ids.hq);
    const r = await json(closingPatch.PATCH, { id: ids.closing }, { method: "PATCH", body: JSON.stringify({ approvalRef: "BW-2026-1005-0999" }) });
    expect(r.status).toBe(200);
    expect((await db.monthlyClosing.findUniqueOrThrow({ where: { id: ids.closing } })).approvalRef).toBe("BW-2026-1005-0999");
    expect((await json(closingPatch.PATCH, { id: ids.closing }, { method: "PATCH", body: JSON.stringify({ approvalRef: "a".repeat(61) }) })).status).toBe(400);
  });

  it("승인된 달이 있는 예산 PUT — 사유 없으면 409 APPROVED_EXISTS, 사유와 함께면 저장 + 감사 기록에 사유·행별 diff", async () => {
    as(ids.hq);
    const lines = [{ itemId: ids.item, detail: "가상 변경", unitPrice: 120_000, periods: 12 }];
    const noReason = await json(budgetRoute.PUT, { id: ids.project }, { method: "PUT", body: JSON.stringify({ lines }) });
    expect(noReason.status).toBe(409);
    expect(noReason.body).toMatchObject({ code: "APPROVED_EXISTS", approvedMonths: [YM] });
    expect((await json(budgetRoute.PUT, { id: ids.project }, { method: "PUT", body: JSON.stringify({ lines, reason: "짧음" }) })).status).toBe(400);
    const ok = await json(budgetRoute.PUT, { id: ids.project }, { method: "PUT", body: JSON.stringify({ lines, reason: "변경계약 2차 반영으로 단가 조정" }) });
    expect(ok.status).toBe(200);
    const log = await db.auditLog.findFirst({ where: { entity: "BudgetLine", entityId: ids.project, action: "replace" }, orderBy: { createdAt: "desc" } });
    const data = JSON.parse(log!.data!) as { reason: string; approvedMonths: string[]; diff: { itemId: string; before: { unitPrice: number }[]; after: { unitPrice: number }[] }[] };
    expect(data.reason).toBe("변경계약 2차 반영으로 단가 조정");
    expect(data.approvedMonths).toEqual([YM]);
    expect(data.diff).toEqual([{ itemId: ids.item, before: [{ detail: "가상", unitPrice: 100_000, periods: 12, changeId: null, bundleItemIds: null }], after: [{ detail: "가상 변경", unitPrice: 120_000, periods: 12, changeId: null, bundleItemIds: null }] }]);
    // 승인본은 그대로 (예산을 바꿔도 저장 파일·SHA-256 불변)
    const stored = await db.closingSnapshot.findFirstOrThrow({ where: { closingId: ids.closing, kind: "APPROVE" } });
    as(ids.pm);
    expect(sha((await file(exportRoute.GET, `http://localhost/api?ym=${YM}`, { id: ids.project })).buf)).toBe(stored.sha256);
  });
});
