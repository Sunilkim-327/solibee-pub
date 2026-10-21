"use client";

import { useEffect } from "react";

/** /settings#pass 처럼 주소에 섹션이 있으면 그 섹션으로 이동 (스트리밍 렌더로 첫 로드 때 브라우저가 못 찾는 경우 보완) */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => clearTimeout(t);
  }, []);
  return null;
}
