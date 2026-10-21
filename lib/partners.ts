// 협력 인력 (우리 회사 인력은 아니지만 프로젝트를 함께 하는 사람) — 순수함수

export type PartnerInput = { id?: string; name: string; company?: string | null; active?: boolean };
export type Partner = { id?: string; name: string; company: string | null; active: boolean };

const PARTNER_MAX = 200;
export const PARTNER_TEXT_MAX = { name: 30, company: 40 } as const;

/** 참석자 칩·기록 표기: "홍길동(○○테크)" — 소속이 없으면 이름만 */
export const partnerLabel = (p: { name: string; company: string | null }) => (p.company ? `${p.name}(${p.company})` : p.name);

/**
 * 명단 검사·정리. 참석자는 쉼표로 구분해 저장하므로 쉼표는 쓸 수 없다. 같은 표기는 한 번만.
 * @returns 정리된 명단 또는 오류 문구
 */
export function cleanPartners(input: unknown): { list: Partner[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "협력 인력 목록이 필요합니다." };
  if (input.length > PARTNER_MAX) return { error: `협력 인력은 ${PARTNER_MAX}명까지 등록할 수 있습니다.` };
  const list: Partner[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of input.entries()) {
    const x = raw as Partial<PartnerInput> | null;
    if (!x || typeof x.name !== "string") return { error: `${i + 1}번째: 이름을 입력하세요.` };
    if (x.company != null && typeof x.company !== "string") return { error: `${i + 1}번째: 소속 값이 올바르지 않습니다.` };
    const name = x.name.trim();
    const company = (x.company ?? "").trim() || null;
    if (!name) return { error: `${i + 1}번째: 이름을 입력하세요.` };
    if (name.length > PARTNER_TEXT_MAX.name) return { error: `${name}: 이름은 ${PARTNER_TEXT_MAX.name}자 이내로 입력하세요.` };
    if (company && company.length > PARTNER_TEXT_MAX.company) return { error: `${name}: 소속은 ${PARTNER_TEXT_MAX.company}자 이내로 입력하세요.` };
    if (/[,()]/.test(name) || (company && /[,()]/.test(company))) return { error: `${name}: 이름·소속에는 쉼표나 괄호를 쓸 수 없습니다.` };
    const label = partnerLabel({ name, company });
    if (seen.has(label)) return { error: `${label}: 이미 등록된 협력 인력입니다.` };
    seen.add(label);
    list.push({ ...(typeof x.id === "string" && x.id ? { id: x.id } : {}), name, company, active: x.active !== false });
  }
  return { list };
}

/** 참석자 문자열(쉼표 구분)을 이름 목록으로 — 저장 형식은 ExpenseForm·lib/expenses와 같다 */
export const attendeeNames = (s: string | null | undefined) => (s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);

/**
 * 지출 참석자 기록에 등장하는 협력 인력 — 참석자는 이름 문자열로만 저장돼 FK가 없다.
 * 저장된 표기(이름(소속))나 이름만으로 등장해도 '기록 있음'으로 본다 (삭제 대신 '참석자에 표시'만 끈다).
 */
export function referencedPartners<P extends { name: string; company: string | null }>(partners: P[], attendees: (string | null | undefined)[]): P[] {
  if (!partners.length) return [];
  const seen = new Set<string>();
  for (const a of attendees) for (const n of attendeeNames(a)) seen.add(n);
  return partners.filter((p) => seen.has(partnerLabel(p)) || seen.has(p.name));
}
