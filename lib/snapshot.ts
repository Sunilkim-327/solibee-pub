// 상신본·승인본 스냅샷 — 순수함수 (설계 검토(2026-10-14) P0-2). 서버 저장·조회는 lib/snapshot-server.ts
import { CLOSING_LABEL, type ClosingStatus } from "./types";

export type SnapshotKind = "SUBMIT" | "APPROVE";
export const SNAPSHOT_KINDS: readonly SnapshotKind[] = ["SUBMIT", "APPROVE"];
export const SNAPSHOT_LABEL: Record<SnapshotKind, string> = { SUBMIT: "상신본", APPROVE: "승인본" };
export const isSnapshotKind = (v: unknown): v is SnapshotKind => v === "SUBMIT" || v === "APPROVE";

/** 스냅샷 한 줄 (파일 내용 없이) — 화면·목록용 */
export type SnapshotMeta = { id: string; closingId: string; kind: string; version: number; fileName: string; sha256: string; size: number; createdAt: Date; createdBy: string };

/** 같은 마감 안에서 kind별 다음 버전 (1부터) */
export function nextSnapshotVersion(existing: { kind: string; version: number }[], kind: SnapshotKind): number {
  return existing.filter((s) => s.kind === kind).reduce((a, s) => Math.max(a, s.version), 0) + 1;
}

/** 상태별 최신 스냅샷 — 승인된 달은 승인본, 상신된 달은 상신본, 그 외 없음 (마감·작성중·반려는 현재 데이터로 만든다) */
export function servedSnapshotKind(status: ClosingStatus): SnapshotKind | null {
  return status === "APPROVED" ? "APPROVE" : status === "SUBMITTED" ? "SUBMIT" : null;
}

/** kind의 최신 버전 스냅샷 */
export function latestSnapshot<T extends { kind: string; version: number }>(list: T[], kind: SnapshotKind): T | null {
  return list.filter((s) => s.kind === kind).sort((a, b) => b.version - a.version)[0] ?? null;
}

