"use client";
// 지출 입력 화면 상단 안내 — 반려·승인 취소 > 소명 필요 > 출입증 확인 > 월말 D-5 순으로 최대 maxShown개, 나머지는 한 줄.
// 출입증 '확인함'은 이 브라우저에 기억하므로(PassCheckBanner) 클라이언트에서 거른다.
import Link from "next/link";
import { usePassSeen } from "@/components/PassCheckBanner";
import { buildMemberNotices, splitNotices, type MemberNotice, type MemberNoticeInput } from "@/lib/member-todo";

export type { RejectedMonth } from "@/lib/member-todo";

const TONE: Record<MemberNotice["tone"], string> = {
  danger: "border-rose-200 bg-rose-50 text-rose-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

type Props = Omit<MemberNoticeInput, "passMonths"> & {
  projectId: string;
  userId: string;
  /** 확정 전 출입증 달 — 팀원은 열어 본 달을 뺀다 */
  passMonths: string[];
  /** 한 번에 보일 수 (레이아웃 공통 알림이 있으면 1, 없으면 2) */
  maxShown: number;
};

export function TodoBanner({ projectId, userId, passMonths, maxShown, ...input }: Props) {
  const seen = usePassSeen(projectId, userId);
  // 팀원: 마운트 전에는 출입증 안내를 비워 두고(서버 렌더와 같게), 확인한 달 목록을 읽은 뒤 거른다
  const pass = input.pm ? passMonths : seen === null ? [] : passMonths.filter((m) => !seen.includes(m));
  const { shown, rest } = splitNotices(buildMemberNotices({ ...input, passMonths: pass }), maxShown);
  if (!shown.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {shown.map((n) => {
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <b>{n.title}</b>
              {n.detail && <span className="block text-label">{n.detail}</span>}
            </span>
            {n.action && <span className="basis-full text-right font-semibold sm:basis-auto">{n.action}</span>}
          </>
        );
        const cls = `flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2 text-sm ${TONE[n.tone]}`;
        return n.href
          ? <Link key={n.key + n.title} href={n.href} className={`${cls} hover:underline`}>{body}</Link>
          : <div key={n.key + n.title} className={cls}>{body}</div>;
      })}
      {rest.length > 0 && (
        <p className="px-1 text-label text-fg-muted">
          그 외 {rest.length}건 · {rest.map((n, i) => (
            <span key={n.key + n.title}>
              {i > 0 && ", "}
              {n.href ? <Link href={n.href} className="underline">{n.short}</Link> : n.short}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
