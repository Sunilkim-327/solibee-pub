// 월 마감 준비 체크리스트 — 순수함수 (안내용: 마감을 막지 않는다. 마감 규칙은 lib/closing.ts 그대로)
// 상신 가드(lib/closing.ts submitBlockers)와 같은 입력(PassStatementState — 함께 상신하는 묶음 전체)을 쓴다
import type { ClosingStatus } from "./types";
import type { PassStatementState } from "./closing";
import { isUnexplained, needsReview } from "./policy";
import { ledgerHref } from "./page-access";

export type ChecklistInput = {
  ym: string;
  /** 이 달 입력 대상 팀원 (그 달에 근무했고 자기에게 열린 지출 항목이 있는 결제자 — lib/input-capable). PM·항목 없는 팀원은 넘기지 않는다 */
  payers: { id: string; name: string }[];
  /** 이 달 지출 (payerId·점검 결과·소명만) */
  expenses: { payerId: string; flags: string | null; justification: string | null }[];
  /** 엑셀 검증: 팀원별 + 공용 + 본사 == 총합계 */
  isValid: boolean;
  /**
   * 출입증 — 쓰지 않으면 null(빈 배열도 같음). 함께 상신하는 묶음(메인 + 서브)의 출입증 쓰는 프로젝트마다 한 줄 —
   * 메인 상신이 서브 출입증도 잠그므로 구분별로 보여 준다 ("운영 확정 · 대응 확정 전"). status: NONE(아직 안 올림) · OPEN(확정 전) · CONFIRMED · unlinked: 예산 항목에 연결되지 않은 회사 부담 건수
   */
  pass: PassStatementState[] | null;
};

export type CheckKey = "input" | "flags" | "valid" | "pass";
export type CheckItem = {
  key: CheckKey;
  /** 문제 없음 */
  ok: boolean;
  label: string;
  /** 보조 설명 (미입력자 이름, 소명 여부 등) */
  detail?: string;
  href?: string;
};

/** 미입력자 이름은 앞의 몇 명만 */
const NAMES_SHOWN = 5;

export function closingChecklist({ ym, payers, expenses, isValid, pass }: ChecklistInput): CheckItem[] {
  const spent = new Set(expenses.map((e) => e.payerId));
  const missing = payers.filter((p) => !spent.has(p.id));
  const entered = payers.length - missing.length;
  const flagged = expenses.filter((e) => needsReview(e.flags));
  const unexplained = flagged.filter(isUnexplained).length;

  const items: CheckItem[] = [
    // 입력 대상 팀원이 없으면(PM만 입력하는 프로젝트) 입력 확인 줄을 뺀다
    ...(payers.length ? [{
      key: "input" as const,
      ok: missing.length === 0,
      label: `입력 ${entered}/${payers.length}명`,
      detail: missing.length
        ? `미입력 ${missing.slice(0, NAMES_SHOWN).map((p) => p.name).join(", ")}${missing.length > NAMES_SHOWN ? ` 외 ${missing.length - NAMES_SHOWN}명` : ""} — 지출이 없으면 그대로 두어도 됩니다`
        : undefined,
      href: `/dashboard?ym=${ym}&from=closing#settle`,
    }] : []),
    {
      key: "flags",
      ok: flagged.length === 0 || unexplained === 0,
      label: `규정 점검 ${flagged.length}건`,
      detail: flagged.length ? (unexplained ? `소명 필요 ${unexplained}건` : "모두 소명됨") : undefined,
      href: flagged.length ? ledgerHref(ym, { check: unexplained ? "unexplained" : "flag", from: "closing" }) : undefined,
    },
    {
      key: "valid",
      ok: isValid,
      label: isValid ? "검증 일치" : "검증 불일치",
      detail: isValid ? undefined : "팀원별 + 공용 법인카드 + 본사 합이 총합계와 다릅니다. 결제방법·본사 구분을 고쳐야 마감할 수 있습니다.",
      href: isValid ? undefined : `/dashboard?ym=${ym}&from=closing#settle`,
    },
  ];
  if (pass && pass.length) {
    // 회사 부담 항목이 예산 항목에 연결되지 않으면 확정해도 상신 엑셀 본사 집행내역·예산 집행에 빠진다
    const unlinked = pass.reduce((a, p) => a + p.unlinked, 0);
    const notUploaded = pass.filter((p) => p.status === "NONE");
    items.push({
      key: "pass",
      ok: pass.every((p) => p.status === "CONFIRMED") && unlinked === 0,
      label: pass.length === 1 ? `출입증 ${passStatusLabel(pass[0].status)}` : `출입증 ${pass.map((p) => `${p.label} ${passStatusLabel(p.status)}`).join(" · ")}`,
      detail: unlinked
        // 연결 예산 항목은 재무 승인 담당만 정할 수 있다 (PM은 프로젝트 운영비 조회만) — PM에게는 요청하라고 안내
        ? `회사 부담 ${unlinked}건이 예산 항목에 연결되지 않아 본사 집행내역에 빠집니다. 재무 승인 담당에게 연결 예산 항목 지정을 요청하세요.`
        : notUploaded.length ? `${pass.length > 1 ? `${notUploaded.map((p) => p.label).join(", ")}: ` : ""}업체 내역을 아직 올리지 않았습니다` : undefined,
      href: unlinked ? `/budget?from=closing&ym=${ym}` : `/pass?ym=${ym}&from=closing`,
    });
  }
  return items;
}

/** 출입증 상태 짧은 이름 */
export const passStatusLabel = (s: PassStatementState["status"]) => (s === "CONFIRMED" ? "확정" : s === "OPEN" ? "확정 전" : "내역 없음");

/** 체크리스트 한 줄 요약 — "확인 2건 · 입력 4/5명 · 점검 1건" / "준비 완료" */
export function checklistSummary(items: CheckItem[]): { ok: boolean; text: string } {
  const bad = items.filter((i) => !i.ok);
  if (!bad.length) return { ok: true, text: "마감 준비 완료" };
  return { ok: false, text: `확인 ${bad.length}건 · ${bad.map((i) => i.label).join(" · ")}` };
}

/** 단계 표시: 작성 → 마감 → 상신 → 승인. done = 지난 단계 수, failed = 반려 */
export function closingStage(status: ClosingStatus): { done: number; failed: boolean } {
  switch (status) {
    case "DRAFT": return { done: 1, failed: false };
    case "CLOSED": return { done: 2, failed: false };
    case "SUBMITTED": return { done: 3, failed: false };
    case "APPROVED": return { done: 4, failed: false };
    case "REJECTED": return { done: 3, failed: true };
  }
}
