"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client";
import { APPROVED_EXISTS } from "@/lib/snapshot";
import { OK_MESSAGE_MS } from "../hooks/useRun";
import type { Line, Settings } from "./types";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** 잠금: 저장(flush)과 항목 삭제·순서 이동 같은 서버 요청이 겹치지 않게 한 번에 하나만 */
function lock(gate: { current: Promise<void> | null }) {
  let release!: () => void;
  gate.current = new Promise<void>((r) => (release = r));
  return () => { gate.current = null; release(); };
}

/**
 * 예산 자동 저장: 바꾸고 0.8초 동안 더 바꾸지 않으면 저장 (저장 버튼 없음)
 * - markDirty("lines"): 예산 행이 바뀜 → 예산 행 전체 PUT
 * - markDirty("settings"): 항목 설정이 바뀜 → 이름이 빈 항목을 뺀 설정을 항목별 PATCH
 * - exclusive(fn): 진행 중인 저장이 끝난 뒤 fn을 실행하고, 그동안 저장을 미룬다
 * 저장하는 동안 더 바뀌면 이어서 저장하고, 실패한 변경은 같은 내용으로 다시 보내지 않는다.
 * 승인된 달이 있는 프로젝트(409 APPROVED_EXISTS)는 askReason으로 사유를 한 번 받아 세션 동안 같은 사유로 다시 보낸다.
 */
export function useBudgetAutosave(o: {
  projectId: string;
  lines: Line[];
  settings: Record<string, Settings>;
  /** 항목 설정 저장 완료 (저장한 값) */
  onSettingsSaved: (saved: [string, Settings][]) => void;
  onError: (message: string) => void;
  /** 승인된 달이 있어 사유가 필요할 때 — 사유(취소면 null) */
  askReason?: (approvedMonths: string[]) => Promise<string | null>;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [rev, setRev] = useState(0);
  const linesDirty = useRef(false);
  const savedRev = useRef(0);
  /** 저장에 실패한 변경 번호 — 같은 내용으로 계속 다시 보내지 않도록 */
  const failedRev = useRef(-1);
  const gate = useRef<Promise<void> | null>(null);
  const latest = useRef({ lines: o.lines, settings: o.settings, rev, onSettingsSaved: o.onSettingsSaved, onError: o.onError, askReason: o.askReason });
  latest.current = { lines: o.lines, settings: o.settings, rev, onSettingsSaved: o.onSettingsSaved, onError: o.onError, askReason: o.askReason };
  /** 승인된 달이 있는 프로젝트의 변경 사유 — 한 번 받으면 이 화면을 떠날 때까지 재사용 */
  const reason = useRef<string | null>(null);
  const { projectId } = o;

  const flush = useCallback(async () => {
    if (gate.current) return;
    const snap = latest.current;
    if (snap.rev <= savedRev.current) return;
    failedRev.current = -1;
    const unlock = lock(gate);
    setSaveState("saving");
    try {
      if (linesDirty.current) {
        linesDirty.current = false;
        const lines = snap.lines.map((l) => ({ itemId: l.itemId, detail: l.detail, unitPrice: l.unitPrice, periods: l.periods, changeId: l.changeId || null, bundleItemIds: l.bundle }));
        const put = () => api(`/api/projects/${projectId}/budget`, { method: "PUT", json: { lines, ...(reason.current ? { reason: reason.current } : {}) } });
        try {
          await put();
        } catch (e) {
          // 승인된 달이 있는 예산: 사유를 받아 다시 보낸다 (승인본 엑셀은 그대로, 현재 데이터만 바뀐다)
          const months = e instanceof ApiError && e.data.code === APPROVED_EXISTS ? (e.data.approvedMonths as string[] | undefined) ?? [] : null;
          if (!months || !latest.current.askReason) throw e;
          const text = await latest.current.askReason(months);
          if (!text) throw new Error("사유를 적지 않아 저장하지 않았습니다. 다시 바꾸면 사유를 묻습니다.");
          reason.current = text;
          await put();
        }
      }
      // 항목명이 비어 있는 동안은 기다림 (입력 중)
      const ready = Object.entries(snap.settings).filter(([, v]) => v.name.trim());
      for (const [id, v] of ready) await api(`/api/master/items/${id}`, { method: "PATCH", json: { ...v, name: v.name.trim() } });
      if (ready.length) latest.current.onSettingsSaved(ready);
      savedRev.current = snap.rev;
      setSaveState(latest.current.rev > snap.rev ? "pending" : "saved");
    } catch (e) {
      linesDirty.current = true;
      failedRev.current = snap.rev;
      setSaveState("error");
      latest.current.onError((e as Error).message);
    } finally {
      unlock();
    }
    // 저장하는 동안 더 바뀌었으면 이어서 저장
    if (latest.current.rev > savedRev.current && latest.current.rev !== failedRev.current) setTimeout(() => void flush(), 300);
  }, [projectId]);

  const exclusive = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    while (gate.current) await gate.current;
    const unlock = lock(gate);
    try {
      return await fn();
    } finally {
      unlock();
      // 잠긴 동안 미뤄진 저장을 이어서
      if (latest.current.rev > savedRev.current && latest.current.rev !== failedRev.current) setTimeout(() => void flush(), 300);
    }
  }, [flush]);

  const markDirty = useCallback((what: "lines" | "settings") => {
    if (what === "lines") linesDirty.current = true;
    setRev((r) => r + 1);
  }, []);

  useEffect(() => {
    if (!rev || rev <= savedRev.current) return;
    setSaveState("pending");
    const t = setTimeout(() => void flush(), 800);
    return () => clearTimeout(t);
  }, [rev, flush]);

  // 저장 전에 창을 닫으려 하면 경고
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (latest.current.rev > savedRev.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  // "저장됨"은 잠깐만
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), OK_MESSAGE_MS);
    return () => clearTimeout(t);
  }, [saveState]);

  return { saveState, markDirty, flush, exclusive };
}
