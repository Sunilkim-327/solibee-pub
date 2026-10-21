// 미입력·소명 독촉 문구 (순수함수) — PM이 메신저에 붙이거나 메일로 보낼 글을 만든다.
// 자동 발송은 하지 않는다 (무료 요금제에서 전 직원 메일 발송 불가, 사내 메신저가 따로 있음)

export type RemindKind = "noinput" | "unexplained";

export type RemindPerson = { id: string; name: string; email: string | null; count?: number };

export type RemindGroup = { kind: RemindKind; people: RemindPerson[] };

export const REMIND_LABEL: Record<RemindKind, string> = { noinput: "미입력", unexplained: "소명 필요" };

const monthOf = (ym: string) => `${Number(ym.slice(5))}월`;

/** 받는 사람 이름 줄: "김하늘·이서준님" (순서는 받은 그대로 — 직급 → 성명) */
export function namesLine(people: RemindPerson[]): string {
  return people.length ? `${people.map((p) => p.name).join("·")}님` : "";
}

/** 메일 제목 */
export function remindSubject(kind: RemindKind, ym: string, projectName: string): string {
  return kind === "noinput"
    ? `[운영비] ${projectName} ${monthOf(ym)} 지출 입력 요청`
    : `[운영비] ${projectName} ${monthOf(ym)} 규정 점검 소명 요청`;
}

/**
 * 본문 — 메신저에 그대로 붙여도 읽히게 (인사 → 할 일 → 방법 → 링크)
 * @param origin 사이트 주소 (예: https://app.example.com) — 링크를 눌러 바로 그 화면으로
 */
export function remindBody(kind: RemindKind, opts: { ym: string; projectName: string; people: RemindPerson[]; origin: string }): string {
  const { ym, projectName, people, origin } = opts;
  const m = monthOf(ym);
  if (kind === "noinput") {
    return [
      `${namesLine(people)}, ${projectName} ${m} 운영비 지출이 아직 입력되지 않았어요.`,
      `PM 마감 전까지 개인 법인카드 사용분을 입력해 주세요. ${m}에 사용한 건이 없으면 회신 부탁드려요.`,
      `입력하기: ${origin}/expenses/new`,
    ].join("\n");
  }
  const lines = people.map((p) => `- ${p.name} ${p.count ?? 0}건`);
  return [
    `${namesLine(people)}, ${projectName} ${m} 지출 중 규정 점검에 걸린 건에 소명이 필요해요.`,
    ...lines,
    // 소명 없음은 마감을 막지 않는다 (마감 준비 체크리스트는 안내용) — "있어야 마감할 수 있다"고 쓰지 않는다
    `지출 내역에서 해당 건을 눌러 '소명 사유'를 적어 주세요. PM 마감 전까지 부탁드려요.`,
    `소명하기: ${origin}/dashboard?ym=${ym}&check=unexplained`,
  ].join("\n");
}

/** mailto 링크 — 받는 사람은 숨은 참조(bcc)로 (서로의 주소가 보이지 않게). 주소가 없는 사람은 빠진다 */
export function remindMailto(kind: RemindKind, opts: { ym: string; projectName: string; people: RemindPerson[]; origin: string }): string | null {
  const to = opts.people.map((p) => p.email).filter((e): e is string => !!e);
  if (!to.length) return null;
  const q = new URLSearchParams({ bcc: to.join(","), subject: remindSubject(kind, opts.ym, opts.projectName), body: remindBody(kind, opts) });
  // URLSearchParams는 공백을 +로 바꾸는데 메일 앱은 +를 그대로 보여 준다
  return `mailto:?${q.toString().replace(/\+/g, "%20")}`;
}
