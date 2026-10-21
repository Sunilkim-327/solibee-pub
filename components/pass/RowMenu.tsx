"use client";

import { Menu, type MenuItem } from "@/components/Menu";

export type MenuAction = Pick<MenuItem, "label" | "onSelect" | "danger" | "disabled">;

/** 행·열 끝의 ⋯ 메뉴 (이름 바꾸기·순서·삭제 등) — 공통 Menu의 ⋯ 버튼 모양 */
export function RowMenu({ label, actions, align = "right" }: { label: string; actions: MenuAction[]; align?: "left" | "right" }) {
  return (
    <Menu label={label} items={actions.map((a) => ({ ...a, key: String(a.label) }))} align={align} minWidth={144}
      triggerClassName="flex size-11 shrink-0 items-center justify-center rounded-md text-lg leading-none text-fg-muted hover:bg-surface-muted hover:text-fg sm:size-8">
      ⋯
    </Menu>
  );
}
