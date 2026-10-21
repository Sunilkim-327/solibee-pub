// 변경계약 과업으로 연장된 본계약 종료일 되돌리기 — 순수함수

type ChangeEnd = { id: string; endDate: Date; extendedFrom: Date | null };

/**
 * 본계약 원 종료일 — Project.endDate는 변경계약 연장으로 덮어쓰이므로, 원 종료일은 연장한 과업들의
 * ContractChange.extendedFrom 중 가장 이른 날에 보존된다. 연장 이력이 없으면 지금 종료일이 원 종료일.
 */
export function originalEndDate(current: Date, changes: { extendedFrom: Date | null }[]): Date {
  const origins = changes.filter((c) => c.extendedFrom).map((c) => c.extendedFrom!.getTime());
  return origins.length ? new Date(Math.min(...origins)) : current;
}

/**
 * 과업 삭제·종료일 단축 후의 본계약 종료일.
 * - 원래 종료일 = 연장한 과업들의 extendedFrom 중 가장 이른 날 (처음 연장하기 전 종료일)
 * - 새 종료일 = max(원래 종료일, 남은 과업 종료일, keepUntil(이미 입력된 지출 등 기간 안에 둬야 할 날))
 * - 현재 종료일보다 늘리지는 않는다. 바뀌지 않으면 null.
 * @param before 변경 전 과업 전체 (삭제·수정 대상 포함)
 * @param after 변경 후 과업 전체 (삭제면 빠짐, 수정이면 새 종료일)
 */
export function restoredEndDate(current: Date, before: ChangeEnd[], after: { endDate: Date }[], keepUntil: (Date | null)[] = []): Date | null {
  if (!before.some((c) => c.extendedFrom)) return null;
  const original = originalEndDate(current, before).getTime();
  const next = Math.max(original, ...after.map((c) => c.endDate.getTime()), ...keepUntil.filter((d): d is Date => !!d).map((d) => d.getTime()));
  if (next >= current.getTime()) return null;
  return new Date(next);
}
