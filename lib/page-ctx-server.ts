// 서버 컴포넌트용: 마지막 본 달 쿠키 읽기 (쓰기는 클라이언트 MonthNav)
import { cookies } from "next/headers";
import { LAST_YM_COOKIE, requestedYm } from "./page-ctx";

/** 월 화면이 열 달 — ?ym= → 쿠키 → 없음 (프로젝트 기간 밖은 무시). resolveYm 등 기본값 계산에 넘긴다 */
export async function wantedYm(param: string | string[] | undefined, months: readonly string[]): Promise<string | undefined> {
  let cookie: string | undefined;
  try {
    cookie = (await cookies()).get(LAST_YM_COOKIE)?.value;
  } catch {
    cookie = undefined;
  }
  return requestedYm(param, cookie, months);
}
