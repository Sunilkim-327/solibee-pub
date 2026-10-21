/**
 * 앱 로고 — 글자 표기 (공개본은 회사 로고 대신 중립 표기)
 * size: sm 상단바·사이드바 · lg 로그인
 */
export function Logo({ sub = true, size = "sm" }: { sub?: boolean; size?: "sm" | "lg" }) {
  return (
    <span className="flex items-center gap-2 select-none">
      <span className={`${size === "lg" ? "text-[28px]" : "text-[20px]"} font-bold leading-none tracking-tight text-fg`}>solibee</span>
      {sub && <span className="text-xs font-medium text-fg-subtle">운영비 정산</span>}
    </span>
  );
}
