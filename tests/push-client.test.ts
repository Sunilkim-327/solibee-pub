import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  base64UrlToUint8Array, clickTarget, isIOS, pushSupport, readPushEntry, safeHref, safeProjectId, sameKey, toNotice, type PushEnv,
} from "@/components/notifications/push-client";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const env = (o: Partial<PushEnv> = {}): PushEnv => ({
  hasServiceWorker: true, hasPushManager: true, hasNotification: true, userAgent: CHROME, maxTouchPoints: 0, standalone: false, ...o,
});

describe("푸시 지원 판정", () => {
  it("iOS 판정: iPhone · 데스크톱 모드 iPad(맥 UA+터치) · 맥은 아님", () => {
    expect(isIOS(IPHONE)).toBe(true);
    expect(isIOS(IPAD_DESKTOP, 5)).toBe(true);
    expect(isIOS(IPAD_DESKTOP, 0)).toBe(false);
    expect(isIOS(CHROME)).toBe(false);
  });
  it("데스크톱 크롬: 다 있으면 지원 · 하나라도 없으면 미지원", () => {
    expect(pushSupport(env())).toBe("supported");
    expect(pushSupport(env({ hasPushManager: false }))).toBe("unsupported");
    expect(pushSupport(env({ hasServiceWorker: false }))).toBe("unsupported");
    expect(pushSupport(env({ hasNotification: false }))).toBe("unsupported");
  });
  it("아이폰: 홈 화면 앱이 아니면 설치 안내 (PushManager 유무와 무관)", () => {
    expect(pushSupport(env({ userAgent: IPHONE, hasPushManager: false, hasNotification: false }))).toBe("ios-install");
    expect(pushSupport(env({ userAgent: IPHONE }))).toBe("ios-install");
  });
  it("아이폰 홈 화면 앱: 지원되면 지원 · 옛 iOS(PushManager 없음)면 미지원", () => {
    expect(pushSupport(env({ userAgent: IPHONE, standalone: true }))).toBe("supported");
    expect(pushSupport(env({ userAgent: IPHONE, standalone: true, hasPushManager: false }))).toBe("unsupported");
  });
});

