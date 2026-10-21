// 재무 승인 판단 요약 — 순수함수 (설계 검토(2026-10-14) P0-3). 화면은 components/closing/HqSummary.tsx, 데이터 조회는 app/(dashboard)/closing/page.tsx
// 예산 대비 집행 표는 상신 엑셀 "프로젝트 운영비(작성금지)" 시트(lib/export.ts renderWorkbook)와 같은 행·열 — 같은 parts(loadWorkbookData) 입력을 받는다.
import { BLOCKER_LABEL, type BlockerCode } from "./closing";
import { payerLabels } from "./month-sheet";
import { excelItemName } from "./settle-group";

/** 엑셀 예산 시트 한 행에 필요한 대시보드 행 (lib/reports.ts buildDashboard rows의 일부) */
export type DashRowLike = {
  itemId: string; itemName: string; accountCode: string | null; categoryName: string;
  planned: number; spent: number; remaining: number; months: number[]; regular: boolean;
};
/** 메인·서브(구분)별 예산 묶음 — lib/export.ts loadWorkbookData().parts와 같은 모양 */
export type BudgetPartLike = {
  id: string;
  dash: { rows: DashRowLike[]; totals: { planned: number; spent: number; remaining: number }; trend: { amount: number }[] };
  lines: { itemId: string; detail: string; unitPrice: number; periods: number }[];
  /** 단가 × 기간이 계획과 같을 때만 단가·기간 칸을 채운다 (서브: 귀속 비율로 나눈 계획은 값만) */
  exact: boolean;
};

export type HqBudgetRow = {
  key: string;
  partId: string;
  accountCode: string;
  categoryName: string;
  /** 구분명_항목 (엑셀과 같게) */
  itemName: string;
  detail: string;
  unitPrice: number | null;
  periods: number | null;
  planned: number;
  spent: number;
  remaining: number;
  /** 프로젝트 기간 전체의 월별 집행 (엑셀 월별 열) */
  months: number[];
  /** 이 달 집행 */
  thisMonth: number;
  /** 매월 항목의 월 배정(계획 ÷ 개월수, lib/settlement.ts monthItemRows와 같은 나눔) — 비정기 항목은 null */
  monthBudget: number | null;
  /** 잔액 음수 */
  over: boolean;
  /** 이 달 집행이 월 배정을 넘음 */
  overMonth: boolean;
};

export type HqBudgetTable = {
  months: string[];
  ym: string;
  /** 이 달의 months 인덱스 (-1이면 기간 밖) */
  idx: number;
  rows: HqBudgetRow[];
  totals: { planned: number; spent: number; remaining: number; months: number[]; thisMonth: number };
  /** 잔액 음수 또는 이 달 월 배정 초과 항목 수 */
  warnCount: number;
};

/**
 * 예산 대비 집행 표 — 엑셀 "프로젝트 운영비(작성금지)" 시트와 같은 행(메인 → 서브 순, 항목 이름에 구분명)·열(분류(회계계정)·분류·항목·상세내역·단가·기간·계획·지출·잔액·월별).
 * 상세내역·단가·기간 규칙은 lib/export.ts와 같다: 상세는 예산 행을 " / "로 잇고, 단가·기간은 예산 행이 하나일 때만(서브는 단가×기간=계획일 때만).
 */
