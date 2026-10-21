"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { NodeIcon, TreeView, type TreeNode } from "./Tree";
import { api } from "@/lib/client";
import { ctxOf, withCtx } from "@/lib/page-ctx";
import type { Role } from "@/lib/types";
import { Icon as SvgIcon } from "./icons";
import { Logo } from "./Logo";
import { BELL_ICON } from "./notifications/kinds";
import { useUnread } from "./notifications/unread";

/**
 * 메뉴 묶음
 * - home: 재무 승인·시스템 관리자의 첫 화면(전체 프로젝트) — 묶음 제목 없이 맨 위
 * - work: 이 프로젝트 (현재 프로젝트의 입력·현황·정산)
 * - budget: 예산·마감 (현재 프로젝트)
 * - company: 회사 (프로젝트와 무관 — 조직도·체계도·알림·내 계정)
 * - admin: 관리
 */
type NavGroup = "home" | "work" | "budget" | "company" | "admin" | "support";

type NavItem = {
  href: string; label: string; short: string; icon: string; roles: Role[]; group: NavGroup;
  /** 역할별 메뉴명 (예: 팀원에게는 '내 지출 내역') */
  labelByRole?: Partial<Record<Role, string>>;
  shortByRole?: Partial<Record<Role, string>>;
};

export const NAV: NavItem[] = [
  { href: "/projects", label: "전체 프로젝트 현황", short: "프로젝트", group: "home", icon: "M3 9.5 12 4l9 5.5M5 10v9h14v-9M9 19v-5h6v5", roles: ["HQ", "ADMIN"] },
  { href: "/expenses/new", label: "지출 입력", short: "입력", group: "work", icon: "M12 8v8M8 12h8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", roles: ["MEMBER", "MANAGER", "HQ", "ADMIN"] },
  // 현황 = 예전 팀 현황 + 월별 현황 (월 요약·할 일·팀원별 정산·지출 내역 한 화면). 팀원에게는 본인 건만 '내 지출 내역'
  { href: "/dashboard", label: "팀 현황", short: "현황", labelByRole: { HQ: "프로젝트 현황", ADMIN: "프로젝트 현황", MEMBER: "내 지출 내역" }, shortByRole: { MEMBER: "내역" }, group: "work", icon: "M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z", roles: ["MEMBER", "MANAGER", "HQ", "ADMIN"] },
  // 순서 = PM 업무 빈도 (마감·상신 → 출입증 → 운영비 → 설정), 2026-10-15
  { href: "/closing", label: "마감 · 상신", short: "마감", group: "budget", icon: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z", roles: ["MANAGER", "HQ", "ADMIN"] },
  // 출입증 정산 처리는 PM. 재무 승인 담당은 마감·상신 화면에서 검토하므로 메뉴에 두지 않는다 (화면은 체크리스트 링크로 열 수 있고 확정 취소만 가능). 시스템 관리자는 지원용 조회 묶음
  { href: "/pass", label: "출입증 정산", short: "출입증 정산", group: "budget", icon: "M3 5h18v14H3zM7 9h4M7 13h6M15 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4z", roles: ["MANAGER", "ADMIN"] },
  { href: "/budget", label: "프로젝트 운영비", short: "운영비", group: "budget", icon: "M4 19V9m6 10V5m6 14v-7m4 7H2", roles: ["MANAGER", "HQ", "ADMIN"] },
  { href: "/settings", label: "PM 설정", short: "설정", group: "budget", icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6", roles: ["MANAGER"] },
  { href: "/org", label: "조직도", short: "조직도", group: "company", icon: "M12 3v4M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 17v-3h14v3M12 11v3M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 7v4", roles: ["HQ", "ADMIN"] },
  { href: "/eps", label: "프로젝트 체계도", short: "체계도", group: "company", icon: "M3 4h6v4H3zM15 4h6v4h-6zM9 16h6v4H9zM6 8v4h12V8M12 12v4", roles: ["HQ", "ADMIN"] },
  // 알림: 모든 역할 — 모바일은 하단 탭 대신 상단 바의 종으로 (시트의 메뉴 격자에도 넣지 않고 계정 줄에 "알림 N")
  { href: "/notifications", label: "알림", short: "알림", group: "company", icon: BELL_ICON, roles: ["MEMBER", "MANAGER", "HQ", "ADMIN"] },
  { href: "/master", label: "기준 정보", short: "기준 정보", group: "admin", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z", roles: ["HQ", "ADMIN"] },
  { href: "/audit", label: "접속·변경 기록", short: "기록", group: "admin", icon: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", roles: ["ADMIN"] },
];

const GROUPS: NavGroup[] = ["home", "work", "budget", "company", "admin", "support"];
const GROUP_LABEL: Record<NavGroup, string> = { home: "", work: "이 프로젝트", budget: "예산 · 마감", company: "회사", admin: "관리", support: "프로젝트 조회 (지원용)" };

/** 시스템 관리자: 프로젝트 메뉴는 접힌 '프로젝트 조회(지원용)' 묶음으로 — 펼침 상태는 이 브라우저에 기억 */
const SUPPORT_KEY = "nav:support-open";
function useSupportOpen(active: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(active || localStorage.getItem(SUPPORT_KEY) === "1"); } catch { setOpen(active); }
  }, [active]);
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(SUPPORT_KEY, v ? "0" : "1"); } catch {}
    return !v;
  });
  return [open, toggle] as const;
}

