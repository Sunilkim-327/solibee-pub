"use client";

import { SkeletonPage } from "@/components/common";
import { CurrentMenuLabel } from "@/components/Nav";

/** 화면 전환 중 뼈대 — 제목 자리에는 메뉴 이름을 바로 보여 준다 (경로별 뼈대가 없는 화면 공통). 역할별 이름은 레이아웃의 NavRoleProvider에서 */
export default function Loading() {
  return <SkeletonPage title={<CurrentMenuLabel />} kind="dashboard" />;
}
