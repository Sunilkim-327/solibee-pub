import { describe, expect, it } from "vitest";
import { pmResetProblem, type ResetTarget } from "@/lib/pm-reset";

const t = (over: Partial<ResetTarget> = {}, member: ResetTarget["member"] = { isPm: false, leftAt: null }): ResetTarget =>
  ({ id: "u1", role: "MEMBER", active: true, member, ...over });

describe("PM의 팀원 임시 비밀번호 발급 대상", () => {
  it("내 프로젝트의 현재 팀원이면 가능", () => {
    expect(pmResetProblem("pm", t())).toBeNull();
  });
  it("팀원이 아니면 불가", () => {
    expect(pmResetProblem("pm", null)).toMatch(/팀원이 아닙니다/);
    expect(pmResetProblem("pm", t({}, null))).toMatch(/팀원이 아닙니다/);
  });
  it("본인·다른 PM·재무팀·관리자는 불가", () => {
    expect(pmResetProblem("u1", t())).toMatch(/본인/);
    expect(pmResetProblem("pm", t({}, { isPm: true, leftAt: null }))).toMatch(/다른 PM/);
    expect(pmResetProblem("pm", t({ pmElsewhere: true }))).toMatch(/다른 PM/);
    expect(pmResetProblem("pm", t({ role: "HQ" }))).toMatch(/관리자만/);
    expect(pmResetProblem("pm", t({ role: "ADMIN" }))).toMatch(/관리자만/);
  });
  it("내가 PM이 아닌 다른 프로젝트에도 속한 팀원은 불가", () => {
    expect(pmResetProblem("pm", t({ outsideMine: true }))).toMatch(/다른 PM의 프로젝트/);
    expect(pmResetProblem("pm", t({ outsideMine: false }))).toBeNull();
  });
  it("이전 팀원·비활성 계정은 불가", () => {
    expect(pmResetProblem("pm", t({}, { isPm: false, leftAt: "2026-09-30" }))).toMatch(/이전 팀원/);
    expect(pmResetProblem("pm", t({ active: false }))).toMatch(/비활성/);
  });
});