/** 접히는 묶음 머리 */
function GroupToggle({ label, open, onToggle, className }: { label: string; open: boolean; onToggle: () => void; className: string }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className={`flex w-full items-center justify-between gap-2 rounded-lg text-xs font-bold text-fg-subtle hover:bg-surface-muted hover:text-fg ${className}`}>
      {label}
      <SvgIcon name="chevronDown" className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function Icon({ d, className = "size-[18px]" }: { d: string; className?: string }) {
  return <SvgIcon d={d} box={24} className={`${className} shrink-0`} />;
}

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);
const labelOf = (n: NavItem, role?: Role) => (role && n.labelByRole?.[role]) || n.label;
const shortOf = (n: NavItem, role?: Role) => (role && n.shortByRole?.[role]) || n.short;

/** 조회 전용(상위 PM·조직장)에서 숨기는 메뉴 — 입력·마감·출입증·설정 (현황은 요약·예산만 보인다) */
const VIEW_HIDDEN = ["/expenses/new", "/settings", "/closing", "/pass"];
/** 종료된 프로젝트 등 조회 전용에서 숨기는 메뉴 */
const READONLY_HIDDEN = ["/expenses/new", "/settings"];
/** 하단 탭바를 숨기는 화면 — 없음 (입력 화면도 탭바를 유지하고, 등록 바는 탭바 위에 고정) */
const TABBAR_HIDDEN: string[] = [];

/**
 * 여러 프로젝트를 함께 다루는 화면 — 상단 프로젝트 선택 대신 '회사 전체'를 보여 준다 (화면 안에서 프로젝트를 고름)
 * 기준 정보·전체 프로젝트·조직도·프로젝트 체계도·내 계정·접속 기록·알림
 */
const CROSS_PROJECT = ["/master", "/projects", "/org", "/eps", "/me", "/audit", "/notifications"];
/** 프로젝트 화면에서만 보이는 내용 (회사 화면에서는 숨김) — 예: 시스템 관리자 조회 안내 */
export function ProjectOnly({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return CROSS_PROJECT.some((p) => isActive(path, p)) ? null : <>{children}</>;
}

export function ProjectScope({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (!CROSS_PROJECT.some((p) => isActive(path, p))) return <>{children}</>;
  return (
    <span className="hidden items-center gap-1.5 px-1 py-1.5 text-sm font-semibold text-fg-muted sm:flex">
      <NodeIcon icon="company" />회사 전체
    </span>
  );
}

// ── 화면 제목 공유 ─────────────────────────────────────────
// 화면의 PageHeader(PageHeading)가 제목을 등록하고, 제목이 화면 밖으로 스크롤되면
// 모바일 상단 바가 같은 제목을 작게 이어 보여 준다 (큰 제목 → 축소 제목).
type TitleState = { path: string; title: string; hidden: boolean } | null;
let titleState: TitleState = null;
const titleListeners = new Set<() => void>();
function setTitleState(v: TitleState) {
  titleState = v;
  titleListeners.forEach((l) => l());
}
const subscribeTitle = (l: () => void) => {
  titleListeners.add(l);
  return () => { titleListeners.delete(l); };
};

/** 화면 제목(h1) — 모든 화면 크기에서 본문에 한 번만. 스크롤로 가려지면 모바일 상단 바에 이어 표시 */
export function PageHeading({ title }: { title: string }) {
  const path = usePathname();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const mine: NonNullable<TitleState> = { path, title, hidden: false };
    setTitleState(mine);
    const el = ref.current;
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      // 상단 바(56px) 아래로 가려지면 hidden
      io = new IntersectionObserver(([e]) => {
        if (titleState?.path === path && titleState.title === title) setTitleState({ path, title, hidden: !e.isIntersecting });
      }, { rootMargin: "-56px 0px 0px 0px" });
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      if (titleState?.path === path && titleState.title === title) setTitleState(null);
    };
  }, [path, title]);
  return <h1 ref={ref} className="text-h1 font-bold tracking-tight">{title}</h1>;
}

