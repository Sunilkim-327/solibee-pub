"use client";

import { useState } from "react";
import { formatDateTime, tempPasswordCsv } from "@/lib/user-admin";
import { kstDateTime } from "@/lib/format";

export type TempPassword = { name: string; loginId: string; tempPassword: string; expiresAt?: string | null };

/** 임시 비밀번호 안내 — 화면 가운데 팝업 (한 번만 표시, 복사·CSV 내려받기) */
export function TempPasswordDialog({ items, onClose }: { items: TempPassword[]; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  if (!items.length) return null;
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  };
  // 로그인 주소 (전달할 때 함께 보내도록)
  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const withAddress = (i: TempPassword) => `접속 주소: ${loginUrl}\n아이디: ${i.loginId}\n임시 비밀번호: ${i.tempPassword}${i.expiresAt ? `\n(${formatDateTime(i.expiresAt)}까지 로그인해 새 비밀번호로 바꾸세요)` : ""}`;
  const all = `접속 주소: ${loginUrl}\n` + items
    .map((i) => [i.name, i.loginId, i.tempPassword, i.expiresAt ? formatDateTime(i.expiresAt) : ""].join("\t"))
    .join("\n");
  const download = () => {
    const blob = new Blob([tempPasswordCsv(items)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `임시비밀번호_${formatDateTime(new Date()).replace(/[-: ]/g, "").slice(0, 12)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };
  const many = items.length > 1;
  const close = () => {
    setCopied(null);
    setDownloaded(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="임시 비밀번호">
      <div className={`flex max-h-[90vh] w-full flex-col rounded-2xl bg-surface p-5 shadow-sheet ${many ? "max-w-2xl" : "max-w-lg"}`}>
        <h2 className="text-base font-bold">
          임시 비밀번호가 발급되었습니다{many && <span className="ml-1 font-normal text-fg-muted">({items.length}명)</span>}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          이 창을 닫으면 다시 볼 수 없습니다. <b className="text-fg">24시간 안에</b> 본인이 로그인해 새 비밀번호로 바꿔야 합니다.
        </p>
        <ul className="mt-4 min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {items.map((i, idx) => (
            // 좁은 화면: 이름·아이디가 한 글자씩 접히지 않도록 비밀번호·복사 버튼은 다음 줄로 내려간다
            <li key={`${i.loginId}-${idx}`} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 ${many ? "py-2" : "py-3"}`}>
              <div className="min-w-40 flex-1">
                <div className="text-sm font-semibold">{i.name}</div>
                <div className="truncate text-xs text-fg-muted">
                  아이디 {i.loginId}
                  {i.expiresAt && <span className="ml-2 text-fg-subtle">{kstDateTime(i.expiresAt)}까지</span>}
                </div>
              </div>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <code className={`rounded-lg bg-surface-muted px-3 py-1.5 font-mono font-bold tracking-wider ${many ? "text-sm" : "text-base"}`}>{i.tempPassword}</code>
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => copy(`${i.loginId}-${idx}`, withAddress(i))}>
                  {copied === `${i.loginId}-${idx}` ? "복사됨" : "주소와 함께 복사"}
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-fg-muted">본인만 볼 수 있는 경로(메신저 등)로 전달하세요.</p>
        {many && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            내려받은 파일에는 <b>비밀번호가 그대로 들어 있습니다.</b> 공유 폴더·메일에 올리지 말고, 전달을 마치면 바로 삭제하세요.
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {many && (
            <>
              <button type="button" className="btn-secondary" onClick={download}>{downloaded ? "내려받음 ✓" : "엑셀(CSV) 내려받기"}</button>
              <button type="button" className="btn-secondary" onClick={() => copy("__all", all)}>{copied === "__all" ? "전체 복사됨" : "주소와 함께 전체 복사"}</button>
            </>
          )}
          <button type="button" className="btn-primary" onClick={close}>확인했습니다</button>
        </div>
      </div>
    </div>
  );
}
