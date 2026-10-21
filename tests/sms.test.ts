import { describe, expect, it } from "vitest";
import { parseCardSms, parseCardSmsBatch } from "@/lib/sms";

// 카드사별 승인 문자 형식 예시 (가상의 이름·가맹점)
const today = new Date(2026, 9, 9); // 2026-10-09

describe("카드 승인 문자 파싱", () => {
  const cases: [string, string, Partial<ReturnType<typeof parseCardSms>>][] = [
    ["신한", "[Web발신]\n신한카드(1234)승인 홍*동 12,000원(일시불)10/09 12:34 스타벅스강남점 누적123,456원",
      { amount: 12000, date: "2026-10-09", time: "12:34", merchant: "스타벅스강남점", cardCompany: "신한", cardLast4: "1234" }],
    ["KB국민", "[KB국민카드]1234승인\n홍*동님\n35,000원 일시불\n10/08 21:15\n김밥천국\n누적1,234,000원",
      { amount: 35000, date: "2026-10-08", time: "21:15", merchant: "김밥천국", cardCompany: "KB국민", installment: "일시불" }],
    ["삼성", "삼성1234승인 홍*동\n45,000원 일시불\n10/09 19:20 교촌치킨\n누적345,000원",
      { amount: 45000, merchant: "교촌치킨", cardCompany: "삼성", cardLast4: "1234" }],
    ["현대", "[현대카드] 홍*동님 10/07 22:10\n일시불 / 28,500원\n카카오T일반택시",
      { amount: 28500, date: "2026-10-07", time: "22:10", merchant: "카카오T일반택시", cardCompany: "현대" }],
    ["하나", "하나(5678)홍*동님 10/09 13:01 일시불 9,800원 GS25 역삼점",
      { amount: 9800, merchant: "GS25 역삼점", cardCompany: "하나", cardLast4: "5678" }],
    ["우리", "우리(1234)승인 홍*동님 15,000원 일시불 10/09 12:00 이마트24 누적50,000원",
      { amount: 15000, merchant: "이마트24", cardCompany: "우리" }],
    ["롯데", "롯데1234승인 홍*동 25,000원 3개월 10/06 19:30 맥도날드",
      { amount: 25000, installment: "3개월", merchant: "맥도날드", cardCompany: "롯데" }],
    ["NH", "NH카드1234승인 홍*동 32,000원 일시불 10/08 20:11 본죽 총누적 1,000,000원",
      { amount: 32000, merchant: "본죽", cardCompany: "NH농협" }],
  ];

  for (const [name, sms, expected] of cases) {
    it(name, () => expect(parseCardSms(sms, today)).toMatchObject(expected));
  }

  it("취소 문자 표시", () => {
    expect(parseCardSms("신한카드(1234)취소 홍*동 12,000원 10/09 12:34 스타벅스", today).cancelled).toBe(true);
  });

  it("미래 날짜는 작년으로 (1월에 12월 문자)", () => {
    expect(parseCardSms("삼성1234승인 45,000원 12/28 19:20 식당", new Date(2027, 0, 3)).date).toBe("2026-12-28");
  });

  it("여러 문자를 한 번에", () => {
    const text = [
      "[Web발신]\n신한카드(1234)승인 홍*동 12,000원(일시불)10/09 12:34 스타벅스 누적1원",
      "[Web발신]\n삼성1234승인 홍*동\n45,000원 일시불\n10/08 19:20 교촌치킨",
      "",
      "롯데1234승인 홍*동 25,000원 일시불 10/06 19:30 맥도날드",
    ].join("\n");
    expect(parseCardSmsBatch(text, today).map((r) => r.amount)).toEqual([12000, 45000, 25000]);
  });

  it("금액 없는 텍스트는 무시", () => {
    expect(parseCardSmsBatch("안녕하세요", today)).toEqual([]);
  });
});
