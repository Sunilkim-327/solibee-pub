"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

/** 링크를 누른 뒤 서버 응답을 기다리는 동안 꺾쇠 대신 도는 표시 — 운영 서버는 1~3초 걸릴 수 있어 "눌렀는데 반응이 없다"로 보이지 않게 */
function Chevron() {
  const { pending } = useLinkStatus();
  return pending
    ? <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-primary" aria-label="불러오는 중" role="status" />
    : <Icon name="disclose" className="size-4 shrink-0 text-fg-subtle" />;
}

/** 누르는 동안 줄 전체를 살짝 흐리게 (useLinkStatus는 Link 안에서만 읽을 수 있어 내용을 감싼다) */
function Body({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={`contents ${pending ? "[&>*]:opacity-60" : ""}`}>{children}</span>;
}

/** 좁은 화면(상세가 목록 위에 있음): 누르는 즉시 상세 자리로 올려 보낸다 — 서버 응답을 기다리는 동안 목록만 보고 있지 않게 */
function scrollToDetail() {
  if (window.matchMedia("(min-width: 1024px)").matches) return;
  document.getElementById("month-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * 마감·상신 달 목록의 한 줄/카드 — 누르면 ?ym= 으로 그 달 상세를 연다 (같은 화면 안에서 바뀜).
 * chevron: 오른쪽 끝 꺾쇠(목록 줄). 카드에는 없음.
 */
export function MonthLink({ href, selected, className, chevron, children }: { href: string; selected: boolean; className: string; chevron?: boolean; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} prefetch={false} aria-current={selected ? "true" : undefined} className={className} onClick={scrollToDetail}>
      <Body>{children}</Body>
      {chevron && <Chevron />}
    </Link>
  );
}
