// 월 마감/상신 워크플로우 상태 전환 규칙 — 순수함수
import { CLOSING_LABEL, parseClosingStatus, type ClosingStatus, type Role } from "./types";

export type ClosingAction = "close" | "reopen" | "submit" | "approve" | "reject" | "revoke";

export const ACTION_LABEL: Record<ClosingAction, string> = {
  close: "월 마감",
  reopen: "마감 해제",
  submit: "상신",
  approve: "승인",
  reject: "반려",
  revoke: "승인 취소",
};

/** yearMonth별 마감 맵에서 상태 조회 (없으면 DRAFT) */
export function closingStatusIn(closings: Map<string, { status: string }>, ym: string): ClosingStatus {
  return parseClosingStatus(closings.get(ym)?.status);
}

/** 마감(CLOSED) 이상이면 지출 등록·수정·삭제 불가. 반려되면 PM이 다시 수정할 수 있다. */
export function isLocked(status: ClosingStatus | string | null | undefined): boolean {
  return status === "CLOSED" || status === "SUBMITTED" || status === "APPROVED";
}

// 직무 분리: 마감·상신·마감 해제는 PM, 승인·반려·승인 취소는 재무 승인. 시스템 관리자는 조회만 (프로젝트 데이터 조회 전용이라 어떤 처리도 할 수 없다)
const RULES: Record<ClosingAction, { from: ClosingStatus[]; to: ClosingStatus; roles: Role[] }> = {
  close: { from: ["DRAFT", "REJECTED"], to: "CLOSED", roles: ["MANAGER"] },
  reopen: { from: ["CLOSED", "REJECTED"], to: "DRAFT", roles: ["MANAGER"] },
  submit: { from: ["CLOSED"], to: "SUBMITTED", roles: ["MANAGER"] },
  approve: { from: ["SUBMITTED"], to: "APPROVED", roles: ["HQ"] },
  reject: { from: ["SUBMITTED"], to: "REJECTED", roles: ["HQ"] },
  // 승인 후 오류 발견 시 재무 승인 담당이 사유를 남기고 다시 열어 PM이 수정하게 한다
  revoke: { from: ["APPROVED"], to: "REJECTED", roles: ["HQ"] },
};

/** 사유 입력이 필요한 처리 */
export const NEEDS_NOTE: ClosingAction[] = ["reject", "revoke"];

/** 실패 종류: role = 이 역할로는 할 수 없음(403), state = 지금 상태에서는 불가(409), unknown = 없는 처리 */
export type TransitionFailure = { ok: false; code: "role" | "state" | "unknown"; reason: string };

export function transition(
  current: ClosingStatus,
  action: ClosingAction,
  role: Role,
): { ok: true; next: ClosingStatus } | TransitionFailure {
  const rule = RULES[action];
  if (!rule) return { ok: false, code: "unknown", reason: "알 수 없는 요청입니다." };
  if (!rule.roles.includes(role)) return { ok: false, code: "role", reason: "권한이 없습니다." };
  if (!rule.from.includes(current)) return { ok: false, code: "state", reason: stateFailureReason(current, action) };
  return { ok: true, next: rule.to };
}

/** 실패 → HTTP 상태 (역할 403, 상태 409, 없는 처리 404) */
export function transitionFailureStatus(f: TransitionFailure): number {
  return f.code === "role" ? 403 : f.code === "unknown" ? 404 : 409;
}

export function availableActions(current: ClosingStatus, role: Role): ClosingAction[] {
  return (Object.keys(RULES) as ClosingAction[]).filter((a) => transition(current, a, role).ok);
}

/** 아직 시작하지 않은 달(이번 달 이후)은 마감·상신할 수 없다 — 불가 사유, 가능하면 null */
export function futureMonthProblem(action: ClosingAction, ym: string, now: string): string | null {
  if ((action === "close" || action === "submit") && ym > now) return "아직 시작하지 않은 달은 마감·상신할 수 없습니다.";
  return null;
}

/**
 * 마감·상신 화면에서 처음 고를 달 (?ym= 없을 때) — 역할별로 지금 처리할 달.
 * - 재무 승인·시스템 관리자: 승인 대기(상신) 중 가장 오래된 달
 * - PM: 반려 → 마감(상신 전) → 지난 작성중 달, 각각 가장 오래된 달
 * 없으면 이번 달, 그것도 없으면 가장 최근 달.
 */
export function defaultClosingMonth(rows: { ym: string; status: ClosingStatus }[], role: Role, now: string): string | null {
  // 조건에 맞는 달 중 가장 오래된 달 (정렬하지 않고 최솟값만 — "YYYY-MM" 글자 비교는 정렬과 같은 순서)
  const oldest = (pred: (r: { ym: string; status: ClosingStatus }) => boolean) => {
    let min: string | undefined;
    for (const r of rows) if (pred(r) && (min === undefined || r.ym < min)) min = r.ym;
    return min;
  };
  const order: ((r: { ym: string; status: ClosingStatus }) => boolean)[] = role === "HQ" || role === "ADMIN"
    ? [(r) => r.status === "SUBMITTED"]
    : [(r) => r.status === "REJECTED", (r) => r.status === "CLOSED", (r) => r.status === "DRAFT" && r.ym < now];
  for (const pred of order) {
    const ym = oldest(pred);
    if (ym) return ym;
  }
  if (rows.some((r) => r.ym === now)) return now;
  let last: string | undefined;
  for (const r of rows) if (last === undefined || r.ym > last) last = r.ym;
  return last ?? null;
}

