"use client";

import { useEffect } from "react";
import { isChunkError, reloadOnce } from "@/components/ChunkReload";

/** 최상위 오류 화면 — 새 버전 배포로 화면 조각을 못 불러온 경우는 자동 새로고침, 그 외는 안내 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkError(error);
  useEffect(() => {
    console.error(error);
    if (chunk) reloadOnce();
  }, [error, chunk]);
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "48px 16px", textAlign: "center", color: "#1f2937" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{chunk ? "새 버전으로 바뀌었습니다" : "화면을 불러오지 못했습니다"}</h1>
        <p style={{ fontSize: 14, color: "#6b7280", margin: "8px 0 20px" }}>
          {chunk ? "새로고침하면 이어서 사용할 수 있습니다. 저장한 내용은 그대로 있습니다." : "잠시 후 다시 시도해 주세요."}
        </p>
        <button type="button" onClick={() => (chunk ? window.location.reload() : reset())}
          style={{ padding: "10px 18px", borderRadius: 8, background: "#1e3a5f", color: "#fff", fontWeight: 700, border: 0 }}>
          {chunk ? "새로고침" : "다시 시도"}
        </button>
      </body>
    </html>
  );
}
