import { describe, expect, it } from "vitest";
import { remindBody, remindMailto, remindSubject } from "@/lib/remind";

const people = [
  { id: "a", name: "이서준", email: "a@x.com", count: 2 },
  { id: "b", name: "박지민", email: null, count: 1 },
];
const opts = { ym: "2026-10", projectName: "플랫폼 운영", people, origin: "https://ex.test" };

describe("독촉 문구", () => {
  it("미입력: 이름·월·입력 링크", () => {
    const t = remindBody("noinput", opts);
    expect(t).toContain("이서준·박지민님");
    expect(t).toContain("10월 운영비 지출이 아직 입력되지 않았어요");
    expect(t).toContain("https://ex.test/expenses/new");
  });
  it("소명: 사람별 건수와 소명 링크", () => {
    const t = remindBody("unexplained", opts);
    expect(t).toContain("- 이서준 2건");
    expect(t).toContain("/dashboard?ym=2026-10&check=unexplained");
    expect(remindSubject("unexplained", "2026-10", "플랫폼 운영")).toBe("[운영비] 플랫폼 운영 10월 규정 점검 소명 요청");
  });
  it("메일: 주소 있는 사람만 숨은 참조, 공백은 %20", () => {
    const m = remindMailto("noinput", opts)!;
    expect(m.startsWith("mailto:?bcc=a%40x.com&")).toBe(true);
    expect(m).not.toContain("+");
    expect(remindMailto("noinput", { ...opts, people: [people[1]] })).toBeNull();
  });
});
