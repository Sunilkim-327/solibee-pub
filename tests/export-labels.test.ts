import { describe, expect, it } from "vitest";
import { payerLabels, sumifCriteria, sumifText } from "@/lib/export";

const exp = (payerId: string, name: string, extra: Partial<{ isHq: boolean; payMethod: string }> = {}) => ({
  isHq: false, payMethod: "PERSONAL_CARD", payerId, payer: { name }, ...extra,
});

describe("payerLabels (엑셀 결제자 라벨)", () => {
  it("동명이인은 이름(2)", () => {
    const { labelOf } = payerLabels([{ id: "a", name: "김가" }, { id: "b", name: "김가" }, { id: "c", name: "김가" }], []);
    expect([labelOf.get("a"), labelOf.get("b"), labelOf.get("c")]).toEqual(["김가", "김가(2)", "김가(3)"]);
  });
  it("SUMIF 와일드카드 문자(* ? ~)는 ·로 바꾸고, 비면 '결제자'", () => {
    const { labelOf } = payerLabels([{ id: "a", name: "가*나?다~" }, { id: "b", name: "  " }], []);
    expect(labelOf.get("a")).toBe("가·나·다·");
    expect(labelOf.get("b")).toBe("결제자");
  });
  it("공용법인카드·본사는 예약 라벨", () => {
    const { labelOf } = payerLabels([{ id: "a", name: "본사" }, { id: "b", name: "공용법인카드" }], []);
    expect(labelOf.get("a")).toBe("본사(2)");
    expect(labelOf.get("b")).toBe("공용법인카드(2)");
  });
  it("마스터에 없는 개인카드 결제자만 추가 (본사·공용카드 제외, 중복 없음)", () => {
    const { allPayers, labelOf } = payerLabels([{ id: "a", name: "갑" }], [
      exp("a", "갑"),
      exp("x", "을"),
      exp("x", "을"),
      exp("h", "재무", { isHq: true }),
      exp("s", "공용", { payMethod: "SHARED_CARD" }),
    ]);
    expect(allPayers).toEqual([{ id: "a", name: "갑" }, { id: "x", name: "을" }]);
    expect(labelOf.get("x")).toBe("을");
    expect(labelOf.has("h")).toBe(false);
  });
});

describe("SUMIF 조건 이스케이프", () => {
  it("와일드카드는 ~로, 비교 연산자로 시작하면 = 붙임", () => {
    expect(sumifCriteria("식대")).toBe("식대");
    expect(sumifCriteria("A*B?C~")).toBe("A~*B~?C~~");
    expect(sumifCriteria("<특별>")).toBe("=<특별>");
    expect(sumifCriteria("=합계")).toBe("==합계");
    expect(sumifText('따옴표"*')).toBe('"따옴표""~*"');
  });
  it("결제자 라벨은 비교 연산자로 시작하지 않음", () => {
    const { labelOf } = payerLabels([{ id: "a", name: "=홍" }, { id: "b", name: ">>김" }], []);
    expect(labelOf.get("a")).toBe("·홍");
    expect(labelOf.get("b")).toBe("·김");
  });
});
