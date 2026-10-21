import { NotificationList } from "@/components/notifications/NotificationList";
import { toNotificationItem, type NotificationItem } from "@/components/notifications/kinds";
import { getCurrentProject, requireUser } from "@/lib/access";
import { listNotifications } from "@/lib/notification-server";

const LIMIT = 50;

/** 알림 — 로그인한 누구나. 상신·승인·반려, 입력·소명 요청, 출입증 안내가 모인다 (안 읽은 것 먼저·최신순, 최근 50개) */
export default async function NotificationsPage() {
  const user = await requireUser();
  let items: NotificationItem[] = [];
  const [{ project }, list] = await Promise.all([
    getCurrentProject(user),
    // 알림 저장소를 못 읽어도 화면은 빈 목록으로 (배지와 같은 '조용한 실패')
    listNotifications(user.id, { limit: LIMIT }).catch(() => []),
  ]);
  items = list.map(toNotificationItem);
  // 다른 프로젝트의 알림을 누르면 그 프로젝트로 전환해서 연다
  return <NotificationList initial={items} limit={LIMIT} currentProjectId={project?.id ?? null} />;
}
