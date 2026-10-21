# 디자인 시스템 (opex-app)

모든 화면 작업의 기준 문서. 값의 원본은 `app/globals.css`이며, 이 문서와 다르면 globals.css가 우선이다(바꾸면 이 문서도 같이 고친다).

**방향: 표 중심의 차분한 업무 화면.** 핵심은 "배정 예산을 규정대로 쓰고 정산"하는 것. PC는 Linear·Vercel형(시안 B, `design-review/mockups/B-linear/`) 밀도, 색은 네이비 브랜드 1색 + 거의 흰/거의 검정 중립. 모바일은 터치 44px·큰 금액 입력을 그대로 유지한다.

## 0. 업무형 밀도 원칙 (PC = `sm` 이상)

1. 화면의 주인공은 **표와 숫자**. 장식(그림자·큰 모서리·색 면)은 최소로, 구분은 1px 선으로 한다.
2. 카드 = 1px `line` 테두리 + 그림자 거의 없음(라이트 `0 1px 2px /4%`, 다크 없음) + 모서리 8px.
3. 카드 머리(`.card-head`) 44px + 아래 1px 선, 제목 14px 600. 섹션 간격 16px(`space-y-4`/`gap-4`), 카드 안쪽 16px.
4. 표: 머리 36px(12px, `fg-muted`, `surface-muted` 면) · 행 40px · 숫자 tabular·오른쪽 정렬.
5. 컨트롤 한 줄 = 32px: 버튼·입력·seg·칩 모두 32. `btn-sm` 28, 주요 CTA `btn-lg` 40.
6. 배지는 연하게(`*-50` 면 + `*-700` 글자, 600). 강한 색 면은 "할 일·경고" 한두 곳만.
7. 캔버스와 surface 대비는 낮게(라이트 `#fafafa`/`#fff`, 다크 `#0a0a0b`/`#111113`). 층은 선으로 구분.
8. 네이비는 포인트(주요 CTA·선택·링크·진행 막대)에만. 넓은 면에 쓰지 않는다.
9. 모바일(`sm` 미만)은 현행: 컨트롤 44, 칩 40, btn-lg 52, 입력 글자 16px, 카드 모서리 12px.
10. 상태색 의미와 글자 대비 4.5:1은 밀도와 무관하게 유지.

## 1. 색 토큰

`--c-*` 변수 → `@theme`의 `--color-*` 유틸리티(`bg-surface`, `text-fg-muted` …).
기존 `slate-* / brand-* / amber-* / emerald-* / rose-* / sky-* / violet-*` 클래스도 아래 토큰으로 매핑되어 다크 모드에서 자동 전환된다.

### 중립·브랜드

| 변수 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| --c-canvas | `#fafafa` | `#0a0a0b` | 페이지 배경 |
| --c-surface | `#ffffff` | `#111113` | 카드·상단바·사이드바 |
| --c-surface-muted | `#f4f4f5` | `#18181b` | 표 머리, 보조 면, seg 트랙, hover |
| --c-line | `#e8e8ea` | `#222226` | 구분선, 카드 테두리 |
| --c-line-strong | `#d9d9dc` | `#2e2e33` | 입력·보조 버튼 테두리, seg 선택 테두리 |
| --c-fg | `#18181b` | `#ededef` | 본문 |
| --c-fg-2 | `#3f3f46` | `#d4d4d8` | 진한 보조 (`text-fg-2`) |
| --c-fg-3 | `#52525b` | `#b4b4bb` | 중간 보조 (`text-fg-3`) |
| --c-fg-muted | `#5f5f69` | `#a1a1aa` | 설명·메타·표 머리 |
| --c-fg-subtle | `#6e6e78` | `#8b8b94` | 플레이스홀더·아이콘·보조 메타 |
| --c-primary | `#164364` | `#7cb0e6` | 브랜드 네이비 — 주요 CTA·선택·링크 |
| --c-primary-hover | `#0e2f48` | `#9cc4ee` | |
| --c-on-primary | `#ffffff` | `#0f1a26` | **모든 단색 채움 위 글자** |
| --c-primary-disabled | `#e8e8ea` | `#222226` | 비활성 버튼 배경 (글자는 fg-subtle) |
| --c-primary-soft / -soft-2 | `#eaf0f6` / `#d5e1ec` | `#131c26` / `#1b2a3a` | 선택 배경 (`bg-brand-50/100`) |
| --c-primary-mid / -500 | `#7f9fb8` / `#285a80` | `#4a7aa6` / `#7cb0e6` | 보조 브랜드 |
| --c-accent | `#f15262` | `#ff6b78` | 로고 점·필수(*) 표시 전용 |

### 상태색 — 의미 고정

