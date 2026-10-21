"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Empty } from "@/components/common";
import { BackButton } from "@/components/Nav";
import { isChunkError, reloadOnce } from "@/components/ChunkReload";

/** 오류 종류 추정 — 서버 오류의 상세 메시지는 운영 환경에서 감춰지므로 알 수 있는 경우만 구분 */
function kindOf(error: Error & { status?: number }): "forbidden" | "notFound" | "other" {
  const status = error.status;
  const msg = error.message ?? "";
  if (status === 403 || status === 401 || /권한|403/.test(msg)) return "forbidden";
  if (status === 404 || /찾을 수 없|404/.test(msg)) return "notFound";
  return "other";
}

const TEXT = {
  forbidden: { icon: "lock", title: "이 화면을 볼 권한이 없습니다", desc: "역할은 프로젝트마다 다릅니다. 위 프로젝트 이름을 눌러 다른 프로젝트를 고르거나, PM이나 재무 승인 담당에게 권한을 요청하세요." },
  notFound: { icon: "search", title: "요청한 내용을 찾을 수 없습니다", desc: "삭제되었거나 주소가 바뀌었을 수 있습니다." },
  other: { icon: "inbox", title: "화면을 불러오지 못했습니다", desc: "잠시 후 다시 시도해 주세요. 계속되면 시스템 관리자에게 알려 주세요." },
} as const;

/** 대시보드 화면 오류 — 메뉴·상단 바는 그대로 두고 본문만 안내 + 돌아갈 길 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string; status?: number }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // 새 버전 배포 뒤 이전 화면 조각을 못 불러온 경우 — 새로고침하면 해결
    if (isChunkError(error)) reloadOnce();
  }, [error]);
  const kind = kindOf(error);
  const t = TEXT[kind];
  return (
    <div className="mx-auto max-w-md pt-6" role="alert">
      <Empty card icon={t.icon} title={t.title}
        action={
          <>
            {kind === "other" && <button type="button" className="btn-primary" onClick={reset}>다시 시도</button>}
            <BackButton />
            <Link href="/" className={kind === "other" ? "btn-secondary" : "btn-primary"}>첫 화면으로</Link>
          </>
        }>
        {t.desc}
        {error.digest && <span className="mt-2 block text-xs text-fg-subtle">오류 코드: {error.digest}</span>}
      </Empty>
    </div>
  );
}