/** 모바일 상단 바 왼쪽: 평소엔 로고, 제목이 스크롤로 가려지면 화면 제목 */
export function MobileBarTitle() {
  const path = usePathname();
  const t = useSyncExternalStore(subscribeTitle, () => titleState, () => null);
  const show = !!t && t.path === path && t.hidden;
  // 긴 제목("고객사 출입증 정산")은 메뉴 이름("출입증 정산")으로 — 제목이 메뉴 이름으로 끝나는(수식어만 붙은) 경우에만. "내 지출 내역"처럼 메뉴 이름 그대로인 제목은 전부 보인다
  const menu = show ? menuLabelFor(path) : null;
  const title = show && menu && t!.title.length > menu.length && t!.title.endsWith(menu) ? menu : t?.title;
  return show ? (
    // 스크롤 후 제목: 글자를 조금 줄이고 제목은 줄이지 않는다(프로젝트 선택기가 줄어듦). 화면 폭의 45%를 넘는 제목만 말줄임 — 선택기에 가려지지 않게
    <span className="min-w-0 max-w-[45vw] shrink-0 truncate text-sm font-bold" title={t!.title}>{title}</span>
  ) : (
    <Link href="/" aria-label="첫 화면"><Logo sub={false} /></Link>
  );
}

/** 경로의 메뉴 이름 — 역할별 이름(labelByRole)으로 (예: 팀원의 /dashboard는 '내 지출 내역'). 메뉴에 없는 경로면 null */
export function menuLabelFor(path: string, role?: Role): string | null {
  const item = NAV.find((n) => isActive(path, n.href));
  return item ? labelOf(item, role) : null;
}

// 현재 프로젝트에서의 역할 — 레이아웃이 한 번 넣어 주면 로딩 뼈대(loading.tsx)처럼 역할을 받을 수 없는 곳도 역할별 메뉴 이름을 쓴다
const NavRoleContext = createContext<Role | undefined>(undefined);
export function NavRoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <NavRoleContext.Provider value={role}>{children}</NavRoleContext.Provider>;
}

/** 지금 경로의 메뉴 이름 (로딩 중 제목 자리) — 메뉴와 같은 역할별 이름. role을 안 주면 레이아웃의 NavRoleProvider 값 */
export function CurrentMenuLabel({ role, fallback = "" }: { role?: Role; fallback?: string }) {
  const path = usePathname();
  const ctxRole = useContext(NavRoleContext);
  return <>{menuLabelFor(path, role ?? ctxRole) ?? fallback}</>;
}

/** 메뉴 링크에 보던 달·범위(?ym·scope·part)를 붙인다 — 그 화면이 쓰는 키만 (lib/page-ctx) */
function useMenuHref() {
  const ctx = ctxOf(useSearchParams());
  return (href: string) => withCtx(href, ctx);
}

/** 역할 + 조회 전용 여부로 보이는 메뉴 (view = 상위 PM·조직장 조회). 출입증을 쓰지 않는 프로젝트는 출입증 정산 메뉴를 숨긴다 (켜기는 PM 설정) */
export function navItems(role: Role, readOnly = false, view = false, globalRole: Role = role, passEnabled = true) {
  const hidden = view ? VIEW_HIDDEN : readOnly ? READONLY_HIDDEN : [];
  // 회사 묶음(조직도·체계도 등)은 화면과 같이 회사 권한 기준
  const list = NAV.filter((n) => n.roles.includes(CROSS_PROJECT.includes(n.href) ? globalRole : role) && !hidden.includes(n.href) && (passEnabled || n.href !== "/pass"));
  // 시스템 관리자: 프로젝트 화면은 지원용 조회 — 입력·설정은 빼고 접힌 묶음으로
  if (globalRole === "ADMIN") {
    return list.filter((n) => n.href !== "/expenses/new" && n.href !== "/settings")
      .map((n) => (n.group === "work" || n.group === "budget" ? { ...n, group: "support" as const } : n));
  }
  return list;
}

