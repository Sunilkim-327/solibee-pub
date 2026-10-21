// 로그인 정책 — 시스템 관리자 관리형 자체 계정. 회사 SSO 연동 시 authProvider="sso" 계정은 비밀번호 검사를 건너뛴다.
import { createHash, randomInt } from "node:crypto";

/**
 * 비밀번호 규칙 (KISA 권고): 영문대·영문소·숫자·특수문자 중 2종 조합 10자 이상 또는 3종 이상 조합 8자 이상.
 * 아이디(이메일 @ 앞부분)·사번을 포함할 수 없다.
 */
export function passwordProblem(pw: string, identity: { loginId?: string | null; employeeNo?: string | null } = {}): string | null {
  if (pw.length > 100) return "비밀번호는 100자 이내로 설정하세요.";
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds < 2 || (kinds === 2 && pw.length < 10) || pw.length < 8) {
    return "영문 대·소문자, 숫자, 특수문자 중 2종 이상은 10자, 3종 이상은 8자 이상으로 설정하세요.";
  }
  const lower = pw.toLowerCase();
  const id = identity.loginId?.toLowerCase().split("@")[0];
  if ((id && id.length >= 3 && lower.includes(id)) || (identity.employeeNo && lower.includes(identity.employeeNo.toLowerCase()))) {
    return "비밀번호에 아이디나 사번을 포함할 수 없습니다.";
  }
  return null;
}

export const TEMP_PASSWORD_HOURS = 24;
export const tempPasswordExpiry = () => new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600000);

/** 임시 비밀번호 (혼동 문자 제외, 영문+숫자 보장) */
export function tempPassword(length = 10): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export type LoginState = { active: boolean; lockedUntil: Date | null; failedLogins: number };

/** 로그인 시도 가능 여부 — 비활성 계정, 시스템 관리자가 건 잠금(lockedUntil). 실패 횟수 제한은 lib/auth-throttle.ts */
export function loginBlocked(u: LoginState, now = new Date()): string | null {
  if (!u.active) return "비활성화된 계정입니다. 시스템 관리자에게 계정 활성화를 요청하세요.";
  if (u.lockedUntil && u.lockedUntil > now) {
    const min = Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 60000);
    // 잠금은 시스템 관리자의 잠금 해제 또는 PM의 임시 비밀번호 발급으로 풀린다
    return `로그인 실패가 반복되어 잠겼습니다. ${min}분 후 다시 시도하거나 PM이나 시스템 관리자에게 요청하세요.`;
  }
  return null;
}

/** 감사 로그용 입력 아이디 마스킹 — 원문 대신 SHA-256 앞 12자리 (오타로 입력된 비밀번호 등이 남지 않게) */
export function maskLoginInput(input: string): string {
  return "id#" + createHash("sha256").update(input.trim().toLowerCase()).digest("hex").slice(0, 12);
}
