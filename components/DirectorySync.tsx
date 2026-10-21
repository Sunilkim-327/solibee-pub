"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { kstDateTime } from "@/lib/format";
import { Icon } from "./icons";

type Status = {
  source: string;
  baseUrl: string;
  apiConfigured: boolean;
  lastSync: { at: string; summary: Summary | null } | null;
  syncedUsers: number;
  syncedDepts: number;
  pending: { id: string; deptCount: number; userCount: number; createdAt: string } | null;
};
type Mode = "api" | "upload" | "pending";
/** 동기화 요청 본문 (dryRun 제외) — 미리보기한 그대로 적용하기 위해 보관 */
type SyncRequest = { mode: Mode; departments?: unknown; employees?: unknown; importId?: string };
type Counts = { create: number; update: number; deactivate: number };
type Summary = { departments: Counts; users: Counts; warnings: string[] };
type Preview = {
  summary: Summary;
  samples: { departments: { kind: string; name: string; detail: string }[]; users: { kind: string; name: string; detail: string }[] };
  source: { departments: number; users: number };
};

const readJsonFile = async (f: File) => JSON.parse(await f.text());

function CountsCard({ label, c }: { label: string; c: Counts }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3">
      <div className="text-xs font-medium text-fg-muted">{label}</div>
      <div className="tabular mt-1.5 grid grid-cols-3 gap-2 text-center">
        <div><div className="text-xl font-bold text-emerald-700">+{c.create}</div><div className="text-xs text-fg-muted">추가</div></div>
        <div><div className="text-xl font-bold">{c.update}</div><div className="text-xs text-fg-muted">수정</div></div>
        <div><div className={`text-xl font-bold ${c.deactivate ? "text-rose-600" : ""}`}>{c.deactivate}</div><div className="text-xs text-fg-muted">{label === "부서" ? "사용 중지" : "비활성화"}</div></div>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="tabular mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-primary ring-1 ring-brand-100">{n}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Soliday 조직도 연동 패널 (시스템 관리자) */
export function DirectorySync() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [files, setFiles] = useState<{ departments?: unknown; employees?: unknown }>({});
  const [preview, setPreview] = useState<{ request: SyncRequest; data: Preview } | null>(null);
  const [link, setLink] = useState<{ bookmarklet: string; expiresAt: string; solidayUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<Status>("/api/admin/directory").then(setStatus).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  /** 현재 선택(파일·받은 조직도)으로 요청 본문을 만든다 — 미리보기 때만 사용 */
  const requestFor = (mode: Mode): SyncRequest =>
    ({ mode, ...(mode === "upload" ? files : {}), ...(mode === "pending" ? { importId: status?.pending?.id } : {}) });

  /** 미리보기는 새 요청, 적용은 미리보기한 요청 그대로 */
  async function run(request: SyncRequest, dryRun: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ dryRun: boolean; summary: Summary } & Partial<Preview>>("/api/admin/directory", { method: "POST", json: { ...request, dryRun } });
      if (dryRun) setPreview({ request, data: r as Preview });
      else {
        setPreview(null);
        const s = r.summary;
        // 프로젝트 팀원이 비활성화됐으면 따로 알린다 (각 프로젝트 PM이 이전 팀원으로 처리). 경고 문구는 lib/directory-sync INACTIVE_MEMBER_WARNING — 옛 문구도 함께 맞춘다
        const inactiveMembers = s.warnings.find((w) => w.startsWith("프로젝트 팀원 중 비활성화") || w.startsWith("프로젝트 구성원 중 비활성화"));
        setMsg({
          ok: true,
          text: `동기화 완료 — 부서 +${s.departments.create}/수정 ${s.departments.update}/중지 ${s.departments.deactivate}, 사용자 +${s.users.create}/수정 ${s.users.update}/비활성 ${s.users.deactivate}${s.warnings.length ? ` · 경고 ${s.warnings.length}건` : ""}${inactiveMembers ? ` · ${inactiveMembers} (각 프로젝트 PM이 이전 팀원으로 처리)` : ""}`,
        });
        await load();
        router.refresh();
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-line px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h3 className="section-title">Soliday 조직도 연동</h3>
          <p className="mt-0.5 text-xs text-fg-muted">{status?.baseUrl ?? "hr.example.com"}의 부서·임직원을 부서코드·이메일 기준으로 맞춥니다.</p>
        </div>
        {status && (
          <dl className="tabular flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <div><dt className="text-fg-muted">연동 부서</dt><dd className="mt-0.5 font-semibold">{status.syncedDepts}</dd></div>
            <div><dt className="text-fg-muted">연동 사용자</dt><dd className="mt-0.5 font-semibold tabular">{status.syncedUsers}</dd></div>
            <div><dt className="text-fg-muted">마지막 동기화</dt><dd className="mt-0.5 font-semibold">{status.lastSync ? kstDateTime(status.lastSync.at) : "없음"}</dd></div>
          </dl>
        )}
      </header>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {/* 권장: Soliday 화면에서 보내기 */}
        <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-primary text-on-primary">권장</span>
            <span className="text-sm font-bold">Soliday 화면에서 바로 보내기</span>
          </div>
          {status?.pending ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-3">
              <span className="text-sm">
                <b>받은 조직도</b> <span className="tabular">부서 {status.pending.deptCount} · 임직원 {status.pending.userCount}</span>
                <span className="ml-1.5 text-xs text-fg-muted">{kstDateTime(status.pending.createdAt)}</span>
              </span>
              <button className="btn-primary ml-auto" disabled={busy} onClick={() => run(requestFor("pending"), true)}>미리보기</button>
            </div>
          ) : (
            <>
              <ol className="mt-3 space-y-1.5 text-sm text-fg-muted">
                <Step n={1}><b className="text-fg">전송 링크 만들기</b>를 누르세요 (10분간 유효).</Step>
                <Step n={2}>나타난 <b className="text-fg">‘운영비 정산으로 보내기’</b> 버튼을 즐겨찾기 막대로 끌어다 놓으세요.</Step>
                <Step n={3}>Soliday 조직도 화면에서 그 즐겨찾기를 누른 뒤, 여기로 돌아와 새로고침 → 미리보기 → 적용.</Step>
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="btn-secondary" disabled={busy}
                  onClick={async () => {
                    try {
                      setLink(await api("/api/admin/directory/token", { method: "POST" }));
                    } catch (e) {
                      setMsg({ ok: false, text: (e as Error).message });
                    }
                  }}>
                  {link ? "링크 다시 만들기" : "전송 링크 만들기"}
                </button>
                {link && (
                  <>
                    {/* 북마클릿: 즐겨찾기 막대로 끌어다 놓아 사용 (React는 javascript: href를 막으므로 DOM에 직접 설정) */}
                    <a ref={(el) => el?.setAttribute("href", link.bookmarklet)} onClick={(e) => e.preventDefault()} draggable
                      className="inline-flex min-h-10 cursor-grab items-center rounded-lg bg-primary px-3.5 text-sm font-bold text-on-primary shadow-sm">
                      ⭐ 운영비 정산으로 보내기
                    </a>
                    <a className="btn-ghost text-primary" href={link.solidayUrl} target="_blank" rel="noreferrer">Soliday 조직도 열기 ↗</a>
                    <button className="btn-ghost" onClick={() => load()}>받았는지 확인</button>
                    <span className="tabular text-xs text-fg-subtle">{kstDateTime(link.expiresAt).slice(11)}까지 유효</span>
                  </>
                )}
              </div>
              <p className="mt-3 text-xs text-fg-subtle">보내는 정보: 부서(코드·이름·상위), 임직원(이름·이메일·부서·직급·입사일·재직상태). 휴대폰은 보내지 않습니다.</p>
            </>
          )}
        </div>

        <details className="group rounded-xl border border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-fg-muted [&::-webkit-details-marker]:hidden">
            <Icon name="chevron" className="size-3.5 transition-transform group-open:rotate-90" />
            다른 방법 (API 토큰 · JSON 파일)
          </summary>
          <div className="grid gap-3 border-t border-line p-4 lg:grid-cols-2">
            <div className="rounded-lg bg-surface-muted/60 p-4">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${status?.apiConfigured ? "bg-status-approved" : "bg-fg-subtle"}`} aria-hidden />
                <span className="text-sm font-bold">자동 연동 (API)</span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {status?.apiConfigured
                  ? "서버가 Soliday API를 직접 호출합니다."
                  : "Soliday 서비스 토큰을 .env의 SOLIDAY_API_TOKEN에 설정하면 사용할 수 있습니다."}
              </p>
              <button className="btn-secondary mt-3" disabled={busy || !status?.apiConfigured} onClick={() => run(requestFor("api"), true)}>미리보기</button>
            </div>

            <div className="rounded-lg bg-surface-muted/60 p-4">
              <span className="text-sm font-bold">파일로 연동 (토큰 없이)</span>
              <ol className="mt-1.5 space-y-1 text-sm text-fg-muted">
                <Step n={1}>Soliday에 로그인한 브라우저에서 다음 두 주소를 열어 각각 저장(Ctrl+S)</Step>
                <Step n={2}>저장한 두 JSON 파일을 선택 → 미리보기 → 적용</Step>
              </ol>
              <div className="mt-2 flex flex-wrap gap-x-3 text-xs">
                <a className="text-primary underline" href={`${status?.baseUrl ?? "https://hr.example.com"}/api/departments`} target="_blank" rel="noreferrer">/api/departments</a>
                <a className="text-primary underline" href={`${status?.baseUrl ?? "https://hr.example.com"}/api/org/employees`} target="_blank" rel="noreferrer">/api/org/employees</a>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(["departments", "employees"] as const).map((k) => (
                  <label key={k} className={`btn-secondary cursor-pointer justify-start ${files[k] ? "border-status-approved text-status-approved" : ""}`}>
                    {files[k] ? "✓ " : ""}{k === "departments" ? "부서 JSON" : "임직원 JSON"}
                    <input type="file" accept="application/json,.json" className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const json = await readJsonFile(f);
                          setFiles((x) => ({ ...x, [k]: json }));
                        } catch {
                          setMsg({ ok: false, text: "JSON 파일을 읽을 수 없습니다." });
                        }
                      }} />
                  </label>
                ))}
              </div>
              <button className="btn-secondary mt-2" disabled={busy || !files.departments || !files.employees} onClick={() => run(requestFor("upload"), true)}>
                미리보기
              </button>
            </div>
          </div>
        </details>

        {preview && (
          <div className="rounded-xl border border-brand-100 bg-brand-50/60">
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
              <p className="text-sm font-bold">미리보기</p>
              <span className="tabular text-xs text-fg-muted">원본 부서 {preview.data.source.departments} · 임직원 {preview.data.source.users}</span>
            </div>
            <div className="grid gap-2 px-4 pt-3 sm:grid-cols-2">
              <CountsCard label="부서" c={preview.data.summary.departments} />
              <CountsCard label="사용자" c={preview.data.summary.users} />
            </div>
            <div className="grid gap-3 px-4 pt-3 text-xs sm:grid-cols-2">
              {(["departments", "users"] as const).map((k) => (
                <ul key={k} className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-surface px-3 py-2">
                  {preview.data.samples[k].length === 0 && <li className="text-fg-subtle">변경 없음</li>}
                  {preview.data.samples[k].map((s, i) => (
                    <li key={i}><span className="font-semibold">{s.kind}</span> {s.name} <span className="text-fg-muted">{s.detail}</span></li>
                  ))}
                </ul>
              ))}
            </div>
            <ul className="mt-3 list-inside list-disc space-y-0.5 px-4 text-xs text-fg-muted">
              <li>새 계정 기본 역할: <b>재무회계팀</b> 소속 → 재무 승인, 그 외 → 팀원. 기존 계정의 역할은 바꾸지 않습니다.</li>
              <li>새 계정은 임시 비밀번호를 발급해야 로그인할 수 있습니다. &lsquo;사용자 · 로그인&rsquo; 탭에서 &lsquo;미발급&rsquo;으로 걸러 일괄 발급하세요.</li>
              <li>Soliday에 없는 연동 사용자는 비활성화되며, 앱에서 직접 만든 계정은 바뀌지 않습니다.</li>
            </ul>
            <div className="mt-3 flex justify-end gap-2 border-t border-brand-100 px-4 py-3">
              <button className="btn-ghost" onClick={() => setPreview(null)}>취소</button>
              <button className="btn-primary" disabled={busy} onClick={() => run(preview.request, false)}>{busy ? "적용 중…" : "동기화 적용"}</button>
            </div>
          </div>
        )}
        {msg && <p className={`alert ${msg.ok ? "alert-ok" : "alert-danger"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