type NavProps = {
  /** 현재 프로젝트에서의 역할 */
  role: Role;
  /** 회사 권한 (세션 사용자) — 프로젝트와 무관한 메뉴에 사용 */
  globalRole?: Role;
  readOnly?: boolean;
  /** 상위 PM·조직장 조회 */
  view?: boolean;
  /** 현재 프로젝트가 출입증을 쓰는지 — PM 하단 탭에 출입증을 올린다 */
  passEnabled?: boolean;
};

export function SideNav({ role, globalRole, readOnly, view, noProject, passEnabled = false }: NavProps & { noProject?: boolean }) {
  const path = usePathname();
  // 프로젝트가 없으면 프로젝트 메뉴는 모두 /no-project로 돌아가므로 회사 메뉴만
  const items = navItems(role, readOnly, view, globalRole, passEnabled).filter((n) => !noProject || CROSS_PROJECT.includes(n.href));
  const [supportOpen, toggleSupport] = useSupportOpen(items.some((n) => n.group === "support" && isActive(path, n.href)));
  const menuHref = useMenuHref();
  return (
    <nav className="flex flex-col gap-0.5 px-2.5" aria-label="주 메뉴">
      {GROUPS.map((g, gi) => {
        const list = items.filter((n) => n.group === g);
        if (!list.length) return null;
        const first = GROUPS.slice(0, gi).every((x) => !items.some((n) => n.group === x));
        return (
          <div key={g} className={first ? "" : "mt-3 border-t border-line pt-3"}>
            {g === "support"
              ? <GroupToggle label={GROUP_LABEL[g]} open={supportOpen} onToggle={toggleSupport} className="px-3.5 py-1.5" />
              : GROUP_LABEL[g] && <p className="px-3.5 pb-1 text-xs font-bold text-fg-subtle">{GROUP_LABEL[g]}</p>}
            {(g !== "support" || supportOpen) && list.map((n) => {
              const active = isActive(path, n.href);
              return (
                <Link key={n.href} href={menuHref(n.href)} aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-colors ${
                    active ? "bg-brand-50 font-bold text-primary" : "font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
                  }`}>
                  <Icon d={n.icon} />
                  {labelOf(n, role)}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/** 모바일 하단 탭 (역할별 4개 + '전체') — 업무 빈도순 */
const MOBILE_PRIMARY: Record<Role, string[]> = {
  // 팀원: 내 정산은 내 지출 내역 상단 요약으로 합쳐 둘뿐
  MEMBER: ["/expenses/new", "/dashboard"],
  // 현황 하나에 요약·내역이 모였으므로 넷째 칸은 예산
  MANAGER: ["/expenses/new", "/dashboard", "/closing", "/budget"],
  HQ: ["/projects", "/closing", "/budget", "/master"],
  ADMIN: ["/projects", "/org", "/master", "/audit"],
};
/** 출입증을 쓰는 프로젝트의 PM — 예산 대신 출입증 */
const MANAGER_PASS_PRIMARY = ["/expenses/new", "/dashboard", "/closing", "/pass"];
/** 조회 전용(상위 PM·조직장) 하단 탭 */
const VIEW_PRIMARY = ["/dashboard", "/budget"];

export function primaryHrefs(role: Role, view: boolean, passEnabled: boolean) {
  if (view) return VIEW_PRIMARY;
  if (role === "MANAGER" && passEnabled) return MANAGER_PASS_PRIMARY;
  return MOBILE_PRIMARY[role];
}

/** 하단 탭: 우선 메뉴 중 보이는 것 (최대 4개) */
function primaryItems(all: NavItem[], role: Role, view: boolean, passEnabled: boolean) {
  return primaryHrefs(role, view, passEnabled).map((h) => all.find((n) => n.href === h)).filter((n): n is NavItem => !!n).slice(0, 4);
}

/** '전체' 시트를 여는 이벤트 — 하단 탭이 숨은 화면(지출 입력)의 상단 메뉴 버튼에서 사용 */
const MENU_EVENT = "opex:menu";

/** 모바일 상단 메뉴 버튼 — 하단 탭이 숨은 화면에서만 보인다 */
export function MobileMenuButton() {
  const path = usePathname();
  if (!TABBAR_HIDDEN.some((h) => isActive(path, h))) return null;
  return (
    <button type="button" aria-label="전체 메뉴" className="-ml-1 flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted lg:hidden"
      onClick={() => window.dispatchEvent(new Event(MENU_EVENT))}>
      <Icon d="M4 6h16M4 12h16M4 18h16" className="size-5" />
    </button>
  );
}

export type MenuProfile = { name: string; sub: string; projectName: string | null; roleText: string; pmElsewhere?: boolean; href?: string | null };

/**
 * 내 이름·소속 영역 — href가 있으면 눌러서 내 계정 화면으로.
 * 프로필 카드 → 내 계정. 이미 그 화면이면 다시 눌러도 이동할 곳이 없으므로
 * '보는 중'으로 알려 주고, 메뉴 시트 안에서는 누르면 시트를 닫는다 (반응 없는 것처럼 보이지 않게)
 */
export function ProfileLink({ href, className, children, onSame }: { href: string | null; className: string; children: React.ReactNode; onSame?: () => void }) {
  const path = usePathname();
  if (!href) return <div className={className}>{children}</div>;
  const active = isActive(path, href);
  if (active) {
    const here = <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-primary">보는 중</span>;
    return onSame
      ? <button type="button" onClick={onSame} aria-current="page" aria-label="내 계정 화면을 보는 중 — 메뉴 닫기" className={`${className} bg-brand-50 text-left`}>{children}{here}</button>
      : <div aria-current="page" className={`${className} bg-brand-50`}>{children}{here}</div>;
  }
  return (
    <Link href={href} title="내 계정 보기" className={`${className} hover:bg-surface-muted`}>
      {children}
      <Icon d="m9 18 6-6-6-6" className="size-4 shrink-0 text-fg-subtle" />
    </Link>
  );
}

export function BottomNav({ role, globalRole, readOnly, view, passEnabled = false, profile, unread: initialUnread = 0 }: NavProps & { profile: MenuProfile; /** 안 읽은 알림 수 (서버 초깃값) */ unread?: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const unread = useUnread(initialUnread) ?? 0;
  const menuHref = useMenuHref();
  const all = navItems(role, readOnly, view, globalRole, passEnabled);
  const primary = primaryItems(all, role, !!view, passEnabled);
  const barHidden = TABBAR_HIDDEN.some((h) => isActive(path, h));
  // 탭바가 숨은 화면에서는 시트에 모든 메뉴를. 알림은 상단 바의 종이 입구라 격자에서 빼고 계정 줄에 "알림 N"으로
  const rest = (barHidden ? all : all.filter((n) => !primary.includes(n))).filter((n) => n.href !== "/notifications");
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onMenu = () => setOpen(true);
    window.addEventListener(MENU_EVENT, onMenu);
    return () => window.removeEventListener(MENU_EVENT, onMenu);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    // 열리면 시트로 포커스, 닫히면 '전체' 버튼으로 되돌림
    const prev = document.activeElement as HTMLElement | null;
    menuRef.current?.focus();
    return () => { window.removeEventListener("keydown", esc); if (prev && document.contains(prev)) prev.focus(); };
  }, [open]);
  const menuRef = useRef<HTMLDivElement>(null);

  const tab = (active: boolean) => `flex h-14 flex-col items-center justify-center gap-0.5 whitespace-nowrap px-0.5 text-xs leading-tight ${active ? "font-bold text-primary" : "font-medium text-fg-muted"}`;
  const pill = (active: boolean) => `flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-brand-50" : ""}`;
  const restActive = rest.some((n) => isActive(path, n.href));
  // 탭에 다 올라가 더 볼 메뉴가 없으면(팀원 등) 시트에는 프로필·계정만 — '전체'가 아니라 '내 정보'로 부른다
  const accountOnly = rest.length === 0;
  const sheetName = accountOnly ? "내 정보" : "전체 메뉴";
  const [supportOpen, toggleSupport] = useSupportOpen(rest.some((n) => n.group === "support" && isActive(path, n.href)));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={sheetName} ref={menuRef} tabIndex={-1}
            className={`absolute inset-x-0 bottom-0 max-h-[85dvh] outline-none overflow-y-auto rounded-t-2xl bg-surface px-3 pt-2 shadow-sheet ${barHidden ? "pb-[calc(1rem+env(safe-area-inset-bottom))]" : "pb-[calc(4.5rem+env(safe-area-inset-bottom))]"}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            {/* 내 프로필 · 현재 프로젝트 */}
            <div className="mb-2 flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-3">
              <ProfileLink href={profile.href ?? null} onSame={() => setOpen(false)} className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-fg-muted">{profile.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{profile.name} <span className="font-medium text-fg-muted">{profile.sub}</span></div>
                <div className="truncate text-xs text-fg-muted">
                  {profile.projectName ? <>{profile.projectName} · <b className="text-fg-2">{profile.roleText}</b></> : profile.roleText}
                </div>
              </div>
              </ProfileLink>
              <ThemeToggle />
            </div>
            {profile.pmElsewhere && (
              <p className="alert alert-info mb-2 text-sm">
                PM 메뉴는 PM을 맡은 프로젝트에서만 보입니다. 위 프로젝트 이름을 눌러 <b>PM</b> 표시가 있는 프로젝트를 고르세요.
              </p>
            )}
            {GROUPS.map((g) => {
              const list = rest.filter((n) => n.group === g);
              if (!list.length) return null;
              return (
                <section key={g} className="mt-2">
                  {g === "support"
                    ? <GroupToggle label={GROUP_LABEL[g]} open={supportOpen} onToggle={toggleSupport} className="min-h-10 px-2" />
                    : GROUP_LABEL[g] && <p className="px-2 pb-1 text-xs font-bold text-fg-subtle">{GROUP_LABEL[g]}</p>}
                  {(g !== "support" || supportOpen) && <div className="grid grid-cols-3 gap-1">
                    {list.map((n) => {
                      const active = isActive(path, n.href);
                      return (
                        <Link key={n.href} href={menuHref(n.href)} aria-current={active ? "page" : undefined}
                          className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5 text-center text-label ${active ? "bg-brand-50 font-bold text-primary" : "text-fg-2 hover:bg-surface-muted"}`}>
                          <Icon d={n.icon} className="size-5" />
                          {labelOf(n, role)}
                        </Link>
                      );
                    })}
                  </div>}
                </section>
              );
            })}
            <section className="mt-2 border-t border-line pt-2">
              <p className="px-2 pb-1 text-xs font-bold text-fg-subtle">계정</p>
              <div className="grid grid-cols-3 items-center gap-2 px-1">
                <Link href="/notifications" aria-current={isActive(path, "/notifications") ? "page" : undefined}
                  className={`btn-secondary gap-1.5 ${isActive(path, "/notifications") ? "border-primary text-primary" : ""}`}>
                  알림{unread > 0 && <span className="tabular rounded-full bg-accent px-1.5 text-xs font-bold leading-4 text-on-primary">{unread > 99 ? "99+" : unread}</span>}
                </Link>
                <Link href="/account/password" className="btn-secondary">비밀번호 변경</Link>
                <LogoutButton className="btn-secondary" />
              </div>
            </section>
          </div>
        </div>
      )}
      {!barHidden && (
        <nav aria-label="하단 메뉴" className="fixed inset-x-0 bottom-0 z-50 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden"
          style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
          {primary.map((n) => {
            const current = isActive(path, n.href);
            // 시트가 열린 동안은 '전체'만 강조 — 현재 화면 탭까지 강조하면 둘이 선택된 것처럼 보인다
            const active = current && !open;
            return (
              // 누르면 시트를 닫는다 — 이미 그 화면이면 경로가 안 바뀌어 닫히지 않으므로 (반응 없는 것처럼 보임), 그때는 맨 위로
              <Link key={n.href} href={menuHref(n.href)} className={tab(active)} aria-current={current ? "page" : undefined}
                onClick={() => { setOpen(false); if (current) window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                <span className={pill(active)}><Icon d={n.icon} className="size-5" /></span>
                {shortOf(n, role)}
              </Link>
            );
          })}
          <button type="button" onClick={() => setOpen(!open)} className={tab(open || restActive)} aria-expanded={open} aria-haspopup="dialog">
            <span className={pill(open || restActive)}><Icon d={accountOnly ? "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" : "M4 6h16M4 12h16M4 18h16"} className="size-5" /></span>
            {accountOnly ? "내 정보" : "전체"}
          </button>
        </nav>
      )}
    </>
  );
}

