import { describe, expect, it } from "vitest";
import { kindMeta, relativeTime, toNotificationItem } from "@/components/notifications/kinds";
import { sentLine } from "@/components/RemindSheet";

// 브라우저 시간대와 무관하게 로컬 생성자로 기준 시각을 만든다
const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const iso = (t: number) => new Date(t).toISOString();

describe("알림 상대 시각", () => {
  const now = at(2026, 10, 14, 15, 0);
  it("방금 · N분 전 · N시간 전(오늘)", () => {
    expect(relativeTime(iso(now - 20_000), now)).toBe("방금");
    expect(relativeTime(iso(now - 3 * 60_000), now)).toBe("3분 전");
    expect(relativeTime(iso(at(2026, 10, 14, 9, 30)), now)).toBe("5시간 전");
  });
  it("어제 · 그 이상은 MM.DD · 다른 해는 YY.MM.DD", () => {
    expect(relativeTime(iso(at(2026, 10, 13, 23, 50)), now)).toBe("어제");
    expect(relativeTime(iso(at(2026, 10, 3, 12, 0)), now)).toBe("10.03");
    expect(relativeTime(iso(at(2025, 12, 31, 12, 0)), now)).toBe("25.12.31");
  });
  it("잘못된 값은 빈 문자열", () => {
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});

describe("알림 종류 표시", () => {
  it("상태색 의미 고정: 반려·승인 취소=bad · 승인=ok · 상신=info · 입력 요청·출입증=neutral", () => {
    expect(kindMeta("closing-reject").tone).toBe("bad");
    expect(kindMeta("closing-revoke").tone).toBe("bad");
    expect(kindMeta("closing-approve").tone).toBe("ok");
    expect(kindMeta("closing-submit").tone).toBe("info");
    for (const k of ["remind-noinput", "remind-unexplained", "pass-check", "pass-confirm"]) expect(kindMeta(k).tone).toBe("neutral");
  });
  it("모르는 kind는 중립 (앞으로 추가돼도 화면이 깨지지 않게)", () => {
    expect(kindMeta("something-new").tone).toBe("neutral");
  });
  it("서버 모델(Date) → 화면용 문자열", () => {
    const d = new Date("2026-10-14T06:00:00.000Z");
    expect(toNotificationItem({ id: "n1", kind: "closing-submit", title: "t", createdAt: d })).toEqual({
      id: "n1", kind: "closing-submit", title: "t", body: null, href: null, projectId: null, createdAt: "2026-10-14T06:00:00.000Z", readAt: null,
    });
    expect(toNotificationItem({ id: "n3", kind: "closing-reject", title: "t", projectId: "p1", createdAt: d }).projectId).toBe("p1");
    expect(toNotificationItem({ id: "n2", kind: "x", title: "t", body: "b", href: "/closing", createdAt: d, readAt: d }).readAt).toBe("2026-10-14T06:00:00.000Z");
  });
});

describe("앱 알림 보낸 결과 문구", () => {
  it("N명에게 보냈어요 (오늘 이미 보낸 M명 제외)", () => {
    expect(sentLine({ created: 3, skipped: 0 })).toBe("3명에게 보냈어요");
    expect(sentLine({ created: 2, skipped: 1 })).toBe("2명에게 보냈어요 (오늘 이미 보낸 1명 제외)");
    expect(sentLine({ created: 0, skipped: 2 })).toBe("오늘 이미 2명 모두에게 보냈어요. 앱 알림은 하루 한 번만 가요.");
  });
});
