// PM이 팀원의 임시 비밀번호를 발급할 수 있는 대상인지 (순수함수 — tests/pm-reset.test.ts)
// 시스템 관리자 발급(/api/admin/users/[id])과 같은 효과이지만 대상은 "내 프로젝트의 현재 팀원"으로 좁힌다.
import type { Role } from "./types";

export type ResetTarget = {
  id: string;
  role: Role;
  active: boolean;
  /** 이 프로젝트의 팀원 행 (없으면 팀원이 아님) */
  member: { isPm: boolean; leftAt: Date | string | null } | null;
  /** 다른 프로젝트의 현재 PM인지 — 여기서는 팀원이어도 발급하면 그 프로젝트의 PM 권한을 넘겨받을 수 있다 */
  pmElsewhere?: boolean;
  /** 발급하는 PM이 PM이 아닌 다른 프로젝트에도 현재 팀원인지 — 그 프로젝트에서의 본인 행세를 막는다 */
  outsideMine?: boolean;
};

/** 발급할 수 없으면 그 이유, 가능하면 null */
export function pmResetProblem(pmId: string, t: ResetTarget | null): string | null {
  if (!t || !t.member) return "이 프로젝트의 팀원이 아닙니다.";
  if (t.id === pmId) return "본인 비밀번호는 [비밀번호 변경]에서 바꾸세요.";
  if (t.member.isPm || t.pmElsewhere) return "다른 PM의 비밀번호는 시스템 관리자에게 요청하세요.";
  if (t.role === "HQ" || t.role === "ADMIN") return "재무 승인·시스템 관리자 계정의 임시 비밀번호는 시스템 관리자만 발급할 수 있습니다.";
  if (t.outsideMine) return "다른 PM의 프로젝트에도 소속된 팀원입니다. 시스템 관리자에게 요청하세요.";
  if (t.member.leftAt) return "이전 팀원으로 처리된 사람입니다. 현재 팀원에게만 발급할 수 있습니다.";
  if (!t.active) return "비활성 계정입니다. 시스템 관리자에게 요청하세요.";
  return null;
}