describe("VAPID 키", () => {
  it("base64url → 바이트 (패딩 없음·-_ 문자)", () => {
    expect(Array.from(base64UrlToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(base64UrlToUint8Array("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64UrlToUint8Array("AQ"))).toEqual([1]);
  });
  it("키 비교: 같은 바이트면 같음 · 길이/값 다르거나 없으면 다름", () => {
    const k = new Uint8Array([4, 5, 6]);
    expect(sameKey(new Uint8Array([4, 5, 6]).buffer, k)).toBe(true);
    expect(sameKey(new Uint8Array([9, 4, 5, 6]).subarray(1), k)).toBe(true);
    expect(sameKey(new Uint8Array([4, 5, 7]).buffer, k)).toBe(false);
    expect(sameKey(new Uint8Array([4, 5]).buffer, k)).toBe(false);
    expect(sameKey(null, k)).toBe(false);
  });
});

describe("안전한 이동 경로", () => {
  it("같은 출처 상대경로만", () => {
    expect(safeHref("/closing?ym=2026-10")).toBe("/closing?ym=2026-10");
    expect(safeHref("/")).toBe("/");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "closing", "", "/a\nb", "/a\\b", null, 1]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
  it("프로젝트 id: 짧은 영숫자만", () => {
    expect(safeProjectId("cm1abc_23-x")).toBe("cm1abc_23-x");
    expect(safeProjectId("")).toBeNull();
    expect(safeProjectId("a".repeat(65))).toBeNull();
    expect(safeProjectId("a/b")).toBeNull();
  });
});

describe("푸시 메시지 → 알림", () => {
  it("제목·내용·태그·이동 정보", () => {
    const n = toNotice(JSON.stringify({ title: "10월 정산 상신", body: "확인해 주세요", href: "/closing", projectId: "p1", tag: "closing-p1", id: "n1" }));
    expect(n.title).toBe("10월 정산 상신");
    expect(n.options).toEqual({
      body: "확인해 주세요", tag: "closing-p1", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
      data: { href: "/closing", projectId: "p1", id: "n1" },
    });
  });
  it("위험한 href는 버리고, 빈/깨진 메시지는 기본 제목", () => {
    expect(toNotice(JSON.stringify({ title: "x", href: "https://evil.com" })).options.data.href).toBeNull();
    expect(toNotice("not json").title).toBe("Solibee 알림");
    expect(toNotice(null).title).toBe("Solibee 알림");
    expect(toNotice(JSON.stringify({ title: "  " })).title).toBe("Solibee 알림");
    expect(toNotice(JSON.stringify({ title: "x", body: null })).options).not.toHaveProperty("body");
  });
  it("클릭 주소: 프로젝트 알림은 알림 화면 진입점 · 아니면 href · 없으면 알림 화면", () => {
    expect(clickTarget({ href: "/closing?ym=2026-10", projectId: "p1" })).toBe("/notifications?go=%2Fclosing%3Fym%3D2026-10&project=p1");
    expect(clickTarget({ href: "/me" })).toBe("/me");
    expect(clickTarget({ href: "//evil.com", projectId: "p1" })).toBe("/notifications");
    expect(clickTarget(null)).toBe("/notifications");
  });
  it("클릭 주소: 알림 id가 있으면 읽음 처리 진입점 (프로젝트·href 유무와 관계없이)", () => {
    expect(clickTarget({ id: "n1", href: "/closing?ym=2026-10", projectId: "p1" })).toBe("/notifications?read=n1&go=%2Fclosing%3Fym%3D2026-10&project=p1");
    expect(clickTarget({ id: "n1", href: "/me" })).toBe("/notifications?read=n1&go=%2Fme");
    expect(clickTarget({ id: "n1" })).toBe("/notifications?read=n1");
    expect(clickTarget({ id: "n1", href: "//evil.com", projectId: "p1" })).toBe("/notifications?read=n1");
    expect(clickTarget({ id: "bad id!", href: "/me" })).toBe("/me");
  });
  it("진입점 쿼리 해석: 클릭 주소와 왕복 · 위험한 경로는 무시", () => {
    const url = clickTarget({ href: "/closing?ym=2026-10", projectId: "p1" });
    expect(readPushEntry(url.slice(url.indexOf("?")))).toEqual({ readId: null, href: "/closing?ym=2026-10", projectId: "p1" });
    const withId = clickTarget({ id: "n1", href: "/me" });
    expect(readPushEntry(withId.slice(withId.indexOf("?")))).toEqual({ readId: "n1", href: "/me", projectId: null });
    expect(readPushEntry("?read=n1&go=%2F%2Fevil.com")).toEqual({ readId: "n1", href: null, projectId: null });
    expect(readPushEntry("?read=%3Cx%3E")).toBeNull();
    expect(readPushEntry("?go=%2F%2Fevil.com&project=p1")).toBeNull();
    expect(readPushEntry("?go=%2Fme")).toBeNull();
    expect(readPushEntry("")).toBeNull();
  });
});

// public/sw.js는 번들되지 않아 같은 규칙을 복제해 두었다 — 가짜 self로 실제 파일을 돌려 둘이 같은지 확인
describe("서비스 워커 (public/sw.js)", () => {
  function loadSw(windows: { url: string; navigate?: (u: string) => Promise<unknown> }[] = []) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const shown: { title: string; options: unknown }[] = [];
    const self = {
      location: { origin: "https://app.example" },
      addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
      skipWaiting: vi.fn(),
      registration: { showNotification: vi.fn(async (title: string, options: unknown) => { shown.push({ title, options }); }) },
      clients: {
        claim: vi.fn(async () => {}),
        matchAll: vi.fn(async () => windows.map((w) => ({ ...w, focus: async function (this: unknown) { return this; } }))),
        openWindow: vi.fn(async () => null),
      },
    };
    const code = readFileSync(path.resolve(__dirname, "../public/sw.js"), "utf8");
    vm.runInNewContext(code, { self, URL, URLSearchParams, JSON });
    return { handlers, shown, self };
  }
  const run = async (fn: (e: unknown) => void, e: Record<string, unknown>) => {
    let p: Promise<unknown> = Promise.resolve();
    fn({ ...e, waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
  };

  it("fetch 핸들러 없음 · install/activate에서 바로 적용", async () => {
    const { handlers, self } = loadSw();
    expect(Object.keys(handlers).sort()).toEqual(["activate", "install", "notificationclick", "push"]);
    handlers.install({});
    expect(self.skipWaiting).toHaveBeenCalled();
    await run(handlers.activate, {});
    expect(self.clients.claim).toHaveBeenCalled();
  });

  it("push: 순수 모듈과 같은 알림을 띄운다", async () => {
    const { handlers, shown } = loadSw();
    const raw = JSON.stringify({ title: "반려", body: "사유 확인", href: "/expenses", projectId: "p1", tag: "t", id: "n1" });
    await run(handlers.push, { data: { text: () => raw } });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("반려");
    expect(JSON.parse(JSON.stringify(shown[0].options))).toEqual(toNotice(raw).options);
    await run(handlers.push, { data: { text: () => "{broken" } });
    expect(shown[1].title).toBe("Solibee 알림");
  });

  it("notificationclick: 열린 같은 출처 창이 있으면 그 창을 이동, 없으면 새 창", async () => {
    const navigate = vi.fn(async () => null);
    const a = loadSw([{ url: "https://other.example/x", navigate }, { url: "https://app.example/dashboard", navigate }]);
    const close = vi.fn();
    await run(a.handlers.notificationclick, { notification: { close, data: { id: "n1", href: "/closing", projectId: "p1" } } });
    expect(close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("https://app.example/notifications?read=n1&go=%2Fclosing&project=p1");
    expect(a.self.clients.openWindow).not.toHaveBeenCalled();

    const b = loadSw([]);
    await run(b.handlers.notificationclick, { notification: { close, data: { href: "//evil.com" } } });
    expect(b.self.clients.openWindow).toHaveBeenCalledWith("https://app.example/notifications");
  });
});
