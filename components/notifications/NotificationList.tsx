"use client";
// 알림 화면 — 안 읽은 것 먼저, 그다음 지난 알림. 행을 누르면 읽음 처리 후 해당 화면으로.
// 읽음 요청이 실패해도(백엔드 없음 등) 화면은 조용히 진행한다 — 다음 방문 때 다시 안 읽음으로 보일 뿐
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Empty, PageHeader } from "@/components/common";
import { Icon } from "@/components/icons";
import { api } from "@/lib/client";
import { kindMeta, relativeTime, TONE_CLASS, type NotificationItem } from "./kinds";
import { PushToggle } from "./PushToggle";
import { PUSH_ENTRY_PATH, readPushEntry } from "./push-client";
import { publishUnread } from "./unread";

export function NotificationList({ initial, limit = 50, currentProjectId = null }: { initial: NotificationItem[]; limit?: number; currentProjectId?: string | null }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  // 상대 시각은 서버 렌더 시점과 조금 다를 수 있어 붙은 뒤 한 번 다시 센다 (<time>에 suppressHydrationWarning)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), []);

  // 푸시 알림 클릭 진입점 (/notifications?read=<알림 id>&go=<경로>&project=<id>, public/sw.js) — 행 클릭과 같은 방식으로 읽음 처리·프로젝트 전환 뒤 이동
  useEffect(() => {
    const entry = readPushEntry(window.location.search);
    if (!entry) return;
    let alive = true;
    (async () => {
      if (entry.readId) {
        const stamp = new Date().toISOString();
        setItems((list) => list.map((i) => (i.id === entry.readId && !i.readAt ? { ...i, readAt: stamp } : i)));
        await markRead({ ids: [entry.readId] });
      }
      if (!alive) return;
      // 이동할 곳이 없으면 알림 화면에 머문다 (주소의 진입점 쿼리만 지운다)
      if (!entry.href) {
        router.replace(PUSH_ENTRY_PATH);
        return;
      }
      let switched = false;
      if (entry.projectId && entry.projectId !== currentProjectId) {
        try {
          await api("/api/session/project", { method: "POST", json: { projectId: entry.projectId } });
          switched = true;
        } catch {
          // 전환 실패(권한 없음·종료 등)면 현재 프로젝트 기준으로 그냥 연다
        }
      }
      if (!alive) return;
      router.replace(entry.href);
      if (switched) router.refresh();
    })();
    return () => { alive = false; };
    // 첫 진입 때 한 번만
  }, []);

  const unread = items.filter((i) => !i.readAt);
  const read = items.filter((i) => i.readAt);

  async function markRead(body: { ids: string[] } | { all: true }) {
    try {
      const r = await api<{ unread: number }>("/api/notifications/read", { method: "POST", json: body });
      publishUnread(typeof r.unread === "number" ? r.unread : null);
    } catch {
      publishUnread(null);
    }
  }

  async function open(n: NotificationItem) {
    if (busy) return;
    setBusy(n.id);
    try {
      if (!n.readAt) {
        const stamp = new Date().toISOString();
        setItems((list) => list.map((i) => (i.id === n.id ? { ...i, readAt: stamp } : i)));
        await markRead({ ids: [n.id] });
      }
    } finally {
      setBusy(null);
    }
    if (!n.href) return;
    // 다른 프로젝트의 알림이면 먼저 그 프로젝트로 바꾸고 이동 (Nav 토스트의 action과 같은 방식) — 공통 레이아웃도 다시 그린다
    if (n.projectId && n.projectId !== currentProjectId) {
      try {
        await api("/api/session/project", { method: "POST", json: { projectId: n.projectId } });
        router.push(n.href);
        router.refresh();
        return;
      } catch {
        // 전환 실패(권한 없음·종료 등)면 현재 프로젝트 기준으로 그냥 연다
      }
    }
    router.push(n.href);
  }

  async function readAll() {
    if (busy || !unread.length) return;
    setBusy("all");
    const stamp = new Date().toISOString();
    setItems((list) => list.map((i) => (i.readAt ? i : { ...i, readAt: stamp })));
    try { await markRead({ all: true }); } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="알림">
        {unread.length > 0 && (
          <button type="button" className="btn-secondary btn-sm" disabled={busy === "all"} onClick={readAll}>모두 읽음</button>
        )}
      </PageHeader>
      <PushToggle />
      {items.length === 0 ? (
        <Empty card icon="inbox" title="아직 알림이 없어요">상신·승인·반려, 입력·소명 요청, 출입증 안내가 여기에 모여요.</Empty>
      ) : (
        <div className="card overflow-hidden">
          {unread.length > 0 && <Group title={`안 읽음 ${unread.length}`} items={unread} now={now} busy={busy} onOpen={open} />}
          {read.length > 0 && <Group title="지난 알림" items={read} now={now} busy={busy} onOpen={open} divider={unread.length > 0} />}
          {items.length >= limit && <p className="border-t border-line px-4 py-2 text-xs text-fg-muted">최근 {limit}개까지 보여요.</p>}
        </div>
      )}
    </div>
  );
}

/** 얇은 구분 제목 + 행 목록 (행 40px 밀도 — 표 머리 규칙과 같은 면·글자) */
function Group({ title, items, now, busy, onOpen, divider }: {
  title: string; items: NotificationItem[]; now: number; busy: string | null; onOpen: (n: NotificationItem) => void; divider?: boolean;
}) {
  return (
    <section aria-label={title} className={divider ? "border-t border-line" : ""}>
      <h2 className="flex h-8 items-center border-b border-line bg-surface-muted px-4 text-xs font-bold text-fg-muted">{title}</h2>
      <ul className="divide-y divide-line">
        {items.map((n) => {
          const meta = kindMeta(n.kind);
          const isUnread = !n.readAt;
          return (
            <li key={n.id}>
              <button type="button" disabled={busy === n.id} onClick={() => onOpen(n)}
                className="flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left transition-colors hover:bg-surface-muted disabled:opacity-60 sm:min-h-10">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[meta.tone]}`} title={meta.label}>
                  <Icon d={meta.icon} box={24} sw={2} className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
                  <span title={n.title} className={`block truncate text-sm sm:max-w-[60%] sm:shrink-0 ${isUnread ? "font-semibold text-fg" : "font-medium text-fg-2"}`}>{n.title}</span>
                  {n.body && <span title={n.body} className="line-clamp-1 min-w-0 text-xs text-fg-muted sm:flex-1 sm:truncate sm:text-label">{n.body}</span>}
                </span>
                {isUnread && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
                <time dateTime={n.createdAt} suppressHydrationWarning className="tabular shrink-0 text-xs text-fg-muted">{relativeTime(n.createdAt, now)}</time>
                {n.href && <Icon name="disclose" className="size-4 shrink-0 text-fg-subtle" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