/** 잠긴 달을 고치려면 필요한 처리 (상태별 안내). pm: 마감을 해제할 PM (메인과 함께 상신하는 서브면 "○○ PM") */
export function unlockHint(status: ClosingStatus | string | null | undefined, pm = "PM"): string {
  if (status === "APPROVED") return "수정이 필요하면 재무 승인 담당이 승인을 취소해야 합니다.";
  if (status === "SUBMITTED") return `수정이 필요하면 재무 승인 담당이 반려한 뒤 ${pm}이 수정합니다.`;
  return `수정이 필요하면 ${pm}이 마감을 해제해야 합니다.`;
}

/** 잠긴 달의 지출 등록·수정·삭제 차단 문구 */
export function lockedMonthMessage(status: ClosingStatus | string | null | undefined): string {
  const label = status === "APPROVED" ? "승인된" : status === "SUBMITTED" ? "상신된" : "마감된";
  return `${label} 월의 지출은 변경할 수 없습니다. ${unlockHint(status)}`;
}

/** 상태 때문에 처리할 수 없을 때의 이유 (마감 해제 등 409 응답 문구) */
export function stateFailureReason(current: ClosingStatus, action: ClosingAction): string {
  const base = `${CLOSING_LABEL[current]} 상태에서는 ${ACTION_LABEL[action]}할 수 없습니다.`;
  const locked = current === "SUBMITTED" || current === "APPROVED";
  // 다음에 할 일을 함께 — 409 응답이 "안 됩니다"로 끝나지 않게
  if ((action === "reopen" || action === "close") && locked) return `${base} ${unlockHint(current)}`;
  if (action === "submit" && (current === "DRAFT" || current === "REJECTED")) return `${base} 먼저 월 마감하세요.`;
  if (action === "approve" || action === "reject") return `${base} 상신된 달만 승인·반려할 수 있습니다.`;
  if (action === "revoke") return `${base} 승인된 달만 승인 취소할 수 있습니다.`;
  return base;
}

// ── 상신 가드 (설계 검토(2026-10-14) P0-1) ─────────────────────────────────────
// 체크리스트(lib/closing-checklist.ts)와 같은 입력으로 "안내"와 "차단"을 한 소스에서 계산한다.
// 미완료 항목이 있어도 PM이 사유(SUBMIT_REASON_MIN~MAX자)를 적으면 상신할 수 있다 — 정산 검증 불일치(INVALID)만 사유로도 넘길 수 없다.

/** 출입증 내역 상태 — 함께 상신하는 묶음의 프로젝트(구분)마다 하나. NONE: 아직 안 올림 · OPEN: 확정 전 · CONFIRMED */
export type PassStatementState = {
  projectId: string;
  /** 구분 이름 (엑셀 구분명, 없으면 프로젝트 이름) */
  label: string;
  status: "NONE" | "OPEN" | "CONFIRMED";
  /** 예산 항목에 연결되지 않은 회사 부담 건수 (확정해도 본사 집행내역·예산 집행에 빠진다) */
  unlinked: number;
};

export type BlockerCode = "PASS_OPEN" | "PASS_UNLINKED" | "UNEXPLAINED" | "SUB_NOT_READY" | "INVALID";
export type Blocker = { code: BlockerCode; message: string };

export type SubmitGuardInput = {
  ym: string;
  /** 출입증을 쓰는 프로젝트(구분)의 그 달 내역 상태 — 출입증을 쓰지 않으면 null 또는 빈 배열 */
  passStatements: PassStatementState[] | null;
  /** 소명 없는 규정 점검 건수 (서브가 있으면 메인 것만 — 서브는 subReady에) */
  unexplainedCount: number;
  /** 함께 상신하는 서브별 준비 여부 (있으면) */
  subReady?: { name: string; ready: boolean; detail?: string }[];
  /** 정산 검증 FALSE (팀원별 + 공용 + 본사 ≠ 총합계) */
  settlementInvalid: boolean;
};

/** 미완료 항목 짧은 이름 (배지·감사 기록 표시) */
export const BLOCKER_LABEL: Record<BlockerCode, string> = {
  PASS_OPEN: "출입증 확정 전", PASS_UNLINKED: "출입증 예산 항목 미연결", UNEXPLAINED: "소명 없음", SUB_NOT_READY: "서브 미처리", INVALID: "검증 불일치",
};

const monthKo = (ym: string) => `${Number(ym.slice(5, 7))}월`;

