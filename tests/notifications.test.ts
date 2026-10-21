import { describe, expect, it } from "vitest";
import { closingNotifications, passNotifications, isPushEndpoint, pushPayload, PUSH_BODY_MAX, remindNotifications } from "@/lib/notifications";

const project = { id: "p1", name: "플랫폼 운영" };

describe("상신·승인·반려 알림", () => {
  it("상신: 재무 승인 담당 모두, key 없음(재상신마다 새 알림), 마감·상신 화면으로", () => {
    const out = closingNotifications({ action: "submit", project, ym: "2026-09", actorId: "pm1", actorName: "김피엠", pmIds: ["pm1"], hqIds: ["hq1", "hq2", "hq1"] });
    expect(out.map((n) => n.userId)).toEqual(["hq1", "hq2"]);
    expect(out[0]).toMatchObject({ kind: "closing-submit", title: "플랫폼 운영 9월 상신 — 검토해 주세요", href: "/closing?ym=2026-09", projectId: "p1", yearMonth: "2026-09" });
    expect(out[0].key).toBeUndefined();
  });
  it("반려: 메인·서브 PM에게 사유를 본문에, 행위자 제외", () => {
    const out = closingNotifications({ action: "reject", project, ym: "2026-09", note: "영수 금액 불일치", actorId: "hq1", pmIds: ["pm1", "pm2", "hq1"], hqIds: ["hq1"] });
    expect(out.map((n) => n.userId)).toEqual(["pm1", "pm2"]);
    expect(out[0]).toMatchObject({ kind: "closing-reject", title: "플랫폼 운영 9월 반려 — 사유를 확인하세요", body: "영수 금액 불일치", href: "/closing?ym=2026-09" });
  });
  it("사유가 없으면 '사유를 확인하세요'를 붙이지 않는다", () => {
    const [n] = closingNotifications({ action: "reject", project, ym: "2026-09", note: "  ", pmIds: ["pm1"], hqIds: [] });
    expect(n).toMatchObject({ title: "플랫폼 운영 9월 반려", body: null });
  });
  it("승인 취소·승인", () => {
    const revoke = closingNotifications({ action: "revoke", project, ym: "2026-12", note: "재검토", pmIds: ["pm1"], hqIds: [] });
    expect(revoke[0]).toMatchObject({ kind: "closing-revoke", title: "플랫폼 운영 12월 승인 취소 — 사유를 확인하세요", body: "재검토" });
    const approve = closingNotifications({ action: "approve", project, ym: "2026-12", pmIds: ["pm1"], hqIds: [] });
    expect(approve[0]).toMatchObject({ kind: "closing-approve", title: "플랫폼 운영 12월 승인됨", body: null });
  });
  it("긴 사유는 300자로 자른다, 받는 사람이 없으면 빈 목록", () => {
    const long = "가".repeat(400);
    const [n] = closingNotifications({ action: "reject", project, ym: "2026-09", note: long, pmIds: ["pm1"], hqIds: [] });
    expect(n.body!.length).toBe(300);
    expect(n.body!.endsWith("…")).toBe(true);
    expect(closingNotifications({ action: "approve", project, ym: "2026-09", actorId: "pm1", pmIds: ["pm1"], hqIds: [] })).toEqual([]);
  });
});

describe("입력·소명 요청 알림", () => {
  it("미입력: PM 이름·월, 지출 입력 화면, 하루 한 번 key", () => {
    const out = remindNotifications({ kind: "noinput", project, ym: "2026-10", pmName: "김피엠", userIds: ["u1", "u2", "u1"], today: "2026-10-14" });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ userId: "u1", kind: "remind-noinput", title: "김피엠 PM이 10월 지출 입력을 요청했어요", href: "/expenses/new", key: "remind-noinput:p1:2026-10:2026-10-14", projectId: "p1" });
  });
  it("소명: 사람별 건수(0이면 건수 없이), 규정 점검 탭으로", () => {
    const out = remindNotifications({ kind: "unexplained", project, ym: "2026-10", pmName: "김피엠", userIds: ["u1", "u2"], counts: { u1: 3 }, today: "2026-10-14" });
    expect(out[0].title).toBe("10월 규정 점검 소명 요청 3건");
    expect(out[1].title).toBe("10월 규정 점검 소명 요청");
    expect(out[0].href).toContain("/dashboard?ym=2026-10&check=unexplained");
    expect(out[0].key).toBe("remind-unexplained:p1:2026-10:2026-10-14");
    expect(remindNotifications({ kind: "noinput", project, ym: "2026-10", pmName: "김피엠", userIds: [], today: "2026-10-14" })).toEqual([]);
  });
});

describe("출입증 알림", () => {
  it("올림: 줄이 있는 팀원, 현황의 출입증 탭, 내역당 한 번 key", () => {
    const out = passNotifications({ event: "uploaded", project, ym: "2026-09", statementId: "s1", userIds: ["u1", "u1", "u2"] });
    expect(out.map((n) => n.userId)).toEqual(["u1", "u2"]);
    expect(out[0]).toMatchObject({ kind: "pass-check", title: "9월 출입증 내역 확인 — 업무 사용이 있으면 표시하세요", href: "/dashboard?tab=pass&ym=2026-09", key: "pass-check:s1", projectId: "p1", yearMonth: "2026-09" });
  });
  it("확정: 본인 부담이 있는 팀원만, 원화 표기", () => {
    const out = passNotifications({ event: "confirmed", project, ym: "2026-09", statementId: "s1", userIds: ["u1", "u2", "u3"], deductByUser: { u1: 123000, u2: 0 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: "u1", kind: "pass-confirm", title: "9월 출입증 확정 — 본인 부담 123,000원(급여 공제)", key: "pass-confirm:s1" });
    expect(passNotifications({ event: "confirmed", project, ym: "2026-09", statementId: "s1", userIds: ["u1"] })).toEqual([]);
  });
});

describe("푸시 메시지", () => {
  it("key가 있으면 tag = key, 없으면 알림 id", () => {
    expect(pushPayload({ id: "n1", title: "t", key: "pass-check:s1" }).tag).toBe("pass-check:s1");
    expect(pushPayload({ id: "n1", title: "t" }).tag).toBe("n1");
  });
  it("앱 내 경로만 남기고 바깥 주소는 버린다", () => {
    expect(pushPayload({ id: "n", title: "t", href: "/closing?ym=2026-09" }).href).toBe("/closing?ym=2026-09");
    for (const href of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(pushPayload({ id: "n", title: "t", href }).href).toBeNull();
    }
  });
  it("긴 본문은 줄이고 빈 본문은 null", () => {
    const p = pushPayload({ id: "n", title: "t", body: "가".repeat(500) });
    expect(p.body!.length).toBe(PUSH_BODY_MAX);
    expect(p.body!.endsWith("…")).toBe(true);
    expect(pushPayload({ id: "n", title: "t", body: "  " }).body).toBeNull();
  });
});

describe("푸시 서비스 주소", () => {
  it("브라우저 푸시 서비스만 받는다", () => {
    for (const e of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QO", "https://wns2-sg2p.notify.windows.com/w/?token=x"]) expect(isPushEndpoint(e)).toBe(true);
  });
  it("그 밖의 주소·http·포트·사용자 정보는 거부", () => {
    for (const e of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://fcm.googleapis.com:8443/x", "https://a@fcm.googleapis.com/x", "https://evilpush.apple.com/x", "not a url"]) expect(isPushEndpoint(e)).toBe(false);
  });
});
