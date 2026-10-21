import { NextResponse } from "next/server";
import { apiUser, route } from "@/lib/access";
import { loadCategoriesEnsured, loadDepartments, loadMasterProjects, loadPeople } from "@/app/(dashboard)/master/data";

/** 프로젝트 체계도의 '프로젝트 만들기' 양식 데이터 (재무 승인·시스템 관리자) — 양식을 열 때만 불러온다 */
export const GET = route(async () => {
  await apiUser(["HQ", "ADMIN"]);
  const [projects, users, depts, categories] = await Promise.all([loadMasterProjects(), loadPeople(), loadDepartments(), loadCategoriesEnsured()]);
  return NextResponse.json({ projects, users, depts, categories });
});