export function hqBudgetTable(x: { parts: BudgetPartLike[]; months: string[]; ym: string; prefixOf: (projectId: string) => string | null | undefined }): HqBudgetTable {
  const { months, ym } = x;
  const idx = months.indexOf(ym);
  const n = Math.max(1, months.length);
  const rows: HqBudgetRow[] = [];
  for (const part of x.parts) {
    const linesOf = new Map<string, BudgetPartLike["lines"]>();
    for (const l of part.lines) { const list = linesOf.get(l.itemId); if (list) list.push(l); else linesOf.set(l.itemId, [l]); }
    const prefix = x.prefixOf(part.id);
    for (const row of part.dash.rows) {
      const own = linesOf.get(row.itemId) ?? [];
      const single = own.length === 1 && (!part.exact || own[0].unitPrice * own[0].periods === row.planned);
      const thisMonth = idx >= 0 ? row.months[idx] ?? 0 : 0;
      const monthBudget = row.regular ? Math.round(row.planned / n) : null;
      rows.push({
        key: `${part.id}:${row.itemId}`,
        partId: part.id,
        accountCode: row.accountCode ?? "",
        categoryName: row.categoryName,
        itemName: excelItemName(prefix, row.itemName),
        detail: own.map((l) => l.detail).join(" / "),
        unitPrice: single ? own[0].unitPrice : null,
        periods: single ? own[0].periods : null,
        planned: row.planned,
        spent: row.spent,
        remaining: row.remaining,
        months: months.map((_, i) => row.months[i] ?? 0),
        thisMonth,
        monthBudget,
        over: row.remaining < 0,
        overMonth: monthBudget !== null && thisMonth > monthBudget,
      });
    }
  }
  const sumParts = (pick: (p: BudgetPartLike) => number) => x.parts.reduce((a, p) => a + pick(p), 0);
  const monthTotals = months.map((_, i) => sumParts((p) => p.dash.trend[i]?.amount ?? 0));
  return {
    months, ym, idx, rows,
    totals: {
      planned: sumParts((p) => p.dash.totals.planned),
      spent: sumParts((p) => p.dash.totals.spent),
      remaining: sumParts((p) => p.dash.totals.remaining),
      months: monthTotals,
      thisMonth: idx >= 0 ? monthTotals[idx] : 0,
    },
    warnCount: rows.filter((r) => r.over || r.overMonth).length,
  };
}

/** 증감 강조 기준: ±30% 이상 */
export const DELTA_WARN_PCT = 30;

/**
 * 전월 대비 증감 — pct: 전월이 0이면 null (비율을 낼 수 없음). warn: ±30% 이상 또는 전월 0원에서 생김
 */
export function monthDelta(current: number, prev: number | null): { diff: number | null; pct: number | null; warn: boolean } {
  if (prev === null) return { diff: null, pct: null, warn: false };
  const diff = current - prev;
  if (prev === 0) return { diff, pct: null, warn: current > 0 };
  const pct = Math.round((diff / prev) * 100);
  return { diff, pct, warn: Math.abs(pct) >= DELTA_WARN_PCT };
}

/** 증감 표기: "+12%" / "-30%" / "신규" / "0%" — pct null이고 diff>0이면 신규 */
export function deltaText(d: { diff: number | null; pct: number | null }): string {
  if (d.diff === null) return "";
  if (d.pct === null) return d.diff > 0 ? "신규" : "0%";
  return `${d.pct > 0 ? "+" : ""}${d.pct}%`;
}

export type PayerCompareRow = { id: string; name: string; current: number; prev: number; diff: number; pct: number | null; warn: boolean };

/**
 * 결제자별 이번 달·전월 비교 — 팀원별 정산금액(개인 법인카드) 기준. 둘 다 0원인 사람은 뺀다.
 * 순서: order(결제자 목록 순서 = 직급 → 성명) → 목록 밖은 이름순
 * 이름은 집행내역 표(lib/month-sheet.ts payerLabels)와 같은 규칙으로 동명이인을 "이름(2)"로 구분 — 번호는 order 순서(목록 밖은 그 뒤)로 붙는다.
 */
export function payerCompare(current: Record<string, number>, prev: Record<string, number>, nameOf: (id: string) => string, order: string[]): PayerCompareRow[] {
  const ids = [...new Set([...Object.keys(current), ...Object.keys(prev)])];
  const rank = new Map(order.map((id, i) => [id, i]));
  const extra = ids.filter((id) => !rank.has(id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ko"));
  const { labelOf } = payerLabels([...order, ...extra].map((id) => ({ id, name: nameOf(id) })), []);
  return ids
    .map((id) => {
      const c = current[id] ?? 0;
      const p = prev[id] ?? 0;
      const d = monthDelta(c, p);
      return { id, name: labelOf.get(id) ?? nameOf(id), current: c, prev: p, diff: d.diff ?? 0, pct: d.pct, warn: d.warn };
    })
    .filter((r) => r.current !== 0 || r.prev !== 0)
    .sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name, "ko"));
}

