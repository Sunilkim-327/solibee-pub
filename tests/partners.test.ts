import { describe, expect, it } from "vitest";
import { attendeeNames, cleanPartners, partnerLabel, referencedPartners } from "@/lib/partners";

describe("협력 인력", () => {
  it("표기: 소속이 있으면 이름(소속)", () => {
    expect(partnerLabel({ name: "홍길동", company: "가나테크" })).toBe("홍길동(가나테크)");
    expect(partnerLabel({ name: "홍길동", company: null })).toBe("홍길동");
  });
  it("정리: 공백 제거, 빈 소속은 null, active 기본 true", () => {
    expect(cleanPartners([{ name: " 홍길동 ", company: " " }])).toEqual({ list: [{ name: "홍길동", company: null, active: true }] });
  });
  it("쉼표·괄호 금지 (참석자는 쉼표로 구분해 저장)", () => {
    expect(cleanPartners([{ name: "홍,길동" }])).toHaveProperty("error");
    expect(cleanPartners([{ name: "홍길동", company: "가나(주)" }])).toHaveProperty("error");
  });
  it("같은 표기 중복 금지, 이름 필수, 배열 아님 거부", () => {
    expect(cleanPartners([{ name: "홍길동", company: "가" }, { name: "홍길동", company: "가" }])).toHaveProperty("error");
    expect(cleanPartners([{ name: "홍길동", company: "가" }, { name: "홍길동", company: "나" }])).toHaveProperty("list");
    expect(cleanPartners([{ name: "" }])).toHaveProperty("error");
    expect(cleanPartners("x")).toHaveProperty("error");
  });
});

describe("협력 인력 삭제 vs 사용 안 함 (기록이 참조하면 비활성, 없을 때만 삭제)", () => {
  const a = { id: "a", name: "홍길동", company: "가나테크" };
  const b = { id: "b", name: "김철수", company: null };
  const c = { id: "c", name: "이영희", company: "다라" };
  it("참석자 문자열을 이름 목록으로 (쉼표·전각 쉼표, 공백 제거)", () => {
    expect(attendeeNames(" 홍길동(가나테크), 김철수 ，이영희 ")).toEqual(["홍길동(가나테크)", "김철수", "이영희"]);
    expect(attendeeNames(null)).toEqual([]);
  });
  it("저장된 표기(이름(소속))나 이름만으로 등장하면 기록 있음", () => {
    expect(referencedPartners([a, b, c], ["박팀원, 홍길동(가나테크)", null, "김철수"]).map((p) => p.id)).toEqual(["a", "b"]);
    expect(referencedPartners([a], ["홍길동"]).map((p) => p.id)).toEqual(["a"]);
  });
  it("부분 일치는 기록으로 보지 않음 (홍길동2·다른 소속)", () => {
    expect(referencedPartners([a], ["홍길동2", "홍길동(마바)"])).toEqual([]);
    expect(referencedPartners([], ["홍길동"])).toEqual([]);
  });
});
