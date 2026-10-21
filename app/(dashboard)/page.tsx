import { redirect } from "next/navigation";
import { homePath, requireUser } from "@/lib/access";

/**
 * 첫 화면 — 현재 프로젝트에서의 역할 기준 (전역 권한이 PM이어도 이 프로젝트에서 팀원이면 입력 화면).
 * 재무 승인·시스템 관리자는 프로젝트가 없어도 전체 프로젝트부터, 팀원이라도 조회 전용·종료된 프로젝트면 현황부터 (lib/page-access homeFor)
 */
export default async function Home() {
  redirect(await homePath(await requireUser()));
}
