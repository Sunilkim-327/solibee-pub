// 마스터 관리 화면의 작은 계산 (순수함수)
import { digitsOnly } from "@/lib/format";
import { projectSetupIssues, type SetupIssue } from "@/lib/user-admin";
import type { Category, Project } from "./types";

/** 숫자만 (최대 9자리, 문자열) */
export const digits = (s: string) => digitsOnly(s, 9);
/** 분류의 공통 항목 (프로젝트에 속하지 않은 항목) */
export const templatesOf = (c: Category) => c.items.filter((i) => i.projectId === null);

/** 시작 준비 미비 중 심각한 것 */
export const SEVERE: SetupIssue[] = ["NO_BUDGET", "NO_PM"];
/** 시작 준비 미비 — 종료·보관된 프로젝트는 따지지 않음 */
export const issuesOf = (p: Project) => p.closed || p.archived ? [] : projectSetupIssues({
  budgetLines: p.budgetLineCount, members: p.members,
});

export type Filter = "all" | "setup" | "active" | "done";
export const FILTERS: [Filter, string][] = [["all", "전체"], ["setup", "준비 필요"], ["active", "진행"], ["done", "종료·보관"]];
export const matchFilter = (p: Project, f: Filter) =>
  f === "all" ? true
    : f === "setup" ? issuesOf(p).length > 0
      : f === "done" ? p.phase === "CLOSED" || p.phase === "ARCHIVED"
        : p.phase !== "CLOSED" && p.phase !== "ARCHIVED";
