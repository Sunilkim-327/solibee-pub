// 서브 프로젝트 '메인과 함께 상신' — 순수함수
// 서브(대응) 팀원은 자기 프로젝트에서 입력하고, 마감·상신은 메인(운영) PM이 메인과 함께 한다.
// - 메인의 월 마감(CLOSED 이상)이 서브의 같은 달 지출도 잠근다 (서브 단독 마감·상신은 막는다)
// - 메인 PM의 현황·마감·상신 엑셀에 서브 지출·예산·정산이 함께 들어간다
// - 상신 엑셀 항목 이름은 "구분명_항목"(예: 운영_야근식대 / 대응_야근식대) — 원본 '프로젝트 운영비' 시트 SUMIF 조건과 같은 글자
// 연속 사업(연차)이면 서브가 연결된 연차가 아니어도 그 달이 속한 연차의 메인과 함께 상신한다 (lifecycle.rollupChildren과 같은 기준).
import { projectMonths } from "./format";

export type SettleNode = {
  id: string; name: string; parentId: string | null; seriesId: string | null; startDate: Date; endDate: Date;
  settleWithParent: boolean; excelPrefix: string | null;
};

/** 메인과 함께 상신하는 서브 프로젝트인지 */
export const isSettleChild = (p: { parentId: string | null; settleWithParent: boolean }) => !!p.parentId && p.settleWithParent;

const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const overlaps = (a: { startDate: Date; endDate: Date }, b: { startDate: Date; endDate: Date }) =>
  dayOf(a.startDate) <= dayOf(b.endDate) && dayOf(b.startDate) <= dayOf(a.endDate);

/** 같은 연속 사업의 연차들 (연차가 아니면 자기 자신만) */
function seriesOf(nodes: SettleNode[], id: string): string[] {
  const self = nodes.find((n) => n.id === id);
  if (!self) return [];
  return self.seriesId ? nodes.filter((n) => n.seriesId === self.seriesId).map((n) => n.id) : [id];
}

/**
 * 서브의 메인 후보 (상위 프로젝트 + 같은 연속 사업의 다른 연차) — 그 달의 마감 행은 그 달이 기간에 든 연차에만 있다.
 * 함께 상신하는 서브가 아니면 빈 목록. 상위가 다시 함께 상신하는 서브면(재무 승인 화면에서 막는 구성) 무시
 */
export function settleParentIds(nodes: SettleNode[], childId: string): string[] {
  const child = nodes.find((n) => n.id === childId);
  if (!child || !isSettleChild(child)) return [];
  const parent = nodes.find((n) => n.id === child.parentId);
  if (!parent || isSettleChild(parent)) return [];
  return seriesOf(nodes, child.parentId!);
}

/** 서브의 그 달 메인 (그 달이 기간에 든 연차, 없으면 직접 상위) */
export function settleParentFor(nodes: SettleNode[], childId: string, ym: string): SettleNode | null {
  const ids = settleParentIds(nodes, childId);
  if (!ids.length) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hit = ids.map((id) => byId.get(id)!).find((p) => projectMonths(p.startDate, p.endDate).includes(ym));
  const child = byId.get(childId)!;
  return hit ?? byId.get(child.parentId!) ?? null;
}

/**
 * 메인과 함께 상신하는 서브 프로젝트 (직접 하위만 — 손자 프로젝트는 따로).
 * 연속 사업이면 다른 연차에 연결된 서브도 기간이 겹치면 포함 (그 연차 기간에 든 달만 이 연차와 함께 상신).
 * 순서: 시작일 → 이름
 */
export function settleChildIds(nodes: SettleNode[], mainId: string): string[] {
  const main = nodes.find((n) => n.id === mainId);
  // 함께 상신하는 서브 아래에는 다시 함께 상신하지 않는다 (한 단계만)
  if (!main || isSettleChild(main)) return [];
  const rounds = new Set(seriesOf(nodes, mainId));
  return nodes
    .filter((n) => n.id !== mainId && isSettleChild(n) && rounds.has(n.parentId!) && (n.parentId === mainId || overlaps(n, main)))
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || a.name.localeCompare(b.name, "ko"))
    .map((n) => n.id);
}

