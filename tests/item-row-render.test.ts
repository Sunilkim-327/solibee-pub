import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItemRow } from "@/components/budget/ItemRow";

const noop = () => {};
const months = ["2026-01", "2026-02", "2026-03"];
const props = (edit: boolean, extra: Partial<Parameters<typeof ItemRow>[0]> = {}) => ({
  item: { id: "i", name: "야근식대", code: null, categoryId: "c", perPersonLimit: 15000, hardBudget: false, active: true, needsAttendees: true },
  edit, open: false, onToggle: noop,
  lines: [{ key: "k", itemId: "i", detail: "", unitPrice: 100000, periods: 12, changeId: "", bundle: [] }],
  planned: 1_200_000, spent: 0, ownSpent: 0, bundledInto: null, nameOf: (id: string) => id,
  settings: { name: "야근식대", categoryId: "c", perPersonLimit: 15000, hardBudget: false, needsAttendees: true, active: true },
  months: 12, changes: [], candidates: [], categories: [{ id: "c", name: "프로젝트운영" }], onDelete: noop,
  onMove: noop, first: true, last: true, passLinked: null,
  trend: { months, monthOf: (ym: string) => (ym === "2026-02" ? 300_000 : 0), closings: { "2026-01": "CLOSED" }, elapsed: 2, now: "2026-02" },
  onPrice: noop, onPatchLine: noop, onRemoveLine: noop, onAddLine: noop, onAddBundle: noop, onRemoveBundle: noop, onSetting: noop,
  ...extra,
});
const html = (edit: boolean, extra?: Partial<Parameters<typeof ItemRow>[0]>) => renderToStaticMarkup(createElement(ItemRow, props(edit, extra)));

describe("예산 항목 행 — 펼치기 없이 행이 곧 전부", () => {
  it("조회: 한 행짜리는 행 안에 단가·기간, 기본값이 아닌 설정만 칩, 보조 줄·체크박스 없음", () => {
    const h = html(false);
    expect(h).toContain("100,000");
    expect(h).toContain("1인당 15,000원");
    expect(h).not.toContain("참석자 필수");
    expect(h).not.toContain("type=\"checkbox\"");
    expect(h).not.toContain("↳");
    expect(h).not.toContain("더 보기");
  });
  it("한 행짜리의 상세내역은 항목명 옆에 흐리게 — 보조 줄 없음", () => {
    const h = html(false, { lines: [{ key: "k", itemId: "i", detail: "회식비 월 한도", unitPrice: 100000, periods: 12, changeId: "", bundle: [] }] });
    expect(h).toContain("회식비 월 한도");
    expect(h).not.toContain("↳");
    expect(h).toContain("100,000");
  });
  it("조회: 기본 설정이면 칩이 하나도 없다", () => {
    const h = html(false, { settings: { name: "x", categoryId: "c", perPersonLimit: null, hardBudget: false, needsAttendees: true, active: true } });
    expect(h).not.toContain("1인당");
    expect(h).not.toContain("잔액 초과 막기");
    expect(h).not.toContain("사용 안 함");
  });
  it("예산 행이 여럿이면 보조 줄로 항상 보인다 (상세내역 · 단가 × 기간 = 금액 · 변경계약)", () => {
    const h = html(false, {
      lines: [
        { key: "a", itemId: "i", detail: "당초", unitPrice: 100000, periods: 12, changeId: "", bundle: [] },
        { key: "b", itemId: "i", detail: "증액", unitPrice: 50000, periods: 6, changeId: "ch1", bundle: [] },
      ],
      changes: [{ id: "ch1", label: "변경 1차 · 범위 확대", from: "2026-03" }],
      planned: 1_500_000,
    });
    expect(h).toContain("↳");
    expect(h).toContain("당초");
    expect(h).toContain("증액");
    expect(h).toContain("변경 1차");
    expect(h).toContain("300,000");
  });
  it("편집: 행 안 단가·기간 입력 + ⋯ 메뉴, 보조 줄이 있으면 그 자리 입력과 '+ 예산 행'", () => {
    const h = html(true);
    expect(h).toContain("야근식대 단가");
    expect(h).toContain("더 보기");
    expect(h).not.toContain("+ 예산 행");
    const multi = html(true, { lines: [
      { key: "a", itemId: "i", detail: "", unitPrice: 100000, periods: 12, changeId: "", bundle: [] },
      { key: "b", itemId: "i", detail: "", unitPrice: 50000, periods: 6, changeId: "", bundle: [] },
    ] });
    expect(multi).toContain("+ 예산 행");
    expect(multi).toContain("상세내역 (선택)");
    expect(multi).not.toContain("야근식대 단가");
  });
  it("펼치면 추이 패널 — 작은 사실·월별 집행·누적 추이", () => {
    const h = html(false, { open: true, spent: 300_000 });
    expect(h).toContain("월별 집행");
    expect(h).toContain("누적 추이");
    expect(h).toContain("가장 많이 쓴 달");
    expect(h).toContain("2월 300,000");
    expect(h).toContain("표로 보기");
  });
});

describe("예산은 하나, 쓰는 방법은 둘 (출입증 연결)", () => {
  it("막대 아래 카드 · 출입증 나눔 + 확정 전은 흐리게, '별도·예산 미포함' 문구 없음", () => {
    const h = html(false, { spent: 400_000, passLinked: { confirmed: 80_000, pending: 15_000, names: ["야근식대(출입증)"] } });
    expect(h).toContain("카드 320,000");
    expect(h).toContain("출입증 80,000");
    expect(h).toContain("(출입증 확정 전 15,000)");
    expect(h).not.toContain("예산 미포함");
    expect(h).not.toContain("합치면");
  });
  it("확정 전이 없으면 그 표시는 없다", () => {
    const h = html(false, { spent: 50_000, passLinked: { confirmed: 0, pending: 0, names: ["x"] } });
    expect(h).toContain("카드 50,000");
    expect(h).not.toContain("확정 전");
  });
});
