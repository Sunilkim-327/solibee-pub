import { describe, expect, it } from "vitest";
import { checklistSummary, closingChecklist, closingStage } from "@/lib/closing-checklist";

const payers = [{ id: "a", name: "가" }, { id: "b", name: "나" }, { id: "c", name: "다" }];

describe("마감 준비 체크리스트", () => {
  it("입력 n/m명 — 지출 있는 결제자 수, 미입력자 이름", () => {
    const items = closingChecklist({ ym: "2026-10", payers, expenses: [{ payerId: "a", flags: null, justification: null }], isValid: true, pass: null });
    const input = items.find((i) => i.key === "input")!;
    expect(input.label).toBe("입력 1/3명");
    expect(input.ok).toBe(false);
    expect(input.detail).toContain("나, 다");
  });
  it("결제자 마스터에 없는 사람의 지출은 입력 수에 넣지 않는다", () => {
    const items = closingChecklist({ ym: "2026-10", payers, expenses: ["a", "b", "c", "x"].map((payerId) => ({ payerId, flags: null, justification: null })), isValid: true, pass: null });
    expect(items[0]).toMatchObject({ label: "입력 3/3명", ok: true });
  });
  it("규정 점검: 소명이 모두 있으면 문제 없음, 없으면 확인 + 링크", () => {
    const base = { ym: "2026-10", payers: [], isValid: true, pass: null };
    const unexplained = closingChecklist({ ...base, expenses: [{ payerId: "a", flags: "PER_PERSON", justification: " " }] }).find((i) => i.key === "flags")!;
    // 소명이 빠진 건이 있으면 지출 내역의 '소명 필요' 탭으로
    expect(unexplained).toMatchObject({ ok: false, label: "규정 점검 1건", detail: "소명 필요 1건", href: "/dashboard?ym=2026-10&check=unexplained&from=closing#ledger" });
    const explained = closingChecklist({ ...base, expenses: [{ payerId: "a", flags: "PER_PERSON", justification: "야근" }] }).find((i) => i.key === "flags")!;
    expect(explained).toMatchObject({ ok: true, href: "/dashboard?ym=2026-10&check=flag&from=closing#ledger" });
    // 안내성 점검(계정 확인)만 있는 건은 세지 않음 — 월별 '확인 필요' 탭과 같은 기준
    const advisory = closingChecklist({ ...base, expenses: [{ payerId: "a", flags: "ACCOUNT_CHECK", justification: null }] }).find((i) => i.key === "flags")!;
    expect(advisory).toMatchObject({ ok: true, label: "규정 점검 0건" });
  });
  it("검증 불일치와 출입증 미확정은 확인 항목", () => {
    const items = closingChecklist({ ym: "2026-09", payers: [], expenses: [], isValid: false, pass: [{ projectId: "p", label: "운영", status: "OPEN", unlinked: 0 }] });
    expect(items.find((i) => i.key === "valid")!.ok).toBe(false);
    expect(items.find((i) => i.key === "pass")).toMatchObject({ ok: false, href: "/pass?ym=2026-09&from=closing" });
    expect(checklistSummary(items).ok).toBe(false);
  });
  it("출입증을 쓰지 않으면 항목이 없고, 모두 통과하면 준비 완료", () => {
    const items = closingChecklist({ ym: "2026-10", payers: [payers[0]], expenses: [{ payerId: "a", flags: null, justification: null }], isValid: true, pass: null });
    expect(items.some((i) => i.key === "pass")).toBe(false);
    expect(checklistSummary(items)).toEqual({ ok: true, text: "마감 준비 완료" });
  });
  it("입력 대상 팀원이 없으면(PM만 입력) 입력 확인 줄이 없다", () => {
    const items = closingChecklist({ ym: "2026-10", payers: [], expenses: [{ payerId: "pm", flags: null, justification: null }], isValid: true, pass: null });
    expect(items.some((i) => i.key === "input")).toBe(false);
    expect(checklistSummary(items)).toEqual({ ok: true, text: "마감 준비 완료" });
  });
  it("단계: 반려는 상신까지 지나고 실패 표시", () => {
    expect(closingStage("DRAFT")).toEqual({ done: 1, failed: false });
    expect(closingStage("APPROVED").done).toBe(4);
    expect(closingStage("REJECTED")).toEqual({ done: 3, failed: true });
  });
});

describe("출입증 회사 부담의 연결 예산 항목", () => {
  it("확정했어도 연결되지 않은 회사 부담이 있으면 확인 항목 (프로젝트 운영비로)", () => {
    const items = closingChecklist({ ym: "2026-09", payers: [], expenses: [], isValid: true, pass: [{ projectId: "p", label: "운영", status: "CONFIRMED", unlinked: 3 }] });
    const pass = items.find((i) => i.key === "pass")!;
    expect(pass.ok).toBe(false);
    expect(pass.detail).toContain("3건");
    expect(pass.href).toBe("/budget?from=closing&ym=2026-09");
  });
  it("모두 연결되어 있으면 준비 완료", () => {
    const items = closingChecklist({ ym: "2026-09", payers: [], expenses: [], isValid: true, pass: [{ projectId: "p", label: "운영", status: "CONFIRMED", unlinked: 0 }] });
    expect(items.find((i) => i.key === "pass")).toMatchObject({ ok: true, href: "/pass?ym=2026-09&from=closing" });
  });
});

describe("출입증 — 함께 상신하는 묶음(구분별)", () => {
  it("메인·서브 출입증을 구분별로 보여 주고, 하나라도 확정 전이면 확인 항목", () => {
    const items = closingChecklist({ ym: "2026-09", payers: [], expenses: [], isValid: true, pass: [
      { projectId: "m", label: "운영", status: "CONFIRMED", unlinked: 0 },
      { projectId: "s", label: "대응", status: "OPEN", unlinked: 0 },
    ] });
    const pass = items.find((i) => i.key === "pass")!;
    expect(pass).toMatchObject({ ok: false, label: "출입증 운영 확정 · 대응 확정 전", href: "/pass?ym=2026-09&from=closing" });
  });
  it("내역을 올리지 않은 구분은 이름을 붙여 안내, 모두 확정이면 통과", () => {
    const none = closingChecklist({ ym: "2026-09", payers: [], expenses: [], isValid: true, pass: [
      { projectId: "m", label: "운영", status: "CONFIRMED", unlinked: 0 },
      { projectId: "s", label: "대응", status: "NONE", unlinked: 0 },
    ] }).find((i) => i.key === "pass")!;
    expect(none.detail).toBe("대응: 업체 내역을 아직 올리지 않았습니다");
    const all = closingChecklist({ ym: "2026-09", payers: [], expenses: [], isValid: true, pass: [
      { projectId: "m", label: "운영", status: "CONFIRMED", unlinked: 0 },
      { projectId: "s", label: "대응", status: "CONFIRMED", unlinked: 0 },
    ] }).find((i) => i.key === "pass")!;
    expect(all).toMatchObject({ ok: true, label: "출입증 운영 확정 · 대응 확정" });
    // 빈 배열은 출입증을 쓰지 않는 것과 같다
    expect(closingChecklist({ ym: "2026-09", payers: [], expenses: [], isValid: true, pass: [] }).some((i) => i.key === "pass")).toBe(false);
  });
});