/**
 * 서브의 실제 마감 상태 행 = 그 달 메인의 마감 행 (있으면) + 서브 자신의 행 (메인 행이 없는 달 — 함께 상신 설정 전 기록).
 * 메인 행이 서브 행보다 우선한다 (메인이 마감·상신·승인하면 서브도 같은 상태)
 */
export function mergeSettleClosings<T extends { yearMonth: string }>(own: T[], parents: T[]): T[] {
  const out = new Map<string, T>();
  for (const r of own) out.set(r.yearMonth, r);
  for (const r of parents) out.set(r.yearMonth, r);
  return [...out.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

/** 화면·필터에 쓰는 구분 이름 (엑셀 구분명, 없으면 프로젝트 이름) */
export const partLabel = (p: { name: string; excelPrefix: string | null }) => p.excelPrefix?.trim() || p.name;

/** 상신 엑셀 항목 이름: "구분명_항목" (구분명이 없으면 항목 이름 그대로 — 기존 양식과 같다) */
export const excelItemName = (prefix: string | null | undefined, name: string) => (prefix?.trim() ? `${prefix.trim()}_${name}` : name);

/** 엑셀 구분명 상한 */
export const EXCEL_PREFIX_MAX = 20;

/**
 * 엑셀 구분명 검사 → 문제 메시지 (없으면 null). SUMIF 조건이 그대로 맞도록 와일드카드(* ? ~)·따옴표·밑줄·앞머리 비교 연산자 금지
 */
export function excelPrefixProblem(s: string): string | null {
  if (s.length > EXCEL_PREFIX_MAX) return `엑셀 구분명은 ${EXCEL_PREFIX_MAX}자 이내로 입력하세요.`;
  if (/[*?~"'_]/.test(s)) return "엑셀 구분명에는 * ? ~ 따옴표 _ 를 쓸 수 없습니다. (예: 운영, 대응)";
  if (/^[<>=]/.test(s)) return "엑셀 구분명은 < > = 로 시작할 수 없습니다.";
  return null;
}

/** 서브 프로젝트 마감·상신 안내 문구 */
export const settleWithParentMessage = (parentName: string) =>
  `${parentName}과(와) 함께 상신하는 프로젝트입니다. 마감·상신은 ${parentName} PM이 합니다.`;

/**
 * 메인 항목 가져오기 계획 (순수함수) — 서브에 없는 메인 항목을 같은 코드로 복사하고, 코드가 없는 항목에는 코드를 정한다.
 * 짝짓기: 코드가 같으면 같은 항목 / 코드가 없으면 같은 분류·같은 이름
 * @returns setMainCode: 코드가 없던 메인 항목에 줄 코드 · setChildCode: 코드가 없던 서브 항목(같은 분류·이름)에 줄 코드 · create: 서브에 새로 만들 메인 항목
 */
export function planImportItems<I extends { id: string; code: string | null; categoryId: string; name: string; active: boolean }>(
  main: I[], child: I[], suggest: (categoryId: string, used: string[]) => string,
) {
  const used = [...main, ...child].map((i) => i.code ?? "").filter(Boolean);
  const setMainCode = new Map<string, string>();
  const codeOf = (it: I) => it.code ?? setMainCode.get(it.id) ?? null;
  for (const it of main) {
    if (it.code) continue;
    const code = suggest(it.categoryId, used);
    used.push(code);
    setMainCode.set(it.id, code);
  }
  const childCodes = new Set(child.map((c) => c.code?.toLowerCase()).filter(Boolean));
  const setChildCode = new Map<string, string>();
  const create: (I & { code: string })[] = [];
  for (const it of main) {
    if (!it.active) continue;
    const code = codeOf(it)!;
    if (childCodes.has(code.toLowerCase())) continue;
    const sameName = child.find((c) => !c.code && !setChildCode.has(c.id) && c.categoryId === it.categoryId && c.name === it.name);
    if (sameName) { setChildCode.set(sameName.id, code); continue; }
    // 이름이 같은 항목이 이미 있으면(코드가 다름) 건너뛴다 — 프로젝트 안 항목 이름은 겹치지 않는다
    if (child.some((c) => c.name === it.name)) continue;
    create.push({ ...it, code });
  }
  return { setMainCode, setChildCode, create };
}
