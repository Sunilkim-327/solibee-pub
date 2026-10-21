"use client";

import { useEffect } from "react";

/**
 * 같은 화면에서 검색값만 바꾸는 이동(월·구분·범위 전환)이 끝나지 않을 때의 안전장치.
 * 배포 빌드에서 Next 라우터가 같은 경로 이동을 반영하지 못하고 멈추는 경우가 있어(서버 응답은 정상),
 * 정해진 시간 안에 주소가 바뀌지 않으면 그 주소를 새로 불러온다.
 */
const WAIT_MS = 1500;
let latest = 0;

const here = () => location.pathname + location.search;

/** router.push 직후 호출 — 이동이 반영되지 않으면 전체 새로 불러오기 */
export function watchSoftNav(href: string) {
  const url = new URL(href, location.href);
  const target = url.pathname + url.search;
  const from = here();
  if (url.origin !== location.origin || target === from) return;
  const id = ++latest;
  setTimeout(() => {
    // 그사이 다른 이동을 눌렀거나 이미 주소가 바뀌었으면 그대로 둔다
    if (id === latest && here() === from) location.assign(url.href);
  }, WAIT_MS);
}

/** 같은 경로·다른 검색값으로 가는 링크 누름을 지켜본다 (레이아웃에 한 번) */
export function NavWatchdog() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname) watchSoftNav(url.href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
