"use client";
// 출입증 '확인함' 기억 — 팀원이 내 지출 내역의 출입증 탭에서 그 달을 열어 보면 지출 입력 화면의 안내(TodoBanner)에서 사라진다.
// 이 브라우저에만 기억한다 (편의 기능: 지워져도 다시 보일 뿐 정산에는 영향 없음)
import { useEffect, useState } from "react";

const key = (projectId: string, userId: string) => `opex:passSeen:${projectId}:${userId}`;

function readSeen(projectId: string, userId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(projectId, userId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 확인한 달 목록 — 마운트 전(서버 렌더)에는 null */
export function usePassSeen(projectId: string, userId: string): string[] | null {
  const [seen, setSeen] = useState<string[] | null>(null);
  useEffect(() => setSeen(readSeen(projectId, userId)), [projectId, userId]);
  return seen;
}

/** 내 지출 내역의 출입증 탭에서 그 달을 '확인함'으로 기억 */
export function MarkPassSeen({ projectId, userId, ym }: { projectId: string; userId: string; ym: string }) {
  useEffect(() => {
    try {
      const seen = readSeen(projectId, userId);
      if (!seen.includes(ym)) localStorage.setItem(key(projectId, userId), JSON.stringify([...seen, ym].slice(-36)));
    } catch { /* 저장소를 못 쓰면 안내가 계속 보일 뿐 */ }
  }, [projectId, userId, ym]);
  return null;
}