/** 상신 전 미완료 항목 — 순수함수. 비어 있으면 바로 상신할 수 있다 */
export function submitBlockers(x: SubmitGuardInput): Blocker[] {
  const out: Blocker[] = [];
  const m = monthKo(x.ym);
  if (x.settlementInvalid) {
    out.push({ code: "INVALID", message: "팀원별 + 공용 법인카드 + 본사 합이 총합계와 다릅니다. 결제방법·본사 구분을 고친 뒤 다시 마감하세요." });
  }
  for (const p of x.passStatements ?? []) {
    if (p.status === "OPEN") out.push({ code: "PASS_OPEN", message: `${p.label} ${m} 출입증 확정 전 — 상신하면 잠겨 확정할 수 없습니다. 먼저 확정하세요.` });
    else if (p.status === "NONE") out.push({ code: "PASS_OPEN", message: `${p.label} ${m} 출입증 내역 없음 — 상신하면 업체 내역을 올릴 수 없습니다. 먼저 올리세요.` });
    if (p.unlinked > 0) out.push({ code: "PASS_UNLINKED", message: `${p.label} 출입증 회사 부담 ${p.unlinked}건이 예산 항목에 연결되지 않아 본사 집행내역·예산 집행에 빠집니다.` });
  }
  if (x.unexplainedCount > 0) out.push({ code: "UNEXPLAINED", message: `소명 없는 규정 점검 ${x.unexplainedCount}건 — 지출 내역의 '소명 필요'에서 소명을 받으세요.` });
  for (const s of x.subReady ?? []) {
    if (!s.ready) out.push({ code: "SUB_NOT_READY", message: `${s.name} 미처리${s.detail ? ` — ${s.detail}` : ""}` });
  }
  return out;
}

export const SUBMIT_BLOCKED = "SUBMIT_BLOCKED";
export const SUBMIT_BLOCKED_HINT = "사유를 적으면 그대로 상신할 수 있습니다";
export const SUBMIT_REASON_MIN = 10;
export const SUBMIT_REASON_MAX = 300;
/** 상신 메모(선택) 길이 */
export const SUBMIT_NOTE_MAX = 300;
/** 마감 해제 사유 (필수, 2026-10-15 결정) — 감사 기록 data.reason에 남는다 */
export const REOPEN_REASON_MAX = 300;

/** 사유로 넘길 수 있는 미완료 항목인지 (검증 불일치는 불가) */
export const canOverrideBlockers = (blockers: Blocker[]) => blockers.length > 0 && blockers.every((b) => b.code !== "INVALID");

/**
 * 미완료 항목이 있을 때 사유 검사 → null(통과) 또는 { status, message, extra }
 * - 사유 없음: 409 SUBMIT_BLOCKED (blockers·hint 포함 — 화면이 사유를 받아 다시 보낸다)
 * - 검증 불일치: 사유가 있어도 409 (hint 없음)
 * - 사유 길이 미달·초과: 400
 */
export function submitOverrideProblem(blockers: Blocker[], reason: unknown): { status: number; message: string; extra?: Record<string, unknown> } | null {
  if (!blockers.length) return null;
  const invalid = blockers.find((b) => b.code === "INVALID");
  if (invalid) return { status: 409, message: invalid.message, extra: { code: SUBMIT_BLOCKED, blockers, overridable: false } };
  const s = typeof reason === "string" ? reason.trim() : "";
  if (!s) {
    return {
      status: 409,
      message: `상신 전 확인할 항목이 ${blockers.length}건 있습니다. ${SUBMIT_BLOCKED_HINT}.`,
      extra: { code: SUBMIT_BLOCKED, blockers, overridable: true, hint: SUBMIT_BLOCKED_HINT },
    };
  }
  if (s.length < SUBMIT_REASON_MIN) return { status: 400, message: `상신 사유는 ${SUBMIT_REASON_MIN}자 이상 적어 주세요.` };
  if (s.length > SUBMIT_REASON_MAX) return { status: 400, message: `상신 사유는 ${SUBMIT_REASON_MAX}자 이내로 적어 주세요.` };
  return null;
}

/** MonthlyClosing.submitOverride (JSON) — 미완료 항목을 사유로 넘겨 상신한 기록 */
export type SubmitOverride = { reason: string; blockers: BlockerCode[]; at: string };

export function parseSubmitOverride(json: string | null | undefined): SubmitOverride | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<SubmitOverride>;
    if (!v || typeof v.reason !== "string" || !Array.isArray(v.blockers)) return null;
    return { reason: v.reason, blockers: v.blockers.filter((c): c is BlockerCode => typeof c === "string" && c in BLOCKER_LABEL), at: typeof v.at === "string" ? v.at : "" };
  } catch {
    return null;
  }
}

/** 가드 무시 기록의 항목 이름 목록 ("출입증 확정 전 · 소명 없음") */
export const overrideLabels = (o: SubmitOverride) => [...new Set(o.blockers.map((c) => BLOCKER_LABEL[c]))].join(" · ");
