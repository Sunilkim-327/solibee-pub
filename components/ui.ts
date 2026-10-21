// 공용 UI 클래스 헬퍼 (서버·클라이언트 공용, 순수 문자열)

/** 선택형 칩 버튼 클래스 — on: 선택됨. 높이 40(모바일) / 32(PC, 업무형 밀도), 모서리 full */
export const chip = (on: boolean) =>
  `inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition sm:min-h-8 sm:px-3 sm:py-0.5 sm:text-label ${
    on ? "border-primary bg-primary font-semibold text-on-primary" : "border-line-strong bg-surface text-fg-2 hover:border-primary/60"
  }`;

/** 출입증 날짜 소제목 아래 하루 한도 초과 배지 — 좁은 화면은 줄바꿈(왼쪽 정렬), PC는 한 줄 가운데. 팀원·PM 화면 공통 */
export const limitBadge = "badge badge-warn h-auto min-h-5 w-full justify-start whitespace-normal py-0.5 text-left sm:justify-center sm:py-0 sm:text-center";