| 의미 | 토큰 / 클래스 | 라이트 채움·글자 | 다크 채움·글자 |
|---|---|---|---|
| 승인·정상 | ok / `emerald-*`, `badge-ok`, `alert-ok`, `--c-approved` | `#00875f` | `#3ecf8e` |
| 진행·상신·정보 | info / `sky-*`, `badge-info`, `alert-info`, `--c-progress` | `#2f6fb0` | `#8ec2f5` |
| 반려·오류·삭제 | bad / `rose-*`, `badge-bad`, `alert-danger`, `--c-rejected` | `#d93a4a` | `#ff6b78` |
| 보류 | hold / `violet-*`, `badge-hold`, `--c-hold` | `#7c4dcc` | `#b39dff` |
| 경고·주의(규정 점검·한도·임박) | warn / `amber-*`, `badge-warn`, `alert-warn` | `#f59e0b`(채움) · `#8a5100`(글자) | `#f5b544` · `#f5c76a` |

단계: `50·100` 배경, `200` 테두리, `500·600` 채움, `700·800` 배지 글자, `900` 알림 글자. 차트 전용 경고 채움은 `--c-chart-warn`(`bg-chart-warn`).

마감 상태 배지(`StatusBadge`): 예정=neutral(흐리게) · 작성중=neutral · **마감 대기=warn(앰버)** · **마감=neutral(진하게)+자물쇠** · 상신=info · 승인=ok · 반려=bad.
달 단위로 보이는 곳은 `monthPhase(ym, status, today)`(lib/month-phase)를 넘긴다 — 입력 기한(다음 달 3일)이 지난 작성중 달이 '마감 대기'.
앰버는 "경고"에만 쓴다(마감 대기는 PM에게 경고 — 마감·진행에는 쓰지 않음). 초록은 "승인"에만 쓴다(아이콘 장식 금지).

### 대비 검증 (WCAG AA 4.5:1)

| 조합 | 라이트 | 다크 |
|---|---|---|
| fg-muted / canvas · surface-muted | 6.05 · 5.74 | 6.91 (surface-muted) |
| fg-subtle / surface · canvas · surface-muted | 5.04 · 4.83 · 4.59 | 5.23 (surface) · 5.25 (surface-muted) |
| primary 글자 / canvas | 9.96 | 8.27 (surface) |
| btn-primary 글자 | 10.39 | 7.70 |
| btn-danger · btn-success 글자 | 4.51 · 4.53 | 6.38 · 8.80 |
| badge ok / warn / bad / info / hold (`*-50` 면) | 5.88 / 6.10 / 5.46 / 7.46 / 7.68 | 9.43 / 10.54 / 7.65 / 9.05 / 8.57 |
| badge neutral | 5.74 | 6.18 |

## 2. 타이포 (Pretendard, 최소 12px)

| 클래스 | 크기/행간 | 용도 |
|---|---|---|
| `text-xs` / `text-caption` | 12/16 | 메타, 배지, 표 머리 |
| `text-label` | 13/18 | 폼 라벨, PC 버튼·seg·칩 |
| `text-sm` | 14/20 | 본문·표 셀 기본, PC 리스트 행 제목·금액 |
| `text-base` | 16/24 | 모바일 입력(필수), 모바일 리스트 행 제목·금액(`text-base sm:text-sm`) |
| `text-title` | 16/24 bold | 카드·섹션 제목 (`.section-title`) — **모든 폭에서 16/700**. 제목은 그 아래 내용보다 작지 않게 |
| `text-h1` | 20/28 bold | 화면 제목 |
| `text-kpi` | 24/32 bold tabular | KPI 숫자 (모바일 `text-xl`) |
| `text-amount` | 28/36 bold tabular | 금액 입력 |

`text-[11px]` 이하 금지. 입력류에 작은 글자가 필요하면 반드시 `sm:text-sm`/`sm:text-xs` (모바일 16px 유지 — iOS 확대 방지).

## 3. 크기·모서리·그림자

**높이 단** (모바일 / PC `sm` 이상) — 한 줄에 놓이는 버튼·입력·seg·칩은 같은 단.

| 단 | 모바일 | PC | 클래스 |
|---|---|---|---|
| sm | 36 | 28 | `btn-sm` |
| md (기본) | 44 | **32** | `.btn-*`, `.input`, `.seg` 트랙, `chip()`(모바일 40) |
| lg | 52 | 40 | `btn-lg` — 화면당 주요 CTA 하나 |

표: 머리 36 · 행 40(`.table`). 카드 머리 44(`.card-head`).

**모서리**: 6 `rounded-md`(배지·seg 항목·PC 버튼·입력) · 8 `rounded-lg`(PC 카드·알림, 모바일 버튼·입력) · 12 `rounded-xl`(모바일 카드) · 16 `rounded-2xl`(팝오버·시트) · full(칩·아바타).

**그림자**: 카드 라이트 `0 1px 2px rgb(0 0 0 / .04)`, 다크 없음. 팝오버 `shadow-pop`, 바텀시트·모달 `shadow-sheet`. 다크는 명도(canvas < surface < surface-muted)와 1px 선으로 층을 나눈다.

**간격**: PC 섹션 간 16, 카드 안쪽 16, 카드 머리 좌우 16. 모바일 섹션 간 16~24, 카드 안쪽 16.

## 4. 컴포넌트 클래스 (이름 고정)

