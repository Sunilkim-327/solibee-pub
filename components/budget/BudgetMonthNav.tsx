"use client";

import { useSearchParams } from "next/navigation";
import { MonthNav } from "../MonthNav";

/**
 * 프로젝트 운영비 머리글의 월 이동 — 월별 보기(?view=monthly)일 때만 보인다.
 * 보기 전환은 ProjectBudget이 주소(replaceState)로 남기므로 여기서 그 값을 읽어 바로 따라간다.
 */
export function BudgetMonthNav({ months, value }: { months: string[]; value: string }) {
  const view = useSearchParams().get("view");
  if (view !== "monthly" || !months.length) return null;
  return <MonthNav months={months} value={value} />;
}
