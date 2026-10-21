// 로그인 아이디 — 회사 이메일 주소 전체를 아이디로 사용 (메일 서비스는 별도)

/** "Hong.GD@Company.com " → "hong.gd@company.com" */
export function toLoginId(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

export function loginIdProblem(id: string): string | null {
  if (!id) return "아이디(이메일)를 입력하세요.";
  if (id.length > 100 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(id)) return `아이디는 이메일 주소 형식이어야 합니다: ${id}`;
  return null;
}