// ── 알림 토스트 (프로젝트 전환 등) ────────────────────────────
const TOAST_EVENT = "opex:toast";
/** 화면 아래에 잠깐 보이는 알림 — 레이아웃의 <Toaster />가 보여 준다 */
/**
 * 알림의 다음 행동 링크 (예: "다음 처리할 달 ›", "예산 등록 ›").
 * projectId가 있으면 그 프로젝트로 바꾼 뒤 이동 (OpenProjectButton과 같은 방식)
 */
export type ToastAction =
  | { label: string; href: string; projectId?: string }
  /** 링크 대신 바로 실행할 동작 (예: "되돌리기") */
  | { label: string; onClick: () => void };
/** 보여 줄 시간(ms) — 기본: 행동이 있으면 8초, 없으면 2.8초 */
export type ToastOptions = { duration?: number };
type ToastDetail = { text: string; action?: ToastAction; duration?: number };
export function toast(text: string, action?: ToastAction, opts?: ToastOptions) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { text, action, duration: opts?.duration } }));
}
export function Toaster() {
  const router = useRouter();
  const [item, setItem] = useState<ToastDetail | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      setItem(d);
      clearTimeout(t);
      // 누를 링크가 있으면 조금 더 오래 보여 준다
      t = setTimeout(() => setItem(null), d.duration ?? (d.action ? 8000 : 2800));
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => { window.removeEventListener(TOAST_EVENT, on); clearTimeout(t); };
  }, []);
  if (!item) return null;
  const a = item.action;
  const go = async () => {
    if (!a) return;
    setItem(null);
    if ("onClick" in a) { a.onClick(); return; }
    try {
      if (a.projectId) await api("/api/session/project", { method: "POST", json: { projectId: a.projectId } });
      // 프로젝트를 바꿨으면 공통 레이아웃(상단 프로젝트 선택)도 다시 그린다
      startTransition(() => {
        router.push(a.href);
        if (a.projectId) router.refresh();
      });
    } catch (e) {
      setItem({ text: (e as Error).message || "화면을 열지 못했습니다." });
    }
  };
  return (
    <div role="status" aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center max-lg:[body:has([data-bottom-bar])_&]:bottom-[calc(9rem+env(safe-area-inset-bottom))] lg:bottom-6">
      <p className="pointer-events-auto flex max-w-md flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-fg px-4 py-2.5 text-sm font-medium text-canvas shadow-sheet">
        <span>{item.text}</span>
        {a && <button type="button" onClick={go} className="min-h-9 font-bold underline underline-offset-2">{a.label}</button>}
      </p>
    </div>
  );
}

