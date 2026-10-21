// API 오류 (라우트 래퍼가 JSON 응답으로 바꾼다) — 서버 모듈 의존 없음 (순수 검증 함수·테스트에서 사용)
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
