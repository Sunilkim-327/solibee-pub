// 앱 내 알림 만들기 — 순수함수 (서버·테스트 공용). 저장은 lib/notification-server.ts notify()
// 우선순위(설계 검토(2026-10-14) P1-2 ②): 반려·승인 취소(PM) > 입력·소명 요청(팀원) > 승인 완료
// href는 앱 내 경로. projectId가 있으면 누를 때 그 프로젝트로 바꾼 뒤 이동한다 (components/Nav Toaster의 action과 같은 방식: POST /api/session/project → 이동)
import { monthKo, won } from "./format";
import { ledgerHref, passCheckHref } from "./page-access";

export type NotificationKind =
  | "closing-submit" | "closing-approve" | "closing-reject" | "closing-revoke"
  | "remind-noinput" | "remind-unexplained"
  | "pass-check" | "pass-confirm";

export type NotificationDraft = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  projectId?: string | null;
  yearMonth?: string | null;
  /** 중복 방지 키 — 같은 사용자에게 같은 key면 다시 만들지 않는다 (없으면 매번 새 알림) */
  key?: string | null;
};

/** 보조 문장 상한 (반려 사유 등) */
export const NOTIFICATION_BODY_MAX = 300;

const clip = (s: string | null | undefined) => {
  const t = s?.trim();
  if (!t) return null;
  return t.length > NOTIFICATION_BODY_MAX ? `${t.slice(0, NOTIFICATION_BODY_MAX - 1)}…` : t;
};

/** 받는 사람 목록: 중복 제거, 행위자 본인 제외 */
const recipients = (ids: string[], except?: string | null) => [...new Set(ids)].filter((id) => id && id !== except);

/** 마감·상신 화면 (그 달) — PM·재무 승인 공통 */
export const closingHref = (ym: string) => `/closing?ym=${ym}`;

export type ClosingNotifyAction = "submit" | "approve" | "reject" | "revoke";

/**
 * 상신·승인·반려·승인 취소 알림
 * - submit → 재무 승인 담당(hqIds): "{프로젝트명} {M}월 상신 — 검토해 주세요" (key 없음: 재상신마다 새 알림)
 * - reject/revoke → PM(pmIds, 메인 + 함께 상신하는 서브의 PM): "{프로젝트명} {M}월 반려 — 사유를 확인하세요", 사유를 본문에 (사유가 없으면 제목만)
 * - approve → PM: "{프로젝트명} {M}월 승인됨"
 * PM은 여러 프로젝트를 맡을 수 있으므로 제목에 프로젝트명을 넣는다
 * 행위자(actorId)는 받는 사람에서 뺀다
 */
export function closingNotifications(x: {
  action: ClosingNotifyAction;
  project: { id: string; name: string };
  ym: string;
  note?: string | null;
  actorId?: string | null;
  actorName?: string;
  pmIds: string[];
  hqIds: string[];
}): NotificationDraft[] {
  const m = monthKo(x.ym);
  const base = { projectId: x.project.id, yearMonth: x.ym, href: closingHref(x.ym) };
  if (x.action === "submit") {
    return recipients(x.hqIds, x.actorId).map((userId) => ({
      userId, kind: "closing-submit", title: `${x.project.name} ${m} 상신 — 검토해 주세요`, body: x.actorName ? `${x.actorName} PM 상신` : null, ...base,
    }));
  }
  const to = recipients(x.pmIds, x.actorId);
  if (x.action === "approve") return to.map((userId) => ({ userId, kind: "closing-approve", title: `${x.project.name} ${m} 승인됨`, body: null, ...base }));
  const kind = x.action === "reject" ? "closing-reject" : "closing-revoke";
  const note = clip(x.note);
  // 사유가 없으면 "사유를 확인하세요"를 붙이지 않는다 (확인할 사유가 없음)
  const title = `${x.project.name} ${m} ${x.action === "reject" ? "반려" : "승인 취소"}${note ? " — 사유를 확인하세요" : ""}`;
  return to.map((userId) => ({ userId, kind, title, body: note, ...base }));
}

export type RemindKind = "noinput" | "unexplained";

