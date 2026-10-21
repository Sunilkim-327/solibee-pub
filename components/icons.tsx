// 공용 선 아이콘 — 모든 아이콘은 stroke(currentColor) 한 개의 path.
// 화면마다 따로 붙여 넣던 SVG를 한곳에 모았다. 크기는 className(기본 size-4)으로 정한다.

export type IconDef = {
  d: string;
  /** viewBox 격자 (기본 20) */
  box?: 20 | 24;
  /** 선 굵기 (기본 1.7) */
  sw?: number;
  /** 꺾이는 곳을 둥글게 (기본 true) */
  join?: boolean;
};

export const ICONS = {
  // ── 20px 격자 ──
  up: { d: "m5 12 5-5 5 5" },
  down: { d: "m5 8 5 5 5-5" },
  /** 펼침 화살표 (오른쪽) — 목록 행 */
  disclose: { d: "M7 5l5 5-5 5", sw: 1.8 },
  /** 달력 이전·다음 */
  prev: { d: "M12 5l-5 5 5 5", sw: 2, join: false },
  next: { d: "M8 5l5 5-5 5", sw: 2, join: false },
  pencil: { d: "M13.5 4.5l2 2L8 14H6v-2l7.5-7.5z" },
  trash: { d: "M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.5 9v4M11.5 9v4", sw: 1.6 },
  close: { d: "M5.5 5.5l9 9M14.5 5.5l-9 9" },
  search: { d: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.5-3.5" },
  plus: { d: "M10 4.5v11M4.5 10h11" },
  check: { d: "m5 10 3.5 3.5L15 7", sw: 2 },
  download: { d: "M10 3v10m0 0-4-4m4 4 4-4M4 15v2h12v-2" },
  calendar: { d: "M5 4.5h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM3 8.5h14M7 3v3M13 3v3", sw: 1.6, join: false },
  /** 대기(상신 — 승인 대기). 그림 이모지는 글자색을 따르지 않아 상태색이 깨지므로 선 아이콘으로 */
  clock: { d: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.5V10l2.5 1.5", sw: 1.8 },
  /** 인원(참석·대상 인원) */
  people: { d: "M7.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2.5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5M13 4.7a2.5 2.5 0 0 1 0 4.6M14.5 11.8c1.8.5 3 1.9 3 4.2", sw: 1.6 },
  /** 마감(잠김) */
  lock: { d: "M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9M4.5 9h11v7.5h-11z", sw: 1.7 },
  // ── 24px 격자 ──
  /** 트리·접이식 펼침 화살표 */
  chevron: { d: "m9 6 6 6-6 6", box: 24, sw: 2.2, join: false },
  chevronDown: { d: "m6 9 6 6 6-6", box: 24, sw: 2.2, join: false },
  /** 검색칸 돋보기 */
  find: { d: "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM20 20l-3.5-3.5", box: 24, sw: 2, join: false },
  message: { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", box: 24, sw: 2 },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

type IconProps = { className?: string; box?: 20 | 24; sw?: number; join?: boolean } & ({ name: IconName; d?: never } | { d: string; name?: never });

/** 선 아이콘. name(공용 모음) 또는 d(그 화면 전용 경로) — box·sw·join으로 기본값을 덮어쓸 수 있다 */
export function Icon({ name, d, className = "size-4", box, sw, join }: IconProps) {
  const def: IconDef = name ? ICONS[name] : { d: d! };
  const size = box ?? def.box ?? 20;
  const round = join ?? def.join ?? true;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} fill="none" stroke="currentColor" strokeWidth={sw ?? def.sw ?? 1.7}
      strokeLinecap="round" strokeLinejoin={round ? "round" : undefined} aria-hidden>
      <path d={def.d} />
    </svg>
  );
}

/** 아이콘 버튼 (터치 40px, 데스크톱 36px) — 라벨은 aria-label·title로 */
export function IconButton({ name, label, onClick, disabled, danger, sw }: {
  name: IconName; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; sw?: number;
}) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition disabled:opacity-30 sm:size-9 ${danger ? "hover:bg-rose-50 hover:text-rose-600" : "hover:bg-surface-muted hover:text-fg"}`}>
      <Icon name={name} sw={sw} />
    </button>
  );
}
