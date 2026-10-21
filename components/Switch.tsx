"use client";

/** 켜기/끄기 스위치 (role="switch") */
export function Switch({ checked, onChange, label, disabled, className = "" }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 화면 낭독기용 이름 */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-line-strong"
      } ${className}`}>
      <span className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}
