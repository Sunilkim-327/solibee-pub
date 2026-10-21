"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { NOTICE_KEY, redirectNoticeText } from "@/lib/page-access";
import type { Role } from "@/lib/types";
import { menuLabelFor, toast } from "./Nav";

/**
 * 권한 없음·조회 전용으로 다른 화면에 보내졌을 때(?notice=…) 토스트 한 번 — 도착 화면의 메뉴 이름으로 어디로 왔는지 알리고,
 * 새로 고침해도 다시 뜨지 않게 주소에서 notice를 지운다 (레이아웃에 한 번, Toaster 뒤에)
 */
export function RedirectNotice({ role }: { role: Role }) {
  const path = usePathname();
  const params = useSearchParams();
  const code = params.get(NOTICE_KEY);
  useEffect(() => {
    if (!code) return;
    const text = redirectNoticeText(code, menuLabelFor(path, role));
    if (text) toast(text);
    const q = new URLSearchParams(window.location.search);
    q.delete(NOTICE_KEY);
    window.history.replaceState(window.history.state, "", `${path}${q.size ? `?${q}` : ""}${window.location.hash}`);
  }, [code, path, role]);
  return null;
}