/** 감사 기록 한 줄 (data는 JSON 글자) */
export type AuditLogLike = { id: string; action: string; userId: string; createdAt: Date; data: string | null };

const parse = (s: string | null): Record<string, unknown> | null => {
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === "object" ? (v as Record<string, unknown>) : null; } catch { return null; }
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

export type ExpenseChange = {
  id: string;
  action: "create" | "update" | "delete";
  at: Date;
  byId: string;
  payerId: string | null;
  itemId: string | null;
  itemAfterId: string | null;
  amountBefore: number | null;
  amountAfter: number | null;
  detail: string | null;
  /** 이 달에서 다른 달로 옮긴 수정 */
  movedOut: boolean;
};

/**
 * 반려 이후 바뀐 지출 (Expense 감사 기록 → 한 줄씩). 그 달(ym) 지출만: 등록 data·수정 before/after·삭제 data의 yearMonth로 거른다.
 * 수정은 after에 없는 칸은 before 값 그대로(부분 수정).
 */
export function expenseChanges(logs: AuditLogLike[], ym: string): ExpenseChange[] {
  const out: ExpenseChange[] = [];
  for (const l of logs) {
    const d = parse(l.data);
    if (!d) continue;
    if (l.action === "create" || l.action === "delete") {
      if (text(d.yearMonth) !== ym) continue;
      out.push({
        id: l.id, action: l.action, at: l.createdAt, byId: l.userId,
        payerId: text(d.payerId), itemId: text(d.itemId), itemAfterId: null,
        amountBefore: l.action === "delete" ? num(d.amount) : null, amountAfter: l.action === "create" ? num(d.amount) : null,
        detail: text(d.detail), movedOut: false,
      });
    } else if (l.action === "update") {
      const before = (d.before && typeof d.before === "object" ? d.before : {}) as Record<string, unknown>;
      const after = (d.after && typeof d.after === "object" ? d.after : {}) as Record<string, unknown>;
      const ymBefore = text(before.yearMonth);
      const ymAfter = text(after.yearMonth) ?? ymBefore;
      if (ymBefore !== ym && ymAfter !== ym) continue;
      const itemBefore = text(before.itemId);
      const itemAfter = text(after.itemId) ?? itemBefore;
      out.push({
        id: l.id, action: "update", at: l.createdAt, byId: l.userId,
        payerId: text(after.payerId) ?? text(before.payerId), itemId: itemBefore, itemAfterId: itemAfter !== itemBefore ? itemAfter : null,
        amountBefore: num(before.amount), amountAfter: num(after.amount) ?? num(before.amount),
        detail: text(after.detail) ?? text(before.detail), movedOut: ymBefore === ym && ymAfter !== ym,
      });
    }
  }
  return out;
}

export type ReviewEvent = {
  id: string;
  action: "submit" | "reject" | "revoke" | "approve";
  at: Date;
  byId: string;
  note: string | null;
  /** 상신: 가드를 넘긴 사유·항목 */
  overrideReason: string | null;
  blockers: BlockerCode[];
  /** 승인: 결재 문서번호 (적었을 때만) */
  approvalRef: string | null;
  /** 승인: 소명 없는 규정 점검을 사유를 적고 넘긴 건수 (없으면 null) */
  unexplainedOverride: number | null;
  /** 승인: 승인자 본인이 입력한 본사 지출(자기 승인) 건수·금액 (없으면 null) */
  selfApproval: SelfApproval | null;
};