/** phaseTag: 진행 중이 아니면 "종료 대기"·"종료"·"시작 전" · roleTag: 이 프로젝트에서 내 역할 (PM·팀원·조회) */
type ProjectOption = { id: string; name: string; depth?: number; parentId?: string | null; phaseTag?: string | null; ended?: boolean; roleTag?: string | null };

/** 상단 프로젝트 선택 — 검색 가능한 트리형 팝오버(PC) / 하단 시트(모바일) */
export function ProjectSelect({ projects, current }: { projects: ProjectOption[]; current?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const busy = posting || refreshing;
  const boxRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const cur = projects.find((p) => p.id === current) ?? projects[0];
  // 좁은 화면은 하단 시트, 넓은 화면은 팝오버
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node) && !sheetRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    // 모바일 시트: 키보드가 뜨지 않게 입력칸 대신 시트에 포커스, 닫으면 버튼으로 되돌림
    const prev = document.activeElement as HTMLElement | null;
    if (mobile) sheetRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc);
      if (mobile && prev && document.contains(prev)) prev.focus();
    };
  }, [open, mobile]);

  if (!cur) return null;
  const nodes: TreeNode[] = projects.map((p) => ({
    id: p.id,
    parentId: p.parentId ?? null,
    label: p.name,
    icon: p.parentId ? "subproject" : "project",
    tag: [p.roleTag, p.phaseTag].filter(Boolean).join(" · ") || null,
    muted: !!p.ended,
  }));
  const single = projects.length <= 1;

  const panel = (
    <>
      <div className="relative mb-1">
        <SvgIcon name="find" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <input autoFocus={!mobile} className="input pl-9" placeholder="프로젝트 검색" aria-label="프로젝트 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[55dvh] overflow-y-auto sm:max-h-80">
        <TreeView nodes={nodes} selectedId={cur.id} query={q} toolbar={false} defaultDepth={9}
          onSelect={async (n) => {
            setOpen(false);
            setQ("");
            if (n.id === cur.id) return;
            setPosting(true);
            setError(null);
            try {
              await api("/api/session/project", { method: "POST", json: { projectId: n.id } });
              const next = projects.find((p) => p.id === n.id);
              startTransition(() => router.refresh());
              toast(`‘${n.label}’ 프로젝트로 바꿨습니다${next?.roleTag ? ` · 내 역할 ${next.roleTag}` : ""}`);
            } catch (e) {
              setError((e as Error).message || "프로젝트를 바꾸지 못했습니다.");
            } finally {
              setPosting(false);
            }
          }} />
      </div>
      <p className="hidden border-t border-line px-2 pt-2 text-xs text-fg-muted sm:block">↑↓ 이동 · Enter 선택 · Esc 닫기{projects.some((p) => p.roleTag) ? " · 배지는 이 프로젝트에서 내 역할" : ""}</p>
    </>
  );

  return (
    <div ref={boxRef} className="relative min-w-0">
      <button type="button" disabled={single || busy} onClick={() => { setError(null); setOpen(!open); }} aria-haspopup="tree" aria-expanded={open}
        aria-label={`현재 프로젝트 ${cur.name}${cur.roleTag ? ` (${cur.roleTag})` : ""}${single ? "" : " — 바꾸기"}`}
        className={`flex min-h-10 max-w-52 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition sm:min-h-9 sm:max-w-80 ${
          open ? "border-primary bg-brand-50" : "border-line bg-surface hover:border-line-strong"
        } disabled:cursor-default disabled:hover:border-line`}>
        <NodeIcon icon={cur.parentId ? "subproject" : "project"} />
        <span className="truncate">{cur.name}</span>
        {cur.roleTag && <span className={`badge shrink-0 ${cur.roleTag === "조회" ? "badge-neutral" : "badge-primary"}`}>{cur.roleTag}</span>}
        {cur.phaseTag && <span className="badge badge-neutral hidden shrink-0 sm:inline-flex">{cur.phaseTag}</span>}
        {busy ? (
          <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-primary" aria-label="바꾸는 중" />
        ) : !single && (
          <SvgIcon name="chevronDown" className={`size-3.5 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {error && (
        <p role="alert" className="absolute left-0 top-full z-30 mt-1 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-status-rejected shadow-pop"
          onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {open && !mobile && <div className="absolute left-0 top-full z-40 mt-2 w-96 rounded-2xl border border-line bg-surface p-2 shadow-pop">{panel}</div>}
      {open && mobile && createPortal(
        // 모바일: 하단 시트 — 상단 바(sticky)의 쌓임 맥락 밖(body)에 그려 하단 탭 위로 올린다
        <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="프로젝트 바꾸기" ref={sheetRef} tabIndex={-1}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl outline-none bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-sheet"
            onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            <p className="px-1 pb-2 text-base font-bold">프로젝트 바꾸기</p>
            {panel}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function LogoutButton({ className }: { className?: string }) {
  return (
    <button className={className ?? "btn-ghost px-2 py-1 text-xs"}
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}>
      로그아웃
    </button>
  );
}

/** 이전 화면으로 (기록이 없으면 첫 화면) — 오류·404 화면용 */
export function BackButton({ className = "btn-secondary" }: { className?: string }) {
  const router = useRouter();
  return (
    <button type="button" className={className}
      onClick={() => { if (window.history.length > 1) router.back(); else router.push("/"); }}>
      이전 화면
    </button>
  );
}

/** 오늘 날짜 "2026.10.09.(금)" */
export function Today() {
  const [s, setS] = useState("");
  useEffect(() => {
    const d = new Date();
    setS(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}.(${"일월화수목금토"[d.getDay()]})`);
  }, []);
  return <span className="tabular text-sm text-fg-muted">{s}</span>;
}

/** 라이트/다크 테마 전환 (localStorage 저장) */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button type="button" aria-label={dark ? "라이트 모드로" : "다크 모드로"} title={dark ? "라이트 모드" : "다크 모드"}
      className="flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg sm:size-9"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("theme", next ? "dark" : "light");
        } catch {}
        setDark(next);
      }}>
      {dark ? (
        <Icon d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      ) : (
        <Icon d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      )}
    </button>
  );
}
