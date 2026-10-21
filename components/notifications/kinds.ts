// 알림 종류별 표시(아이콘·색)와 상대 시각 — 순수 모듈 (화면·테스트 공용)
import { pad2 } from "@/lib/format";

/** 백엔드 Notification.kind (lib/notifications.ts와 같은 값) */
export type NotificationKind =
  | "closing-submit" | "closing-approve" | "closing-reject" | "closing-revoke"
  | "remind-noinput" | "remind-unexplained" | "pass-check" | "pass-confirm";

/** 화면에 내려 주는 알림 한 건 (날짜는 ISO 문자열 — 서버 컴포넌트 → 클라이언트 직렬화) */
export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  /** 다른 프로젝트의 알림이면 누를 때 그 프로젝트로 전환 (재무 승인·여러 프로젝트 PM) */
  projectId: string | null;
  createdAt: string;
  readAt: string | null;
};

/** 서버 모델(Date) → 화면용 (문자열). 백엔드 타입에 구조적으로 맞춘다 */
export function toNotificationItem(n: {
  id: string; kind: string; title: string; body?: string | null; href?: string | null; projectId?: string | null; createdAt: Date | string; readAt?: Date | string | null;
}): NotificationItem {
  const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));
  return { id: n.id, kind: n.kind, title: n.title, body: n.body ?? null, href: n.href ?? null, projectId: n.projectId ?? null, createdAt: iso(n.createdAt), readAt: n.readAt ? iso(n.readAt) : null };
}

/** 종 아이콘 (24px 격자) — 상단 바·메뉴 공용 */
export const BELL_ICON = "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0";

/** 상태색 의미 고정 (docs/DESIGN.md): 반려·승인 취소=bad · 승인=ok · 상신=info · 입력 요청·출입증=neutral */
export type NotificationTone = "ok" | "info" | "bad" | "neutral";
export const TONE_CLASS: Record<NotificationTone, string> = {
  ok: "bg-emerald-50 text-emerald-800",
  info: "bg-sky-50 text-sky-800",
  bad: "bg-rose-50 text-rose-700",
  neutral: "bg-surface-muted text-fg-muted",
};

type KindMeta = { tone: NotificationTone; icon: string; label: string };
const CARD = "M3 5h18v14H3zM7 9h4M7 13h6M15 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";
export const KIND_META: Record<NotificationKind, KindMeta> = {
  "closing-submit": { tone: "info", icon: "M22 2 11 13M22 2l-7 20-4-9-9-4z", label: "상신" },
  "closing-approve": { tone: "ok", icon: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3", label: "승인" },
  "closing-reject": { tone: "bad", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6", label: "반려" },
  "closing-revoke": { tone: "bad", icon: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5", label: "승인 취소" },
  "remind-noinput": { tone: "neutral", icon: "M12 8v8M8 12h8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", label: "입력 요청" },
  "remind-unexplained": { tone: "neutral", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", label: "소명 요청" },
  "pass-check": { tone: "neutral", icon: CARD, label: "출입증 확인" },
  "pass-confirm": { tone: "neutral", icon: CARD, label: "출입증 확정" },
};

/** 모르는 kind(앞으로 추가될 종류)는 중립 종 아이콘 */
export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind as NotificationKind] ?? { tone: "neutral", icon: BELL_ICON, label: "알림" };
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * 목록의 상대 시각 — "방금" · "3분 전" · "2시간 전"(오늘) · "어제" · 그 이상은 "10.03"(다른 해면 "25.10.03")
 * 브라우저(한국) 시간 기준. now는 테스트·렌더 시점 고정용
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const a = new Date(t);
  const b = new Date(now);
  const days = Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
  if (days <= 0) return `${Math.floor(min / 60)}시간 전`;
  if (days === 1) return "어제";
  const md = `${pad2(a.getMonth() + 1)}.${pad2(a.getDate())}`;
  return a.getFullYear() === b.getFullYear() ? md : `${String(a.getFullYear()).slice(2)}.${md}`;
}
