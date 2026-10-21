// 상신 가드 — 순수함수 (lib/closing.ts submitBlockers 등) 설계 검토(2026-10-14) P0-1
import { describe, expect, it } from "vitest";
import {
  BLOCKER_LABEL, SUBMIT_BLOCKED, SUBMIT_REASON_MAX, canOverrideBlockers, overrideLabels, parseSubmitOverride, submitBlockers, submitOverrideProblem, type SubmitGuardInput,
} from "@/lib/closing";

const base: SubmitGuardInput = { ym: "2026-09", passStatements: null, unexplainedCount: 0, settlementInvalid: false };
const codes = (x: Partial<SubmitGuardInput>) => submitBlockers({ ...base, ...x }).map((b) => b.code);

describe("submitBlockers", () => {
  it("문제가 없으면 빈 목록 — 출입증을 쓰지 않거나(null·[]) 모두 확정", () => {
    expect(codes({})).toEqual([]);
    expect(codes({ passStatements: [] })).toEqual([]);
    expect(codes({ passStatements: [{ projectId: "m", label: "운영", status: "CONFIRMED", unlinked: 0 }] })).toEqual([]);
  });
  it("출입증 확정 전·내역 없음 → PASS_OPEN (구분 이름·월이 문구에)", () => {
    const open = submitBlockers({ ...base, passStatements: [{ projectId: "s", label: "대응", status: "OPEN", unlinked: 0 }] });
    expect(open).toEqual([{ code: "PASS_OPEN", message: expect.stringContaining("대응 9월 출입증 확정 전") }]);
    const none = submitBlockers({ ...base, passStatements: [{ projectId: "m", label: "운영", status: "NONE", unlinked: 0 }] });
    expect(none[0]).toMatchObject({ code: "PASS_OPEN", message: expect.stringContaining("출입증 내역 없음") });
  });
  it("연결 예산 항목 없는 회사 부담 → PASS_UNLINKED (확정돼도)", () => {
    const list = submitBlockers({ ...base, passStatements: [{ projectId: "m", label: "운영", status: "CONFIRMED", unlinked: 2 }] });
    expect(list).toEqual([{ code: "PASS_UNLINKED", message: expect.stringContaining("2건") }]);
  });
  it("소명 없음 → UNEXPLAINED, 서브 미처리 → SUB_NOT_READY (준비된 서브는 제외)", () => {
    expect(codes({ unexplainedCount: 3 })).toEqual(["UNEXPLAINED"]);
    const list = submitBlockers({ ...base, subReady: [{ name: "대응", ready: false, detail: "소명 없는 규정 점검 1건" }, { name: "교육", ready: true }] });
    expect(list).toEqual([{ code: "SUB_NOT_READY", message: "대응 미처리 — 소명 없는 규정 점검 1건" }]);
  });
  it("검증 불일치 → INVALID가 맨 앞, 여러 항목이 함께 나온다", () => {
    expect(codes({ settlementInvalid: true, unexplainedCount: 1, passStatements: [{ projectId: "m", label: "운영", status: "OPEN", unlinked: 1 }] }))
      .toEqual(["INVALID", "PASS_OPEN", "PASS_UNLINKED", "UNEXPLAINED"]);
  });
});

describe("사유로 넘기기 (submitOverrideProblem)", () => {
  const pass = submitBlockers({ ...base, passStatements: [{ projectId: "m", label: "운영", status: "OPEN", unlinked: 0 }] });
  it("미완료 항목이 없으면 사유와 무관하게 통과", () => {
    expect(submitOverrideProblem([], undefined)).toBeNull();
    expect(submitOverrideProblem([], "")).toBeNull();
  });
  it("사유 없음 → 409 SUBMIT_BLOCKED (blockers·hint·overridable)", () => {
    const p = submitOverrideProblem(pass, undefined)!;
    expect(p.status).toBe(409);
    expect(p.extra).toMatchObject({ code: SUBMIT_BLOCKED, blockers: pass, overridable: true, hint: "사유를 적으면 그대로 상신할 수 있습니다" });
    expect(submitOverrideProblem(pass, "   ")?.status).toBe(409);
  });
  it("사유 길이 10~300자 — 미달·초과는 400", () => {
    expect(submitOverrideProblem(pass, "짧은 사유")).toMatchObject({ status: 400, message: expect.stringContaining("10자 이상") });
    expect(submitOverrideProblem(pass, "가".repeat(SUBMIT_REASON_MAX + 1))).toMatchObject({ status: 400, message: expect.stringContaining("300자 이내") });
    expect(submitOverrideProblem(pass, "업체 출입증 내역이 다음 주 도착 — 10월에 합산 예정")).toBeNull();
    expect(submitOverrideProblem(pass, `  ${"가".repeat(10)}  `)).toBeNull();
  });
  it("검증 불일치(INVALID)는 사유가 있어도 409, overridable:false — 마감 규칙과 같게", () => {
    const invalid = submitBlockers({ ...base, settlementInvalid: true, unexplainedCount: 1 });
    expect(canOverrideBlockers(invalid)).toBe(false);
    expect(canOverrideBlockers(pass)).toBe(true);
    expect(canOverrideBlockers([])).toBe(false);
    const p = submitOverrideProblem(invalid, "충분히 긴 사유를 적어도 넘길 수 없다")!;
    expect(p.status).toBe(409);
    expect(p.extra).toMatchObject({ code: SUBMIT_BLOCKED, overridable: false });
    expect(p.extra?.hint).toBeUndefined();
  });
});

describe("가드 무시 기록 (submitOverride JSON)", () => {
  it("저장한 JSON을 읽고 모르는 코드는 버린다, 깨진 값은 null", () => {
    const o = parseSubmitOverride(JSON.stringify({ reason: "사유", blockers: ["PASS_OPEN", "NOPE", "UNEXPLAINED"], at: "2026-10-05T09:00:00.000Z" }))!;
    expect(o).toEqual({ reason: "사유", blockers: ["PASS_OPEN", "UNEXPLAINED"], at: "2026-10-05T09:00:00.000Z" });
    expect(overrideLabels(o)).toBe("출입증 확정 전 · 소명 없음");
    expect(overrideLabels({ reason: "", blockers: ["PASS_OPEN", "PASS_OPEN"], at: "" })).toBe(BLOCKER_LABEL.PASS_OPEN);
    expect(parseSubmitOverride(null)).toBeNull();
    expect(parseSubmitOverride("{broken")).toBeNull();
    expect(parseSubmitOverride(JSON.stringify({ blockers: [] }))).toBeNull();
  });
});
