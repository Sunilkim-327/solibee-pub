"use client";
// 팀원별 정산 카드의 '알림 문구' — 미입력·소명 없는 팀원에게 앱 알림을 보내거나, 글을 복사·메일 앱으로 연다
import { useState } from "react";
import { Sheet } from "./Sheet";
import { api } from "@/lib/client";
import { REMIND_LABEL, remindBody, remindMailto, type RemindGroup, type RemindKind } from "@/lib/remind";

type SendResult = { created: number; skipped: number };

/** 보낸 결과 한 줄: "3명에게 보냈어요 (오늘 이미 보낸 1명 제외)" */
export function sentLine(r: SendResult): string {
  if (r.created === 0 && r.skipped > 0) return `오늘 이미 ${r.skipped}명 모두에게 보냈어요. 앱 알림은 하루 한 번만 가요.`;
  return `${r.created}명에게 보냈어요${r.skipped > 0 ? ` (오늘 이미 보낸 ${r.skipped}명 제외)` : ""}`;
}

export function RemindButton({ groups, ym, projectName, origin, projectId }: { groups: RemindGroup[]; ym: string; projectName: string; origin: string; projectId: string }) {
  const available = groups.filter((g) => g.people.length > 0);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RemindKind>(available[0]?.kind ?? "noinput");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  /** 보낸 직후 2초 — 버튼이 "✓ 보냄" */
  const [justSent, setJustSent] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!available.length) return null;
  const group = available.find((g) => g.kind === kind) ?? available[0];
  const opts = { ym, projectName, people: group.people, origin };
  const body = remindBody(group.kind, opts);
  const mailto = remindMailto(group.kind, opts);
  const noEmail = group.people.filter((p) => !p.email);

  function reset() {
    setCopied(false);
    setResult(null);
    setError(null);
    setJustSent(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function send() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await api<SendResult>(`/api/projects/${projectId}/remind`, {
        method: "POST",
        json: { kind: group.kind, ym, userIds: group.people.map((p) => p.id) },
      });
      setResult({ created: Number(r.created) || 0, skipped: Number(r.skipped) || 0 });
      setJustSent(true);
      setTimeout(() => setJustSent(false), 2000);
    } catch (e) {
      setError((e as Error).message || "앱 알림을 보내지 못했어요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => { setOpen(true); reset(); }}>
        알림 문구
      </button>
      {open && (
        <Sheet title="팀원에게 보낼 알림" onClose={() => setOpen(false)}
          footer={
            <div className="space-y-2">
              {result && <p role="status" className="text-sm font-medium text-status-approved">{sentLine(result)}</p>}
              {error && <p role="alert" className="text-sm text-status-rejected">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary basis-full sm:basis-auto sm:flex-1" disabled={sending} onClick={send}>
                  {justSent ? "✓ 보냄" : sending ? "보내는 중…" : "앱 알림 보내기"}
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={copy}>{copied ? "✓ 복사됨" : "문구 복사"}</button>
                {mailto && <a className="btn-secondary flex-1 text-center" href={mailto}>메일 쓰기</a>}
              </div>
            </div>
          }>
          <div className="space-y-4">
            {available.length > 1 && (
              <div className="seg flex w-full" role="tablist" aria-label="알림 종류">
                {available.map((g) => (
                  <button key={g.kind} type="button" role="tab" aria-selected={g.kind === group.kind} className="flex-1"
                    onClick={() => { setKind(g.kind); reset(); }}>
                    {REMIND_LABEL[g.kind]} {g.people.length}명
                  </button>
                ))}
              </div>
            )}
            <div>
              <h3 className="mb-1.5 text-sm font-bold">받는 사람 {group.people.length}명</h3>
              <p className="text-sm text-fg-2">{group.people.map((p) => p.count ? `${p.name}(${p.count}건)` : p.name).join(", ")}</p>
            </div>
            <div>
              <h3 className="mb-1.5 text-sm font-bold">보낼 문구</h3>
              <pre className="whitespace-pre-wrap rounded-xl bg-surface-muted px-4 py-3 font-sans text-sm leading-relaxed text-fg">{body}</pre>
            </div>
            <p className="text-xs text-fg-muted">
              앱 알림은 팀원의 상단 종에 표시돼요. 메신저에 붙이려면 문구를 복사하세요.
              {mailto && " 메일 받는 사람은 숨은 참조로 들어가요."}
              {noEmail.length > 0 && ` 메일 주소가 없는 ${noEmail.map((p) => p.name).join("·")}님은 앱 알림이나 메신저로 보내 주세요.`}
            </p>
          </div>
        </Sheet>
      )}
    </>
  );
}
