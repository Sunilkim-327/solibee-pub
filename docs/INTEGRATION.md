# 조직도·로그인 연동 준비 (추후 진행)

현재는 **임시 자체 관리** 방식이다. 관리자가 조직도(부서)와 계정을 직접 등록하고(화면 입력 또는 CSV), 로그인은 앱 자체 계정(이메일 또는 사번 + 비밀번호)으로 한다. 회사 조직도·통합 로그인(SSO)과 연동이 확인되면 아래 매핑 키를 그대로 사용해 전환한다.

## 1. 지금 저장해 두는 매핑 키

| 대상 | 필드 | 용도 |
| --- | --- | --- |
| 부서 | `Department.code` (unique) | 회사 조직도의 부서코드. 동기화 시 이 값으로 매칭 |
| 부서 | `Department.parentId`, `order`, `active` | 트리·정렬·폐지 부서 (삭제 대신 비활성) |
| 사용자 | `User.employeeNo` (unique) | 사번. HR/조직도 동기화의 1차 매칭 키 |
| 사용자 | `User.email` (unique) | 로그인 ID. 변경 가능하므로 매칭 키로는 보조 |
| 사용자 | `User.externalId` (unique), `authProvider` | SSO(IdP)의 사용자 식별자(sub/objectId/External Key), `local` → `sso` 전환 |
| 사용자 | `externalSource`, `lastSyncedAt` | 동기화 출처(hr/entra/naverworks 등)와 마지막 동기화 시각 |
| 사용자 | `active`, `deactivatedAt` | 퇴사·휴직 처리 — **삭제하지 않고 비활성화** (지출·감사 이력 보존) |
| 프로젝트 | `Project.code` (unique), `departmentId` | 사내 프로젝트 코드·주관 부서 |

앱 역할(관리자/재무팀/PM/프로젝트 팀원)은 IdP 그룹과 분리해 앱 안에서 관리한다. 필요 시 "IdP 그룹 → 앱 역할" 매핑 테이블을 추가한다.

## 2. 조직도 동기화 (예정)

권장 방식(우선순위 순):
1. **HR/그룹웨어 API 배치 동기화** — 매일 새벽 부서·사용자 전체를 받아 `code`/`employeeNo` 기준 upsert, 목록에서 빠진 사용자는 `active=false`.
2. **SCIM 2.0 프로비저닝** (Entra ID/Okta 등) — `/scim/v2/Users`, `/Groups` 엔드포인트 추가. `employeeNumber → employeeNo`, `department → Department.code`, `active=false` = 비활성화.
3. **CSV 업로드** — 현재 구현됨 (관리자 > 마스터 관리 > 사용자 · 로그인 > CSV 일괄 등록).

동기화로 생긴 변경은 감사로그에 `userId = "system:sync"`로 남기고, 실행 결과(생성/수정/비활성 건수, 오류)를 별도 로그로 보관한다.

## 3. 통합 로그인(SSO) 전환 (예정)

- **OIDC 우선**(Entra ID, Google Workspace, Okta, 네이버웍스 등), 불가 시 SAML.
- 콜백에서 IdP 사용자 식별자로 `User.externalId`를 찾고, 없으면 사번/이메일로 1회 매칭 후 `externalId` 저장.
- 세션 발급은 기존 `lib/session.ts`(HMAC 서명 쿠키 — 접근 토큰 1시간 + 리프레시 토큰 14일, 절대 30일)를 그대로 사용.
- SSO 활성화 후에는 `authProvider="sso"` 계정의 비밀번호 로그인을 막고(`app/api/auth/login`에 이미 분기 있음), 비상용 로컬 관리자 계정 1개만 유지.
- 관리자 계정 2차 인증(OTP 등)은 SSO 측 MFA로 대체하거나 추후 추가.

## 4. 현재 로그인 보안 정책 (임시 자체 계정)

