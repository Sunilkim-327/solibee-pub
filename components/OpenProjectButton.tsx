"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { toast } from "./Nav";

/**
 * 현재 작업 프로젝트를 바꾸고 해당 화면으로 이동. 바뀐 뒤 화면 아래에 알림을 띄운다.
 * name: 알림에 쓸 프로젝트 이름 (없으면 일반 문구)
 */
export function OpenProjectButton({ projectId, href, label, className, name }: { projectId: string; href: string; label: string; className?: string; name?: string }) {
  const router = useRouter();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigating, startTransition] = useTransition();
  return (
    <>
      <button className={className ?? "btn-secondary btn-sm"} disabled={posting || navigating}
        onClick={async () => {
          setPosting(true);
          setError(null);
          try {
            await api("/api/session/project", { method: "POST", json: { projectId } });
            // push만으로는 공통 레이아웃(상단 프로젝트 선택)이 다시 그려지지 않아 refresh도 함께
            startTransition(() => {
              router.push(href);
              router.refresh();
            });
            toast(name ? `‘${name}’ 프로젝트로 바꿨습니다` : "프로젝트를 바꿨습니다");
          } catch (e) {
            setError((e as Error).message || "프로젝트를 열지 못했습니다.");
          } finally {
            setPosting(false);
          }
        }}>
        {label}
      </button>
      {error && <span role="alert" className="text-xs text-status-rejected">{error}</span>}
    </>
  );
}
