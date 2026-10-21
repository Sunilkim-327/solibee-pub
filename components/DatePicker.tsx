"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { dateWithWeekday } from "@/lib/policy";
import { addMonths, pad2 as pad, todayString } from "@/lib/format";
import { Icon } from "./icons";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const isYmd = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * 앱 디자인에 맞춘 달력 팝오버 (브라우저 기본 달력 대신) — 모든 날짜 칸이 이것을 쓴다.
 * 버튼 아래에 열리고 화면 밖으로 넘치면 안쪽으로 밀어 넣는다. 바깥을 누르거나 Esc로 닫힌다.
 * 마감된 월(lockedMonths)·min~max 밖의 날짜는 고를 수 없다. 연·월은 머리글에서 바로 고른다.
 */
export function DatePicker({ value, onChange, today: todayProp, lockedMonths = [], min, max, clearable, children, className = "", label = "날짜 선택" }: {
  /** YYYY-MM-DD (비어 있으면 "") */
  value: string;
  onChange: (date: string) => void;
  /** 오늘 (YYYY-MM-DD) — 없으면 브라우저 기준 */
  today?: string;
  lockedMonths?: string[];
  min?: string;
  max?: string;
  /** [지우기] 버튼 (선택 입력 칸) */
  clearable?: boolean;
  /** 버튼 안에 보일 내용 */
  children: React.ReactNode;
  /** 버튼 class */
  className?: string;
  /** 화면 낭독기용 이름 */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState(todayProp ?? "");
  const start = () => (isYmd(value) ? value : today || todayString()).slice(0, 7);
  const [view, setView] = useState(start);
  const [nudge, setNudge] = useState(0);
  /** 아래 공간이 모자라면(모바일 하단 메뉴·입력 막대에 가림) 버튼 위로 연다 */
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => { setToday(todayProp ?? todayString()); }, [todayProp]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    // preventDefault: 시트(Sheet) 안에서 Esc가 달력만 닫고 시트는 닫지 않도록
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); box.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    // 열리면 고른 날(없으면 오늘·첫 날)로 포커스 — 키보드로 바로 고를 수 있게
    requestAnimationFrame(() => {
      const p = pop.current;
      (p?.querySelector<HTMLButtonElement>("button[aria-pressed=true]") ?? p?.querySelector<HTMLButtonElement>("button[aria-label$='(오늘)']") ?? p?.querySelector<HTMLButtonElement>("button[aria-pressed]:not(:disabled)"))?.focus({ preventScroll: true });
    });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  // 화면 밖으로 넘치면 안쪽으로 밀기 (오른쪽 끝 칸·좁은 화면)
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    if (window.matchMedia("(max-width: 639px)").matches) return; // 좁은 화면은 하단 고정 — 밀기·뒤집기 없음
    const r = pop.current.getBoundingClientRect();
    const gap = 8;
    // innerWidth는 넘친 팝업 때문에 모바일에서 같이 넓어질 수 있어(가로 스크롤) 문서 폭 기준으로 잰다
    const vw = document.documentElement.clientWidth;
    if (r.right > vw - gap) setNudge(Math.max(gap - r.left, vw - gap - r.right));
    else if (r.left < gap) setNudge(gap - r.left);
    // 화면 아래쪽 고정 막대(하단 메뉴 + 등록 막대 ≈ 120px)에 가리면 위로
    const bottomBars = window.matchMedia("(min-width: 1024px)").matches ? 0 : 120;
    const btnTop = box.current?.getBoundingClientRect().top ?? 0;
    if (r.bottom > window.innerHeight - bottomBars && btnTop - r.height - 8 > 0) setUp(true);
  }, [open]);

  const [y, m] = view.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const locked = lockedMonths.includes(view);
  const off = (date: string) => locked || (isYmd(min) && date < min) || (isYmd(max) && date > max);

  // 연도 범위: min~max가 있으면 그 안, 없으면 올해 기준 과거 40년 ~ 미래 10년
  const thisYear = Number((today || todayString()).slice(0, 4));
  const y0 = isYmd(min) ? Number(min.slice(0, 4)) : Math.min(thisYear - 40, y);
  const y1 = isYmd(max) ? Number(max.slice(0, 4)) : Math.max(thisYear + 10, y);
  const years = Array.from({ length: Math.max(1, y1 - y0 + 1) }, (_, i) => y0 + i);

  const pick = (d: string) => { onChange(d); setOpen(false); };
  const navBtn = "flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-muted hover:text-fg";
  const sel = "h-9 cursor-pointer rounded-lg bg-surface px-1.5 text-sm font-bold text-fg hover:bg-surface-muted";
  const todayOff = !today || off(today) || lockedMonths.includes(today.slice(0, 7));

  return (
    <div ref={box} className="relative">
      <button type="button" className={className} aria-haspopup="dialog" aria-expanded={open} aria-label={label}
        onClick={() => { setView(start()); setNudge(0); setUp(false); setOpen(!open); }}>
        {children}
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label={label} style={nudge ? { transform: `translateX(${nudge}px)` } : undefined}
          // 좁은 화면: 버튼 기준 위치는 하단 메뉴·입력 막대·상단 바에 가리기 쉬워 하단 메뉴 바로 위에 고정 (시트처럼)
          className={`z-[45] rounded-2xl border border-line bg-surface p-3 text-fg shadow-pop max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-sm:z-[56] sm:absolute sm:left-0 sm:w-80 sm:max-w-[calc(100vw-1rem)] ${up ? "sm:bottom-full sm:mb-2" : "sm:top-full sm:mt-2"}`}>
          <div className="mb-1 flex items-center justify-between gap-1">
            <button type="button" className={navBtn} aria-label="이전 달" onClick={() => setView(addMonths(view, -1))}>
              <Icon name="prev" />
            </button>
            <div className="flex items-center">
              <select className={sel} aria-label="연도" value={y} onChange={(e) => setView(`${e.target.value}-${pad(m)}`)}>
                {years.map((n) => <option key={n} value={n}>{n}년</option>)}
              </select>
              <select className={sel} aria-label="월" value={m} onChange={(e) => setView(`${y}-${pad(Number(e.target.value))}`)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}월</option>)}
              </select>
              {locked && <span className="badge badge-neutral ml-1">마감</span>}
            </div>
            <button type="button" className={navBtn} aria-label="다음 달" onClick={() => setView(addMonths(view, 1))}>
              <Icon name="next" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs font-semibold">
            {WEEK.map((w, i) => (
              <div key={w} className={`py-1.5 ${i === 0 ? "text-rose-700" : i === 6 ? "text-sky-600" : "text-fg-subtle"}`}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} />;
              const date = ymd(y, m, d);
              const on = date === value;
              const isToday = date === today;
              const dow = i % 7;
              return (
                <button key={date} type="button" disabled={off(date)} onClick={() => pick(date)} aria-pressed={on}
                  aria-label={`${y}년 ${m}월 ${d}일${isToday ? " (오늘)" : ""}`}
                  className={`tabular mx-auto flex aspect-square w-full max-w-10 items-center justify-center rounded-full text-sm transition disabled:cursor-not-allowed disabled:opacity-35 ${
                    on ? "bg-primary font-bold text-on-primary"
                      : `hover:bg-surface-muted ${isToday ? "font-bold text-primary ring-1 ring-inset ring-primary" : dow === 0 ? "text-rose-700" : dow === 6 ? "text-sky-600" : "text-fg"}`
                  }`}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{locked ? "마감된 달은 고를 수 없어요" : ""}</span>
            {clearable && value && <button type="button" className="btn-ghost btn-sm" onClick={() => pick("")}>지우기</button>}
            <button type="button" className="btn-ghost btn-sm" disabled={!today}
              onClick={() => (todayOff ? setView(today.slice(0, 7)) : pick(today))}>오늘</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 입력칸 모양의 날짜 칸 — 폼 안의 날짜 입력은 모두 이것을 쓴다.
 * 제어(value+onChange) 또는 비제어(defaultValue+name, 서버 폼 GET 전송) 둘 다 된다.
 * <label>로 감싸지 말 것 (달력 안을 누를 때 버튼이 다시 눌림) — 바깥은 div로.
 */
export function DateField({ value, defaultValue, onChange, name, min, max, placeholder = "날짜 선택", clearable, className = "", label = "날짜" }: {
  value?: string;
  defaultValue?: string;
  onChange?: (date: string) => void;
  /** 폼 전송용 이름 (숨은 입력칸으로 보냄) */
  name?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  clearable?: boolean;
  /** 버튼 class (기본 input 모양에 덧붙임) */
  className?: string;
  label?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const v = value ?? inner;
  const set = (d: string) => { if (value === undefined) setInner(d); onChange?.(d); };
  return (
    <>
      <DatePicker value={v} onChange={set} min={min} max={max} clearable={clearable} label={label}
        className={`input flex items-center justify-between gap-2 text-left ${className}`}>
        <span className={`tabular truncate ${isYmd(v) ? "" : "text-fg-subtle"}`}>
          {isYmd(v) ? `${v.replace(/-/g, ".")} (${dateWithWeekday(v).slice(-2, -1)})` : placeholder}
        </span>
        <Icon name="calendar" className="size-4 shrink-0 text-fg-muted" />
      </DatePicker>
      {name && <input type="hidden" name={name} value={v} />}
    </>
  );
}