/** 파일 이름의 시각: "2026-10-05 1800" (한국 시간) */
export function fileStamp(at: Date): string {
  const k = new Date(at.getTime() + 9 * 3600_000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 13)}${k.slice(14, 16)}`;
}

/** 파일 이름의 상태 접미: 작성중·마감·상신·승인본·반려, 승인된 달의 현재 데이터 버전은 "수정본_현재" */
export function exportSuffix(status: ClosingStatus, live = false): string {
  if (status === "APPROVED") return live ? "수정본_현재" : "승인본";
  return CLOSING_LABEL[status];
}

/**
 * 전체 통합문서 파일 이름.
 * - ym 지정: "2025-2026 ○○팀 운영비(26.09)_상신_2026-10-05 1800.xlsx" (상태·시각 포함 — 어느 시점의 어떤 본인지 파일 이름만으로)
 * - ym 없음(전체 출력): 기존 규칙 "2025-2026 ○○팀 운영비(26.02).xlsx"
 */
export function workbookFilename(x: { years: string; name: string; ym: string; status?: ClosingStatus; live?: boolean; at: Date }): string {
  const head = `${x.years} ${x.name} 운영비(${x.ym.slice(2, 4)}.${x.ym.slice(5, 7)})`;
  if (!x.status) return `${head}.xlsx`;
  return `${head}_${exportSuffix(x.status, x.live)}_${fileStamp(x.at)}.xlsx`;
}

/** 마감 감사 기록 data에 넣는 요약 (상신 전 변경 감지용) */
export type CloseStamp = { total: number; hq: number; pass: number };

/**
 * 마감 이후 변경 감지 (상신 전): 마감 감사 기록의 총합계와 지금 다시 계산한 총합계가 다르면 안내 문구, 같거나 옛 기록(총합계 없음)이면 null
 * @param logged 마감 감사 기록의 data (JSON 글자 또는 객체) — 없거나 total이 없으면 검사 생략
 */
export function closeDriftMessage(logged: unknown, currentTotal: number): string | null {
  let d: unknown = logged;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== "object") return null;
  const total = (d as { total?: unknown }).total;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  if (total === currentTotal) return null;
  return `마감 후 지출·출입증이 바뀌어 총합계가 달라졌습니다(마감 ${total.toLocaleString("ko-KR")}원 → 지금 ${currentTotal.toLocaleString("ko-KR")}원). 마감 해제 후 다시 마감하세요.`;
}

export const BUDGET_REASON_MIN = 10;
export const BUDGET_REASON_MAX = 300;
export const APPROVED_EXISTS = "APPROVED_EXISTS";

/**
 * 승인된 달이 있는 프로젝트의 예산 변경 — 사유 필수 (승인본 엑셀은 그대로, 현재 데이터만 바뀐다)
 * @returns null(통과) 또는 { status, message, extra } — 사유 없음 409 APPROVED_EXISTS, 길이 미달·초과 400
 */
export function budgetReasonProblem(approvedMonths: string[], reason: unknown): { status: number; message: string; extra?: Record<string, unknown> } | null {
  if (!approvedMonths.length) return null;
  const s = typeof reason === "string" ? reason.trim() : "";
  if (!s) {
    return { status: 409, message: "승인된 달이 있는 예산을 바꾸려면 사유가 필요합니다.", extra: { code: APPROVED_EXISTS, approvedMonths: [...approvedMonths].sort() } };
  }
  if (s.length < BUDGET_REASON_MIN) return { status: 400, message: `변경 사유는 ${BUDGET_REASON_MIN}자 이상 적어 주세요.` };
  if (s.length > BUDGET_REASON_MAX) return { status: 400, message: `변경 사유는 ${BUDGET_REASON_MAX}자 이내로 적어 주세요.` };
  return null;
}

/** 예산 행 비교용 칸 */
export type BudgetDiffLine = { itemId: string; detail: string; unitPrice: number; periods: number; changeId: string | null; bundleItemIds: string | null };
type DiffRow = Omit<BudgetDiffLine, "itemId">;

/**
 * 예산 일괄 저장의 행별 diff (감사 기록용) — 항목별 before/after 행(상세·단가·기간·과업·묶음). 바뀐 항목만, 순서만 바뀐 것은 제외
 */
export function budgetLineDiff(before: BudgetDiffLine[], after: BudgetDiffLine[]): { itemId: string; before: DiffRow[]; after: DiffRow[] }[] {
  const row = (l: BudgetDiffLine): DiffRow => ({ detail: l.detail, unitPrice: l.unitPrice, periods: l.periods, changeId: l.changeId ?? null, bundleItemIds: l.bundleItemIds ?? null });
  const group = (lines: BudgetDiffLine[]) => {
    const m = new Map<string, DiffRow[]>();
    for (const l of lines) { const list = m.get(l.itemId) ?? []; list.push(row(l)); m.set(l.itemId, list); }
    return m;
  };
  const key = (rows: DiffRow[]) => rows.map((r) => JSON.stringify([r.detail, r.unitPrice, r.periods, r.changeId, r.bundleItemIds])).sort().join("\n");
  const a = group(before);
  const b = group(after);
  return [...new Set([...a.keys(), ...b.keys()])].sort()
    .filter((id) => key(a.get(id) ?? []) !== key(b.get(id) ?? []))
    .map((id) => ({ itemId: id, before: a.get(id) ?? [], after: b.get(id) ?? [] }));
}

/** SHA-256 앞 12자 ("a1b2c3d4e5f6…") */
export const shortSha = (sha: string) => `${sha.slice(0, 12)}…`;

/** 파일 크기 표기: 128 KB / 1.2 MB */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 스냅샷별 다운로드 횟수·마지막 다운로드 (Export 감사 기록, 최신순 입력) */
export function downloadStats(logs: { entityId: string; userId: string; createdAt: Date }[]): Map<string, { count: number; last: { at: Date; userId: string } }> {
  const out = new Map<string, { count: number; last: { at: Date; userId: string } }>();
  for (const l of logs) {
    const cur = out.get(l.entityId);
    if (cur) { cur.count++; if (l.createdAt > cur.last.at) cur.last = { at: l.createdAt, userId: l.userId }; }
    else out.set(l.entityId, { count: 1, last: { at: l.createdAt, userId: l.userId } });
  }
  return out;
}

/** 결재 문서번호 입력 한도 */
export const APPROVAL_REF_MAX = 60;
