"use client";
// 알림 화면 상단 — "이 기기에서 푸시 알림 받기" 스위치 (브라우저 웹 푸시)
// 서버에 VAPID 키가 없으면(publicKey: null) 아무것도 그리지 않는다. 구독 정보는 기기(브라우저)마다 따로 저장된다.
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { base64UrlToUint8Array, pushSupport, sameKey, type PushSupport } from "./push-client";

type State = "loading" | "hidden" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function detect(): PushSupport {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushSupport({
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    hasNotification: typeof window !== "undefined" && "Notification" in window,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true,
  });
}

async function postSubscription(sub: PushSubscription) {
  await api("/api/push", { method: "POST", json: sub.toJSON() });
}

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 첫 렌더: 서버 공개키 → 지원 여부 → 현재 구독 상태 (키가 바뀌었으면 조용히 재구독)
  useEffect(() => {
    let alive = true;
    (async () => {
      let publicKey: string | null = null;
      try {
        publicKey = (await api<{ publicKey: string | null }>("/api/push")).publicKey ?? null;
      } catch {
        publicKey = null;
      }
      if (!alive) return;
      if (!publicKey) return setState("hidden");
      let appKey: Uint8Array<ArrayBuffer>;
      try {
        appKey = base64UrlToUint8Array(publicKey);
      } catch {
        return setState("hidden");
      }
      setKey(appKey);
      const support = detect();
      if (support !== "supported") return setState(support);
      if (Notification.permission === "denied") return setState("denied");
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (!alive) return;
        if (!reg || !sub || Notification.permission !== "granted") return setState("off");
        if (!sameKey(sub.options.applicationServerKey, appKey)) {
          // 서버 키가 바뀌면 예전 구독으로는 보낼 수 없다 — 새 키로 다시 구독
          await sub.unsubscribe().catch(() => false);
          await api("/api/push", { method: "DELETE", json: { endpoint: sub.endpoint } }).catch(() => {});
          const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
          await postSubscription(fresh);
        } else {
          // 서버 쪽 기록이 지워졌을 수 있어 매번 다시 알려 준다 (같은 endpoint면 서버가 갱신)
          await postSubscription(sub).catch(() => {});
        }
        if (alive) setState("on");
      } catch {
        if (alive) setState("off");
      }
    })();
    return () => { alive = false; };
  }, []);

  async function turnOn() {
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      // 권한 요청은 반드시 사용자의 클릭 안에서
      const permission = await Notification.requestPermission();
      if (permission === "denied") return setState("denied");
      if (permission !== "granted") return setError("알림 권한을 허용해야 받을 수 있어요.");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe().catch(() => false);
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await postSubscription(sub);
      setState("on");
    } catch (e) {
      setError((e as Error).message || "푸시 알림을 켜지 못했어요. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => false);
        await api("/api/push", { method: "DELETE", json: { endpoint } }).catch(() => {});
      }
      setState("off");
    } catch (e) {
      setError((e as Error).message || "푸시 알림을 끄지 못했어요. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "hidden") return null;

  const on = state === "on";
  const canToggle = state === "on" || state === "off";
  const note =
    state === "unsupported" ? "이 브라우저는 푸시 알림을 지원하지 않아요. 크롬·엣지·사파리 최신 버전에서 켤 수 있어요."
    : state === "ios-install" ? "아이폰·아이패드는 사파리에서 공유 → '홈 화면에 추가'를 한 뒤, 홈 화면의 Solibee 앱에서 켤 수 있어요."
    : state === "denied" ? "이 기기에서 알림이 차단되어 있어요. 브라우저(또는 휴대폰) 설정에서 이 사이트의 알림을 허용한 뒤 다시 열어 주세요."
    : on ? "상신·승인·반려, 입력·소명 요청이 오면 이 기기로 바로 알려 드려요."
    : "켜면 앱을 닫아 두어도 새 알림을 이 기기로 받아요.";

  return (
    <div className="card mb-3 flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p id="push-toggle-label" className="text-base font-semibold text-fg sm:text-sm">이 기기에서 푸시 알림 받기</p>
        <p className={`mt-0.5 text-sm sm:text-label ${state === "denied" ? "text-rose-700" : "text-fg-muted"}`}>{note}</p>
        {error && <p role="alert" className="mt-1 text-sm font-medium text-rose-700 sm:text-label">{error}</p>}
      </div>
      {canToggle && (
        <button type="button" role="switch" aria-checked={on} aria-labelledby="push-toggle-label" disabled={busy}
          onClick={on ? turnOff : turnOn}
          className="flex min-h-11 shrink-0 items-center rounded-full disabled:cursor-wait disabled:opacity-50">
          <span className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-line-strong"}`}>
            <span className={`absolute left-0.5 size-6 rounded-full bg-surface shadow transition-transform ${on ? "translate-x-5" : ""}`} />
          </span>
        </button>
      )}
    </div>
  );
}
