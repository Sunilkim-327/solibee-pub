// 야근 기록 연동 지점 — 지금은 PM이 직접 확인하고, 추후 Soliday 야근(초과근무) 기록으로 자동 인정한다.
// 연동 방법은 docs/INTEGRATION.md "업체 출입증 — Soliday 야근 기록 연동" 참고.
// 회사 부담 인정 기준: 야근 신청 승인 + 퇴근 시각이 일과 종료 후 1시간 30분 이상 (그 외는 기본 본인 부담, 팀원 수동 요청 → PM 결정)

/** 야근 기록 출처: 팀원별 야근한 날짜("YYYY-MM-DD") 집합 */
export interface OvertimeSource {
  name: string;
  /** userIds의 from~to(포함) 기간 야근일 → Map<userId, Set<"YYYY-MM-DD">> */
  overtimeDates(userIds: string[], from: Date, to: Date): Promise<Map<string, Set<string>>>;
}

/** 기본값: 연동 전이라 야근 기록 없음 (자동 인정 없음) */
export const noOvertimeSource: OvertimeSource = {
  name: "none",
  async overtimeDates() {
    return new Map();
  },
};

/** 현재 사용하는 야근 기록 출처 — Soliday 연동 시 여기서 구현체를 돌려준다 */
export function getOvertimeSource(): OvertimeSource {
  return noOvertimeSource;
}

export type AutoDecideLine = { date: string | null; userId: string | null; decision: string | null };

/**
 * 야근 기록이 있는 날의 미결정 줄을 '야근 인정'(출처 SOLIDAY)으로. 이미 결정된 줄(PM 수동 결정 포함)은 건드리지 않는다.
 * 반환: 바뀐 줄 (입력 순서 유지, 원본 불변)
 */
export function autoDecide<T extends AutoDecideLine>(lines: T[], overtime: Map<string, Set<string>>): { lines: (T & { decision: string | null; decisionSource?: string | null })[]; changed: number } {
  let changed = 0;
  const out = lines.map((l) => {
    // 날짜 열이 없는 양식이면 대조할 수 없음
    if (l.decision || !l.userId || !l.date || !overtime.get(l.userId)?.has(l.date)) return l;
    changed++;
    return { ...l, decision: "OVERTIME", decisionSource: "SOLIDAY" };
  });
  return { lines: out, changed };
}