/** 마감 처리 기록 중 검토 이력(상신·반려·승인 취소·승인)만 — 최근 것부터 */
export function reviewTimeline(logs: AuditLogLike[]): ReviewEvent[] {
  const out: ReviewEvent[] = [];
  for (const l of logs) {
    if (l.action !== "submit" && l.action !== "reject" && l.action !== "revoke" && l.action !== "approve") continue;
    const d = parse(l.data) ?? {};
    const blockers = Array.isArray(d.blockers) ? d.blockers.filter((c): c is BlockerCode => typeof c === "string" && c in BLOCKER_LABEL) : [];
    const override = d.override && typeof d.override === "object" ? (d.override as Record<string, unknown>) : null;
    const unexplained = override ? num(override.unexplained) : null;
    const self = d.selfApproval && typeof d.selfApproval === "object" ? (d.selfApproval as Record<string, unknown>) : null;
    const selfCount = self ? num(self.count) : null;
    out.push({
      id: l.id, action: l.action, at: l.createdAt, byId: l.userId, note: text(d.note), overrideReason: text(d.overrideReason), blockers,
      approvalRef: text(d.approvalRef)?.trim() || null,
      unexplainedOverride: unexplained && unexplained > 0 ? unexplained : null,
      selfApproval: self && selfCount && selfCount > 0 ? { count: selfCount, amount: num(self.amount) ?? 0 } : null,
    });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** 출입증 상태 한 줄: "확정" / "운영 확정 · 대응 확정 전" / "없음" — 출입증을 쓰지 않으면 null */
export function passStatusText(pass: { label: string; status: "NONE" | "OPEN" | "CONFIRMED" }[] | null): string | null {
  if (!pass || !pass.length) return null;
  const word = (s: "NONE" | "OPEN" | "CONFIRMED") => (s === "CONFIRMED" ? "확정" : s === "OPEN" ? "확정 전" : "없음");
  return pass.length === 1 ? word(pass[0].status) : pass.map((p) => `${p.label} ${word(p.status)}`).join(" · ");
}

/** 승인 확인 패널 한 줄: "총액 N원 · 규정 점검 n건(소명 없음 m건) · 출입증 확정 · 예산 초과 항목 k개" */
export function approveSummaryText(x: { total: number; flagged: number; unexplained: number; passText: string | null; warnCount: number }): string {
  const parts = [`총액 ${x.total.toLocaleString("ko-KR")}원`];
  parts.push(x.flagged ? `규정 점검 ${x.flagged}건${x.unexplained ? `(소명 없음 ${x.unexplained}건)` : "(모두 소명)"}` : "규정 점검 없음");
  if (x.passText) parts.push(`출입증 ${x.passText}`);
  parts.push(x.warnCount ? `예산 초과 항목 ${x.warnCount}개` : "예산 초과 항목 없음");
  return parts.join(" · ");
}

/** 자기 승인 경고: 승인자 본인이 입력한 그 달 본사 지출 건수·금액 */
export type SelfApproval = { count: number; amount: number };

/**
 * 자기 승인 경고 (설계 검토(2026-10-14) P0-3 ④ — 차단 아님, 경고·기록만): 그 달 본사 지출(isHq 또는 결제방법 HQ) 중 승인자 본인이 입력(createdBy)한 건.
 * 없으면 null. approverId가 없으면(승인자가 아닌 사람이 보는 화면) null.
 */
export function selfApprovalWarning(expenses: { isHq?: boolean; payMethod?: string; createdBy: string; amount: number }[], approverId: string | null | undefined): SelfApproval | null {
  if (!approverId) return null;
  let count = 0;
  let amount = 0;
  for (const e of expenses) {
    if (!(e.isHq || e.payMethod === "HQ") || e.createdBy !== approverId) continue;
    count += 1;
    amount += e.amount;
  }
  return count ? { count, amount } : null;
}

/** 자기 승인 경고 문구 (승인 확인 패널·판단 요약 공통) — 앞에 '자기 승인' 배지가 붙는다 */
export const selfApprovalText = (x: SelfApproval): string => `본사 지출 ${x.count}건 ${x.amount.toLocaleString("ko-KR")}원을 본인이 입력했어요`;
/** 재무 승인 담당이 2명 이상일 때의 보조 문구 */
export const SELF_APPROVAL_HINT = "다른 재무 승인 담당이 승인하는 것이 좋아요";
