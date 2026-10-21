import Link from "next/link";
import type { SetupState } from "@/lib/todo";

/**
 * 지출 입력 시작 준비 — 필수는 재무 승인의 예산 등록 하나. 팀원·팀원 지출 항목은 '팀원도 입력한다면' 고르는 선택 사항
 * (PM만 입력하는 프로젝트도 정상 운영 형태 — 순서는 PM 설정 섹션 순서와 같게)
 * @param onSettingsPage PM 설정 화면 안에서 표시 — 안내를 섹션 이름으로 바꾸고 PM 설정 링크는 숨긴다
 */
export function SetupChecklist({ setup, className = "", onSettingsPage = false }: { setup: SetupState; className?: string; onSettingsPage?: boolean }) {
  const optional = [
    {
      ok: setup.hasMembers, label: "프로젝트 팀원 추가", href: "/settings#people",
      hint: onSettingsPage ? "'프로젝트 팀원'에서 팀원을 추가하세요." : "PM 설정 › 팀원에서 팀원을 추가하세요.",
    },
    {
      ok: setup.hasMemberItems, label: "팀원 지출 항목 선택", href: "/settings#items",
      hint: onSettingsPage ? "'팀원 지출 항목'에서 항목을 고르고 저장하세요." : "PM 설정 › 지출 항목에서 항목을 고르고 저장하세요.",
    },
  ];
  return (
    <div className={className}>
      <h3 className="text-sm font-bold">지출 입력 시작 준비</h3>
      <p className="mt-0.5 text-xs text-fg-muted">재무 승인 담당이 예산을 등록하면 PM이 바로 입력할 수 있습니다.</p>
      <ol className="mt-3 space-y-2 text-sm">
        <li className="flex gap-3">
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${setup.hasBudget ? "bg-surface-muted text-fg-muted ring-1 ring-line" : "bg-amber-100 text-amber-800"}`}>
            {setup.hasBudget ? "✓" : "1"}
          </span>
          <div className="min-w-0">
            <b className={setup.hasBudget ? "text-fg-muted line-through" : ""}>예산 등록 (재무 승인 담당)</b>
            {!setup.hasBudget && <span className="ml-1.5 badge badge-warn px-1.5">필수</span>}
            {!setup.hasBudget && <p className="text-xs text-fg-muted">재무 승인 담당에게 &apos;프로젝트 운영비&apos;에 예산(항목·단가·기간) 등록을 요청하세요.</p>}
          </div>
        </li>
      </ol>
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-semibold text-fg-muted">팀원도 입력한다면 <span className="font-normal">· 선택</span></p>
        <ul className="mt-2 space-y-2 text-sm">
          {optional.map((s) => (
            <li key={s.label} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-fg-muted ring-1 ring-line">
                {s.ok ? "✓" : "–"}
              </span>
              <div className="min-w-0">
                <b className={s.ok ? "text-fg-muted" : "font-semibold"}>{s.label}</b>
                {s.ok && <span className="ml-1.5 text-xs text-fg-muted">완료</span>}
                {!s.ok && (
                  <p className="text-xs text-fg-muted">
                    {s.hint}
                    {!onSettingsPage && <> <Link href={s.href} className="font-semibold text-fg underline">PM 설정 →</Link></>}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