/**
 * PM의 입력·소명 요청 (하루 한 번만: key = remind-{kind}:{projectId}:{ym}:{today})
 * - noinput: "{pmName} PM이 {M}월 지출 입력을 요청했어요" → 지출 입력
 * - unexplained: "{M}월 규정 점검 소명 요청 {n}건" (건수를 모르거나 0이면 건수 없이) → 현황의 지출 내역(규정 점검 탭)
 */
export function remindNotifications(x: {
  kind: RemindKind;
  project: { id: string; name: string };
  ym: string;
  pmName: string;
  userIds: string[];
  counts?: Record<string, number>;
  today: string;
}): NotificationDraft[] {
  const m = monthKo(x.ym);
  const key = `remind-${x.kind}:${x.project.id}:${x.ym}:${x.today}`;
  const base = { projectId: x.project.id, yearMonth: x.ym, key };
  return recipients(x.userIds).map((userId) =>
    x.kind === "noinput"
      ? { userId, kind: "remind-noinput", title: `${x.pmName} PM이 ${m} 지출 입력을 요청했어요`, body: x.project.name, href: "/expenses/new", ...base }
      : { userId, kind: "remind-unexplained", title: `${m} 규정 점검 소명 요청${x.counts?.[userId] ? ` ${x.counts[userId]}건` : ""}`, body: `${x.pmName} PM · ${x.project.name}`, href: ledgerHref(x.ym, { check: "unexplained" }), ...base },
  );
}

/**
 * 출입증 알림
 * - uploaded → 줄이 있는 팀원: 내 사용분 확인 (key = pass-check:{statementId} — 같은 달 다시 올려도 한 번만)
 * - confirmed → 본인 부담 금액이 0보다 큰 팀원: 급여 공제 금액 (key = pass-confirm:{statementId})
 * 팀원의 출입증 확인 화면은 현황의 출입증 탭(lib/page-access passCheckHref — /pass는 PM·재무 승인 전용)
 */
export function passNotifications(x: {
  event: "uploaded" | "confirmed";
  project: { id: string; name: string };
  ym: string;
  statementId: string;
  userIds: string[];
  deductByUser?: Record<string, number>;
}): NotificationDraft[] {
  const m = monthKo(x.ym);
  const base = { projectId: x.project.id, yearMonth: x.ym, href: passCheckHref(x.ym), body: x.project.name };
  if (x.event === "uploaded") {
    return recipients(x.userIds).map((userId) => ({ userId, kind: "pass-check", title: `${m} 출입증 내역 확인 — 업무 사용이 있으면 표시하세요`, key: `pass-check:${x.statementId}`, ...base }));
  }
  return recipients(x.userIds)
    .filter((userId) => (x.deductByUser?.[userId] ?? 0) > 0)
    .map((userId) => ({ userId, kind: "pass-confirm", title: `${m} 출입증 확정 — 본인 부담 ${won(x.deductByUser![userId])}원(급여 공제)`, key: `pass-confirm:${x.statementId}`, ...base }));
}

/** 웹 푸시 메시지 내용 (public/sw.js가 받아 알림으로 띄운다) */
export type PushPayload = { id: string; title: string; body: string | null; href: string | null; projectId: string | null; tag: string };

/** 푸시 메시지 상한 — 암호화 레코드(4KB) 안에 넉넉히 들어가게 본문은 줄인다 */
export const PUSH_BODY_MAX = 200;

/**
 * 저장한 알림 → 푸시 메시지. tag는 key(없으면 알림 id) — 같은 key의 알림은 기기에서 하나로 겹쳐 보인다
 * href는 앱 내 경로만 (그 외는 버린다)
 */
export function pushPayload(n: { id: string; title: string; body?: string | null; href?: string | null; projectId?: string | null; key?: string | null }): PushPayload {
  const body = n.body?.trim() || null;
  const safeHref = n.href && n.href.startsWith("/") && !n.href.startsWith("//") && !n.href.startsWith("/\\") ? n.href : null;
  return {
    id: n.id,
    title: n.title,
    body: body && body.length > PUSH_BODY_MAX ? `${body.slice(0, PUSH_BODY_MAX - 1)}…` : body,
    href: safeHref,
    projectId: n.projectId ?? null,
    tag: n.key || n.id,
  };
}

/** 브라우저 푸시 서비스 주소 (크롬·엣지·파이어폭스·사파리) — 서버가 이 주소로 요청을 보내므로 그 밖의 주소는 받지 않는다 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}
