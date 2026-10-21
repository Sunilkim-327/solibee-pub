"use client";

import { useState } from "react";
import type { ExpenseRow, InputContext, MasterCategory } from "@/lib/dto";
import { won } from "@/lib/format";
import { flagLabel, isAdvisory, parseFlags } from "@/lib/policy";
import { PAY_METHOD_LABEL, type Role } from "@/lib/types";
import { Headcount, ListRow, MetaLine } from "./list/ListRow";
import { DayGroup } from "./list/DayGroup";
import { ExpenseEditSheet } from "./MonthlyTable";

/** 행 배지 — 현황 지출 내역(MonthlyTable RowBadge)과 같은 규칙: 점검 > 변경 과업 > 본사 > 개인카드 외 결제방법 (개인카드는 기본값이라 숨김) */
function RowBadge({ r }: { r: ExpenseRow }) {
  if (r.flags) {
    const codes = parseFlags(r.flags);
    const bad = codes.filter((c) => !isAdvisory(c));
    return bad.length
      ? <span className="badge badge-warn" title={bad.map((c) => flagLabel(c, r.itemName)).join(", ")}>⚠ {bad.length > 1 ? `점검 ${bad.length}` : bad[0] === "PASS_DUP" ? flagLabel(bad[0], r.itemName) : "점검"}</span>
      : <span className="badge badge-neutral" title={codes.map((c) => flagLabel(c, r.itemName)).join(", ")}>ⓘ 안내</span>;
  }
  if (r.changeLabel) return <span className="badge badge-primary" title={r.changeLabel}>{r.changeLabel.split(" · ")[0]}</span>;
  if (r.isHq) return <span className="badge badge-neutral">본사</span>;
  if (r.payMethod !== "PERSONAL_CARD") return <span className="badge badge-neutral">{PAY_METHOD_LABEL[r.payMethod]}</span>;
  return null;
}

type Props = {
  rows: ExpenseRow[];
  /** 이 건수를 넘으면 목록 높이를 고정하고 안에서 스크롤 (전부 이 화면에서 대조·수정할 수 있게) */
  limit?: number;
  projectId: string;
  role: Role;
  /** 수정 폼용 입력 가능 항목 */
  categories: MasterCategory[];
  context: InputContext;
  lockedMonths: string[];
  tasks?: { id: string; label: string; itemIds: string[] | null }[];
  pmNames?: string[];
  userId?: string;
};

/**
 * 지출 입력 화면의 '이번 달 내 지출' (날짜별 묶음) — 누르면 이 화면에서 바로 수정 시트.
 * 마감된 달·수정할 수 없는 건은 잠금 표시만 (누를 수 없음).
 */
export function MyExpenseList({ rows, limit = 5, categories, ...formProps }: Props) {
  const [open, setOpen] = useState<ExpenseRow | null>(null);
  if (rows.length === 0) return <p className="border-t border-line px-5 py-10 text-center text-sm text-fg-muted">아직 입력된 지출이 없어요.</p>;
  const locked = new Set(formProps.lockedMonths);
  return (
    <div className={`border-t border-line pb-2 ${rows.length > limit ? "max-h-[22rem] overflow-y-auto overscroll-contain" : ""}`}
      tabIndex={rows.length > limit ? 0 : undefined} aria-label={rows.length > limit ? `내 지출 ${rows.length}건 (스크롤)` : undefined}>
      <DayGroup items={rows} dateOf={(r) => r.date} amountOf={(r) => r.amount} inset="text" band headClassName="px-4 sm:px-5"
        render={(r) => {
          const editable = r.editable && !locked.has(r.yearMonth);
          const violation = !!r.flags && parseFlags(r.flags).some((c) => !isAdvisory(c));
          return (
            <ListRow key={r.id}
              badge={<RowBadge r={r} />} title={r.detail || r.itemName} amount={r.amount}
              meta={<MetaLine parts={[r.itemName, r.headcount && r.headcount > 1 ? <Headcount n={r.headcount} /> : null, r.enteredByName ? `${r.enteredByName} 입력` : null]} />}
              chevron={editable} locked={!editable && (locked.has(r.yearMonth) ? "마감된 달" : "수정할 수 없는 건")}
              onPress={editable ? () => setOpen(r) : undefined}
              ariaLabel={`${r.detail || r.itemName} ${won(r.amount)}원${editable ? " 수정" : ""}`}
              accent={violation ? "warn" : undefined} />
          );
        }} />
      {open && <ExpenseEditSheet {...formProps} row={open} categories={categories} onClose={() => setOpen(null)} />}
    </div>
  );
}
