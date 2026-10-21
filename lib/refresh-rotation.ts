// 리프레시 토큰 회전·재사용 탐지 — 순수함수 (저장은 lib/refresh-store.ts)
//
// 리프레시 토큰은 쓸 때마다 새 토큰으로 바뀐다(회전). 옛 토큰이 다시 오면 둘 중 하나다:
//  - 같은 브라우저의 다른 탭이 거의 동시에 재발급을 요청함 (정상) → 사용된 지 얼마 안 됐으면 유예로 허용
//  - 회전 응답의 새 쿠키가 브라우저에 저장되지 못함 (탭 닫힘·중단된 요청·프리페치) → 뒤에 나온 토큰을 아무도 쓴 적이 없으면 잃어버린 것으로 보고 다시 발급
//  - 복사된 토큰을 정상 사용자와 공격자가 번갈아 씀 (탈취) → 뒤에 나온 토큰이 이미 쓰였는데 옛 토큰이 또 오면 그 사용자의 세션을 전부 끊는다
// 한 번 로그인한 묶음을 계열(family)이라 하고, 다른 기기 로그인은 다른 계열이라 서로 끊지 않는다.
// (2026-10-15: 유예 30초만으로 판단하니 새 쿠키를 못 받은 정상 사용자가 1시간 뒤 "재사용"으로 전부 로그아웃되는 일이 하루 3건 — 후속 토큰 사용 여부를 함께 본다)

/** 사용된 토큰을 다시 받아 주는 유예 — 여러 탭의 동시 재발급 (SessionKeeper·API 401 재시도가 겹치는 경우) */
export const REFRESH_GRACE_MS = 30_000;

export type RefreshRow = { userId: string; family: string; usedAt: Date | null; exp: Date };

export type RotationDecision = "rotate" | "grace" | "reuse" | "reject";

/**
 * 토큰 기록(row)과 토큰의 사용자(uid)로 판단.
 * rotate: 처음 쓰는 토큰 → 사용 처리하고 새 토큰 / grace: 방금 사용된 토큰, 또는 뒤에 나온 토큰을 아무도 안 쓴 토큰 → 새 토큰만 /
 * reuse: 옛 토큰 재사용(뒤 토큰이 이미 쓰임) → 전부 로그아웃 / reject: 모르는·만료된·남의 토큰
 * successorUsed: 이 토큰이 사용된 뒤 같은 계열에서 발급된 토큰 중 하나라도 쓰였는지 (유예가 지난 경우에만 본다. 모르면 undefined = 예전처럼 reuse)
 */
export function rotationDecision(row: RefreshRow | null, uid: string, now: number, successorUsed?: boolean): RotationDecision {
  if (!row || row.userId !== uid) return "reject";
  if (row.exp.getTime() <= now) return "reject";
  if (!row.usedAt) return "rotate";
  if (now - row.usedAt.getTime() <= REFRESH_GRACE_MS) return "grace";
  return successorUsed === false ? "grace" : "reuse";
}
