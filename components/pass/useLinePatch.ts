"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { PassLineRow } from "@/lib/dto";

/**
 * 출입증 내역 줄 하나 수정 (PATCH /api/pass-statement-lines/:id).
 * - 줄별 진행 중 표시(busy Set)
 * - 같은 줄에 요청이 겹치면(사유 blur 직후 선택 변경 등) 마지막 요청의 응답만 화면에 반영
 * 성공하면 응답(R)을, 실패했거나 더 새 요청에 밀린 경우 null을 돌려준다.
 * patch는 렌더 사이에 같은 함수(useCallback) — 줄 컴포넌트(memo)에 안정적인 콜백을 넘길 수 있게
 */
export function useLinePatch(setLines: (fn: (prev: PassLineRow[]) => PassLineRow[]) => void) {
  const seq = useRef(new Map<string, number>());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const mark = useCallback((id: string, on: boolean) => setBusy((s) => {
    if (s.has(id) === on) return s;
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  }), []);

  const patch = useCallback(async <R extends { line: PassLineRow }>(id: string, json: Record<string, unknown>): Promise<R | null> => {
    const n = (seq.current.get(id) ?? 0) + 1;
    seq.current.set(id, n);
    const latest = () => seq.current.get(id) === n;
    mark(id, true);
    setErr(null);
    try {
      const r = await api<R>(`/api/pass-statement-lines/${id}`, { method: "PATCH", json });
      if (!latest()) return null;
      // 바뀐 줄만 새 객체 — 나머지 줄은 그대로라 memo된 줄 컴포넌트가 다시 그려지지 않는다
      setLines((prev) => prev.map((l) => (l.id === id ? r.line : l)));
      return r;
    } catch (e) {
      if (latest()) setErr((e as Error).message);
      return null;
    } finally {
      if (latest()) mark(id, false);
    }
  }, [setLines, mark]);

  return { patch, busy, err, setErr };
}