| 항목 | 정책 | 위치 |
| --- | --- | --- |
| 비밀번호 | 2종 조합 10자 / 3종 이상 8자, 아이디·사번 포함 금지 (KISA 권고) | `lib/auth-policy.ts` |
| 계정 발급 | 관리자만. 임시 비밀번호(24시간 유효) → 첫 로그인 시 변경 강제 | 관리자 > 사용자 · 로그인 |
| 시도 제한 | 15분 안에 IP당 20회·IP+아이디 5회 실패면 차단, 아이디 기준 10회부터 지연·50회 차단 (DB 기록, 검증 전 선기록) | `lib/auth-throttle.ts` |
| 세션 | 접근 토큰 1시간, 리프레시 토큰 14일(사용 시 갱신·1회용 회전, 재사용 감지 시 전체 로그아웃), 로그인 후 30일 절대 만료 | `lib/session.ts`, `app/api/auth/refresh`, `components/SessionKeeper.tsx` |
| 비활성화 | 즉시 기존 세션 무효 | `lib/access.ts` |
| 기록 | 로그인 성공·실패·잠금, 권한·계정 변경, 데이터 변경, 엑셀 다운로드 + IP — 추가 전용 | 관리자 > 접속·변경 기록 |

> 비밀번호 해시는 현재 Node 내장 scrypt를 사용한다(KISA 권장 일방향 해시 범주). 클라우드 배포 시 HTTPS 필수, `SESSION_SECRET`은 반드시 별도 비밀값으로 설정한다.

## 5. 업체 출입증 — Soliday 야근 기록 연동 (예정)

업체 출입증 사용 내역(`PassStatementLine`) 중 야근 등으로 **급여 공제에서 제외**할 건은 지금은 PM이 직접 정한다
(팀원은 "급여 공제에서 제외" 체크로 요청). Soliday 초과근무 기록이 연동되면 야근한 날의 사용분을 자동으로 제외 인정한다.

- 연동 지점: `lib/overtime.ts`
  - `interface OvertimeSource { name; overtimeDates(userIds, from, to): Promise<Map<userId, Set<"YYYY-MM-DD">>> }`
  - `getOvertimeSource()`가 지금은 `noOvertimeSource`(항상 빈 결과)를 돌려준다 → Soliday 구현체로 바꾸면 끝.
  - `autoDecide(lines, overtime)`(순수함수): 미결정 줄 중 해당 직원이 그날 야근했으면 `decision = OVERTIME`, `decisionSource = "SOLIDAY"`.
    PM·재무팀이 이미 정한 줄과 외부인 대납 줄은 건드리지 않는다.
- 실행 시점: 업체 내역 반영 직후, PM이 직원을 지정한 직후 (`applyOvertime` in `lib/pass-statement-server.ts`).
- **날짜 열이 있는 업체 양식에서만** 대조된다 (업체 양식에서 날짜 열을 지정하지 않으면 자동 인정 없음).

### Soliday가 제공해야 할 것
1. 직원 식별: 이 앱의 `User.employeeNo`(사번) 또는 `User.email`로 매핑 가능한 직원 키.
2. 조회 API: 기간(from~to, 날짜 포함)·직원 목록 → 직원별 **야근(초과근무 승인) 날짜** 목록.
   - **회사 부담 인정 기준(운영 확정)**: 그날 **야근 신청이 승인**되었고, **퇴근 시각이 일과시간 종료 후 1시간 30분 이상** 지난 경우.
     이 기준을 만족한 날만 돌려주거나(권장), 승인 여부·퇴근 시각을 함께 받아 이 앱에서 거른다.
   - 기준에 맞지 않는 날의 사용분은 기본값인 본인 부담(급여 공제)으로 남고, 팀원은 화면에서 [회사 부담으로 변경]으로 요청, PM이 결정한다.
   - 예: `GET /overtime?from=2026-10-01&to=2026-10-31&employeeNo=...` → `[{ employeeNo, date: "2026-10-14", minutes, approved: true }]`
   - 승인된 초과근무만, 날짜는 근무 시작일 기준(자정 넘긴 야근의 식사는 시작일로 본다는 규칙을 Soliday와 합의).
3. 인증: 서버 간 토큰(조직도 연동과 같은 방식) — 브라우저를 거치지 않는다.
4. (선택) 야근 기준 시각(예: 19시 이후)·식대 대상 여부를 함께 주면, 시간 열이 있는 업체 내역과 시각까지 대조할 수 있다.

자동 인정 결과는 화면에 출처 배지 "Soliday"로 표시되고, PM은 언제든 바꿀 수 있으며 월 확정 전까지 다시 반영된다.
