import { notFound } from "next/navigation";

/** 로그인한 사용자가 없는 주소로 오면 메뉴·상단 바를 유지한 채 안내 (대시보드 not-found) */
export default function Missing() {
  notFound();
}