- `.btn-primary / -secondary / -danger / -success / -ghost` + `btn-sm` / `btn-lg`. 단색 버튼 글자는 `text-on-primary` (`text-white` 금지). PC 글자 13px (`btn-sm`도 PC 13px).
- `.input` (select·textarea 공용), `.label`.
- `.badge` + `badge-neutral / -primary / -ok / -warn / -bad / -info / -hold`. 20px · 12px · 600 · 연한 면. 상태는 글자·아이콘을 함께.
- `.card`, `.card-head`(PC 44px), `.section-title`.
- `.alert` + `alert-warn / -danger / -info / -ok / -neutral`(잠김·마감 안내). 첫 자식에 `<svg>`를 두면 아이콘+본문 배치.
- `.seg` — 트랙 `surface-muted` + 1px 선(PC), 선택 항목은 `surface` + `line-strong` 테두리. 선택 표시는 `aria-selected` / `aria-current="page"` / `aria-pressed` / `aria-checked`(라디오) = `"true"`. 필수 선택(라디오)은 미선택 상태가 보이게 할 것.
- `.table` — `th` 36px·12px·500·`fg-muted`·`surface-muted`, `td` 40px. 숫자는 tabular(표 전체 기본 적용), 숫자 열은 오른쪽 정렬. 행 hover는 `hover:bg-surface-muted`.
- `chip()`(`components/ui.ts`) — 필터·선택 칩. 모바일 40 / PC 32.
- `Empty` — 한 줄 설명 + (선택) `action` 버튼 하나. `StatusBadge`, `Stat`, `LockNotice`는 `components/common.tsx`.

## 5. 숫자·날짜 표기 (`lib/format.ts`)

| 대상 | 함수 | 예 |
|---|---|---|
| 금액 | `won(n)` | `15,300` |
| 금액(0은 대시) | `dash0(n)` | `0` → `-` |
| 날짜 제목·상세 | `dayLabel("2026-10-06")` | `10월 6일 (화)` |
| 목록·표 짧은 날짜 | `shortDate("2026-10-06")` | `10.06 (화)` |
| 단독 날짜(연도 필요) | `dotDate("2026-10-06")` | `2026.10.06` |
| 일시(연도 포함, 단독 칸) | `kstDateTime(d)` | `2026.10.06 14:30` |
| 일시(좁은 칸·단계 한 줄) | `shortDateTime(d)` | `10.06 14:30` |
| 월 | `ymKo("2026-10")` | `2026년 10월` |
| 월(좁은 칸, 연도 필요) | `ymShort("2026-10")` | `26년 10월` |
| 월(연도 없이) | `monthKo("2026-10")` | `10월` |
| 기간 | `formatPeriod(s, e)` | `2025.12.01 ~ 2026.11.30` |

- 금액·날짜는 항상 `tabular`. 표 안 금액은 "원" 생략(머리에 "(원)"), 단독 금액·KPI는 "원"을 붙인다(`fg-muted`, 작게 가능).
- 음수는 `-` + `text-status-rejected`.
- **금액 0 표기**: 표·합계 칸에서 "아직 없음"(입력·지출·공제가 없음)인 0은 `dash0` → `-`(+`fg-subtle`). 계산 결과로서 0원인 금액(잔액 0·공제 0·총합계 0)과 문장 속 금액("잔액 0원")은 `won` → `0`/`0원`. 같은 열 안에서는 한 규칙만 쓴다.
- 일시는 위 두 함수만: 날짜 문자열을 `.slice(5).replace("-", ".")`처럼 손으로 자르지 않는다.
- `sheetName`/`excelSheetName`("26.10월")은 **엑셀 시트명 전용** — 화면에 쓰지 않는다. `2026-10-02`, `26.10.05`, `10-07` 같은 표기도 위 함수로 바꾼다.

## 6. 원칙 10

1. 색은 토큰만. hex·Tailwind 원색을 의미 없이 쓰지 않는다.
2. 브랜드색은 네이비 하나, 포인트로만. 주요 CTA는 화면당 하나.
3. 상태색 의미 고정: 초록=승인, 파랑=진행·상신, 빨강=반려·오류, 보라=보류, 앰버=경고.
4. 글자 대비 4.5:1 이상. 12px 미만 금지.
5. 금액·날짜는 tabular·오른쪽 정렬·`lib/format.ts` 함수 하나로.
6. 높이 단: PC 28/32/40, 모바일 36/44/52. 같은 줄은 같은 단.
7. PC는 표 중심 밀도: 1px 선으로 구분, 그림자·큰 모서리·색 면 최소. 같은 줄에서 pill과 사각을 섞지 않는다.
8. 다크는 반전이 아니다. 위 층일수록 밝게, 그림자 대신 명도·선. 순흑·순백 금지.
9. 모바일 우선: 터치 44px 이상, 입력 글자 16px, 390px에서 가로 넘침 0(그리드는 `grid-cols-1`/`minmax(0,1fr)`, 가로 스크롤 줄은 부모에 `min-w-0`).
10. 상태는 색만으로 전달하지 않는다. 배지·경고에 글자·아이콘을 함께.
