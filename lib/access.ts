// 인증·권한·프로젝트 접근 제어 공통 함수 (서버 전용)
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { d1Batch, insertStatements, newCuid, prisma, sqlExec, type SqlParam } from "./db";
import { HttpError } from "./http-error";
import { PROJECT_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, readSessionToken } from "./session";
import { NEXT_PATH_HEADER, loginUrl } from "./session-path";
import { orderTree, orgHeadProjects, visibleProjects } from "./hierarchy";
import { PHASE_LABEL, memberInputOpen, projectPhase, rollupChildren } from "./lifecycle";
import { projectScopedUser } from "./pm";
import { parseClosingStatus, parseRole, type ClosingStatus, type Role } from "./types";
import { seoulTodayDate } from "./format";
import { homeFor, withNotice } from "./page-access";
import { sqlAllProjects, sqlCurrentMemberships, sqlDepartmentNodes, sqlProjectById, sqlSessionUserRow } from "./sql-loaders";

export type SessionUser = {
  id: string;
  name: string;
  /** 로그인 아이디 */
  loginId: string | null;
  role: Role;
  mustChangePassword: boolean;
  departmentName: string | null;
  position: string | null;
  /** 상위 프로젝트 PM으로서 하위 프로젝트를 조회 중이거나, 종료된 프로젝트 (변경 불가) */
  readOnly?: boolean;
  /** view = 상위 PM·조직장 조회, closed = 종료·보관된 프로젝트, admin = 시스템 관리자(프로젝트 데이터는 조회 전용) */
  readOnlyReason?: "view" | "closed" | "admin";
};

export { HttpError };

export const canManage = (u: SessionUser) => u.role === "MANAGER" || u.role === "ADMIN";
export const isHqLike = (u: SessionUser) => u.role === "HQ" || u.role === "ADMIN";
const hqLikeRole = (role: string) => role === "HQ" || role === "ADMIN";
/** 캐시 키: 볼 수 있는 범위는 전체(재무 승인·시스템 관리자) 여부만 역할에 따라 달라진다 (프로젝트 역할로 바뀐 사용자도 같은 캐시를 쓰게) */
const viewScope = (u: SessionUser) => (isHqLike(u) ? "HQ" : "USER");

// ── 요청 단위 메모이즈 (레이아웃·페이지·취합 범위가 같은 조회를 반복하지 않게) — 키는 원시값 ──

/** 사용자 행 (같은 요청 안에서 한 번만 조회) — 세션 확인과 화면의 "내 조직" 조회가 함께 쓴다 */
// (매 요청 조회라 직접 SQL — lib/sql-loaders.ts, Prisma user.findUnique와 같은 결과)
const userRow = cache((uid: string) => sqlSessionUserRow(uid));

/** 세션 사용자 (같은 요청 안에서 한 번만 조회) */
export const loadSessionUser = cache(async (uid: string, version: number): Promise<SessionUser | null> => {
  const user = await userRow(uid);
  // 비활성화(퇴사 등)된 계정은 기존 세션도 즉시 무효
  if (!user || !user.active) return null;
  // 로그아웃·비밀번호 변경·권한 변경 시 sessionVersion이 올라가 기존 세션 무효
  if (user.sessionVersion !== version) return null;
  const role = parseRole(user.role);
  if (!role) return null;
  return {
    id: user.id,
    name: user.name,
    loginId: user.loginId,
    role,
    mustChangePassword: user.mustChangePassword,
    departmentName: user.department?.name ?? null,
    position: user.position,
  };
});

/**
 * 전체 프로젝트 (시작일 순) — 가시성·취합 범위·접근 가능 목록·현재 프로젝트가 한 번의 조회를 함께 쓴다.
 * 현재 프로젝트 행은 페이지에서 그대로 쓰므로(예: 대시보드) 모든 스칼라 열을 읽는다 (관계는 읽지 않음).
 */
export const projectRows = cache(() => sqlAllProjects());

// 조직 트리 + 조직장 (조직장 범위도 같은 조회에서 거른다)
const departmentNodes = cache(() => sqlDepartmentNodes());
// 이전 팀원(철수일 지남)은 현재 팀원으로 보지 않는다 — 접근·입력 불가 (lib/membership.ts)
const membershipsOf = cache((userId: string) => sqlCurrentMemberships(userId, seoulTodayDate()));
const headDeptIdsOf = cache(async (userId: string) =>
  (await departmentNodes()).filter((d) => d.headId === userId && d.active).map((d) => d.id),
);

const visibilityFor = cache(async (userId: string, role: string): Promise<Map<string, "member" | "parent-pm"> | null> => {
  if (hqLikeRole(role)) return null; // 재무 승인·시스템 관리자: 전체
  const [nodes, memberships, depts, headOf] = await Promise.all([projectRows(), membershipsOf(userId), departmentNodes(), headDeptIdsOf(userId)]);
  // 상위 PM: 하위 프로젝트 (같은 연속 사업의 다른 연차에 연결됐더라도 기간이 겹치면 포함)
  const vis = visibleProjects(nodes, memberships, (id) => rollupChildren(nodes, id));
  // 조직장: 자기 조직·하위 조직의 프로젝트를 조회 전용으로
  for (const id of orgHeadProjects(nodes, depts, headOf)) if (!vis.has(id)) vis.set(id, "parent-pm");
  return vis;
});

/** 접근 가능한 프로젝트 (시작일 순, 보관 포함) + 생애주기 단계 */
const accessibleRowsFor = cache(async (userId: string, role: string) => {
  const [vis, rows] = await Promise.all([visibilityFor(userId, role), projectRows()]);
  return rows.filter((p) => !vis || vis.has(p.id)).map((p) => ({ ...p, phase: projectPhase(p) }));
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const session = readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await loadSessionUser(session.uid, session.v);
  return user && { ...user };
}

/**
 * 로그인 화면으로 (미들웨어가 넣어 준 현재 경로가 있으면 로그인 후 돌아오도록 next로).
 * 접근 토큰만 만료됐고 리프레시 쿠키가 있으면 로그인 대신 재발급 라우트로 — 성공하면 원래 화면으로 돌아온다 (서버 컴포넌트는 쿠키를 못 쓴다)
 */
async function redirectToLogin(): Promise<never> {
  let back: string | null = null;
  try {
    back = (await headers()).get(NEXT_PATH_HEADER);
  } catch {
    back = null;
  }
  if ((await cookies()).get(REFRESH_COOKIE)) redirect(`/api/auth/refresh${back ? `?next=${encodeURIComponent(back)}` : ""}`);
  redirect(loginUrl(back));
}

/** 페이지용: 미로그인 시 /login, 비밀번호 변경 필요 시 변경 화면, 역할 불일치 시 홈으로 */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) return redirectToLogin();
  if (user.mustChangePassword) redirect("/account/password");
  // 권한 없는 화면이면 역할별 첫 화면으로 바로 ("/"를 거쳐 한 번 더 이동하지 않게) — 안내 토스트와 함께
  if (roles && !roles.includes(user.role)) redirect(withNotice(await homePath(user), "role"));
  return user;
}

/** API용: 미로그인 401, 비밀번호 변경 전 403, 역할 불일치 403 */
export async function apiUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "로그인이 필요합니다.");
  if (user.mustChangePassword) throw new HttpError(403, "임시 비밀번호를 먼저 변경하세요.");
  if (roles && !roles.includes(user.role)) throw new HttpError(403, "권한이 없습니다.");
  return user;
}

/** 로그인 사용자의 소속 조직 id·직급 (세션 확인 때 읽은 행을 다시 쓴다) */
export async function myProfile(user: Pick<SessionUser, "id">) {
  const row = await userRow(user.id);
  return { departmentId: row?.departmentId ?? null, position: row?.position ?? null };
}

/** 로그인 사용자의 현재 팀원 정보 (철수 전 프로젝트, 가시성 계산에 읽은 것을 다시 쓴다) */
export async function myMemberships(user: Pick<SessionUser, "id">) {
  return [...(await membershipsOf(user.id))];
}

/** 사용자에게 보이는 프로젝트와 접근 방식 (팀원 / 상위 PM으로서 하위 조회). 재무 승인·시스템 관리자는 null(전체) */
export async function projectVisibility(user: SessionUser) {
  const vis = await visibilityFor(user.id, viewScope(user));
  return vis && new Map(vis);
}

/** 접근 가능한 프로젝트 (상·하위 트리 순서) + 생애주기 단계. 보관된 프로젝트는 includeArchived일 때만 */
export async function accessibleProjects(user: SessionUser, opts: { includeArchived?: boolean } = {}) {
  const rows = await accessibleRowsFor(user.id, viewScope(user));
  return orderTree(opts.includeArchived ? rows : rows.filter((p) => p.phase !== "ARCHIVED"));
}

/** 프로젝트 행 + 이 사용자의 직접 팀원 정보 (팀원이 아니면 상위 PM·조직장 조회 가능 여부를 확인) */
const projectAccessFor = cache(async (userId: string, role: string, projectId: string) => {
  if (hqLikeRole(role)) {
    const project = await sqlProjectById(projectId);
    if (!project) throw new HttpError(404, "프로젝트를 찾을 수 없습니다.");
    return { project, membership: null };
  }
  // 팀원 정보는 사용자의 현재 팀원 목록(요청 안에서 한 번 조회)에서 찾는다 — (projectId, userId)는 고유
  const [project, mine] = await Promise.all([sqlProjectById(projectId), membershipsOf(userId)]);
  const found = mine.find((m) => m.projectId === projectId);
  const membership = found ? { isPm: found.isPm } : null;
  if (!project) throw new HttpError(404, "프로젝트를 찾을 수 없습니다.");
  // 팀원이면 바로 허용, 아니면 상위 PM·조직장으로서 볼 수 있는지 전체 가시성으로 확인
  if (!membership) {
    const vis = await visibilityFor(userId, role);
    if (vis && !vis.has(projectId)) throw new HttpError(403, "프로젝트 접근 권한이 없습니다.");
  }
  return { project, membership };
});

/** 프로젝트 외 사용자 접근 차단 (상위 PM은 하위 프로젝트 조회 가능) */
export async function assertProjectAccess(user: SessionUser, projectId: string) {
  const { project } = await projectAccessFor(user.id, viewScope(user), projectId);
  return { ...project };
}

/**
 * 프로젝트 안에서의 사용자 — 접근 확인 + 프로젝트 역할 반영
 * (PM 권한이 있어도 이 프로젝트의 PM이 아니면 팀원으로 동작). roles를 주면 프로젝트 역할로 다시 확인한다.
 */
export async function assertProjectRole(user: SessionUser, projectId: string, roles?: Role[]) {
  const { project, membership } = await projectAccessFor(user.id, viewScope(user), projectId);
  // 팀원이 아니면 상위 프로젝트 PM으로서 조회 → PM 화면을 조회 전용. 종료·보관된 프로젝트는 모두에게 조회 전용
  const { user: me, phase } = projectScopedUser(user, project, membership);
  if (roles && !roles.includes(me.role)) throw new HttpError(403, "이 프로젝트에서 권한이 없습니다.");
  return { project: { ...project }, user: me, phase };
}

/** 프로젝트 변경 API 공통: 로그인 → 프로젝트 역할 확인(roles) → 조회 전용(상위 조회·종료·시스템 관리자) 차단 */
export async function projectWriter(projectId: string, roles?: Role[], opts?: WritableOptions) {
  const r = await assertProjectRole(await apiUser(), projectId, roles);
  assertWritable(r.user, opts);
  return r;
}

/** allowAdmin: 기준 정보 기능(프로젝트 정보·PM 지정·변경계약)은 시스템 관리자도 변경 가능 */
export type WritableOptions = { allowAdmin?: boolean };
export const ADMIN_READONLY_MESSAGE = "시스템 관리자는 프로젝트 데이터를 조회만 할 수 있습니다. 입력·마감은 PM, 승인은 재무 승인 담당이 진행합니다.";

/** 조회 전용(상위 PM 조회·종료된 프로젝트·시스템 관리자) 상태에서는 변경 차단 */
export function assertWritable(user: SessionUser, opts?: WritableOptions) {
  if (user.readOnly && user.readOnlyReason === "closed") throw new HttpError(403, "종료된 프로젝트는 조회만 할 수 있습니다. 변경이 필요하면 재무 승인 담당에게 종료 취소를 요청하세요.");
  if (user.readOnly && user.readOnlyReason === "admin") {
    if (opts?.allowAdmin) return;
    throw new HttpError(403, ADMIN_READONLY_MESSAGE);
  }
  if (user.readOnly) throw new HttpError(403, "조회 권한(상위 프로젝트 PM·조직장)으로는 변경할 수 없습니다. 입력·마감은 이 프로젝트 PM이 진행합니다.");
}

/** 팀원 입력 마감: 기간이 끝난 프로젝트는 종료월 다음 달까지만 팀원 입력 허용 (PM·재무 승인 담당은 종료 처리 전까지 가능) */
export function assertInputOpen(project: { startDate: Date; endDate: Date; closedAt: Date | null; archivedAt: Date | null }, user: SessionUser) {
  assertWritable(user);
  if (user.role === "MEMBER" && !memberInputOpen(project)) {
    throw new HttpError(403, `프로젝트 기간이 끝나 팀원 입력이 마감되었습니다 (${PHASE_LABEL.WRAPUP}). 늦게 입력할 지출은 PM에게 요청하세요.`);
  }
}


/** 페이지용: 쿠키에 저장된 현재 프로젝트 (없거나 권한 없으면 첫 프로젝트) */
const currentProjectFor = cache(async (userId: string, role: string) => {
  // 보관된 프로젝트도 직접 고른 경우에는 열 수 있게 (선택 목록에는 넣지 않음)
  const all = orderTree(await accessibleRowsFor(userId, role));
  // 보관된 상위가 빠지면 하위의 깊이가 달라지므로 트리 순서를 다시 매김
  const projects = orderTree(all.filter((p) => p.phase !== "ARCHIVED"));
  const store = await cookies();
  const selected = store.get(PROJECT_COOKIE)?.value;
  // 저장된 선택이 없으면 내 프로젝트를 먼저: 진행 중 PM → 진행 중 팀원 → 진행 중(조회) → 나머지
  // (상위 PM·조직장으로 '조회'만 하는 하위 프로젝트가 트리 순서로 먼저 잡히지 않게)
  const mine = hqLikeRole(role) ? [] : await membershipsOf(userId);
  const rank = (p: (typeof projects)[number]) => {
    const m = mine.find((x) => x.projectId === p.id);
    return (p.phase === "ACTIVE" ? 0 : 3) + (m?.isPm ? 0 : m ? 1 : 2);
  };
  const fallback = projects.reduce<(typeof projects)[number] | null>((best, p) => (!best || rank(p) < rank(best) ? p : best), null);
  const project = all.find((p) => p.id === selected) ?? fallback;
  return { project, projects };
});

export async function getCurrentProject(user: SessionUser) {
  return currentProjectFor(user.id, viewScope(user));
}

/**
 * 현재 프로젝트 + 그 프로젝트에서의 사용자 (레이아웃·페이지 공통).
 * 현재 프로젝트는 이미 가시성으로 걸러진 목록에서 고르므로 접근 확인을 다시 하지 않고,
 * 팀원 정보도 가시성 계산에 읽은 것을 쓴다.
 */
export async function currentProjectContext(sessionUser: SessionUser) {
  const { project, projects } = await currentProjectFor(sessionUser.id, viewScope(sessionUser));
  if (!project) return { project, projects, user: sessionUser };
  const membership = isHqLike(sessionUser) ? null : ((await membershipsOf(sessionUser.id)).find((m) => m.projectId === project.id) ?? null);
  const { user } = projectScopedUser(sessionUser, project, membership);
  return { project, projects, user };
}

/** 역할별 첫 화면 경로 (현재 프로젝트에서의 역할 기준 — lib/page-access homeFor) */
export async function homePath(sessionUser: SessionUser): Promise<string> {
  if (isHqLike(sessionUser)) return homeFor({ globalRole: sessionUser.role, hasProject: false, role: sessionUser.role });
  const { project, user } = await currentProjectContext(sessionUser);
  return homeFor({ globalRole: sessionUser.role, hasProject: !!project, role: user.role, readOnly: user.readOnly });
}

/** 페이지 공통: 로그인 사용자 + 현재 프로젝트 (레이아웃에서 프로젝트 없음 처리) */
export async function pageContext(roles?: Role[]) {
  const sessionUser = await requireUser();
  const { project, user } = await currentProjectContext(sessionUser);
  // 배정된 프로젝트가 없으면 안내 화면으로
  if (!project) redirect("/no-project");
  // 프로젝트 역할 기준으로 화면 권한 판단 — 권한이 없으면 역할별 첫 화면으로 바로 (안내 토스트와 함께)
  if (roles && !roles.includes(user.role)) redirect(withNotice(homeFor({ globalRole: sessionUser.role, hasProject: true, role: user.role, readOnly: user.readOnly }), "role"));
  return { user, project };
}

export async function closingStatusOf(projectId: string, yearMonth: string): Promise<ClosingStatus> {
  const c = await prisma.monthlyClosing.findUnique({
    where: { projectId_yearMonth: { projectId, yearMonth } },
    select: { status: true },
  });
  return parseClosingStatus(c?.status);
}

/**
 * 요청자 IP — 신뢰할 수 있는 리버스 프록시 뒤(TRUST_PROXY=1)일 때만 X-Forwarded-For·X-Real-IP를 믿는다.
 * 그 외에는 null (클라이언트가 헤더를 위조할 수 있으므로 시도 제한 등 보안 판단에 쓰지 않음)
 */
export async function clientIp(): Promise<string | null> {
  // Cloudflare Workers: CF-Connecting-IP는 Cloudflare가 넣으며 클라이언트가 위조할 수 없다
  if (process.env.DB_TARGET === "d1") {
    try {
      return (await headers()).get("cf-connecting-ip");
    } catch {
      return null;
    }
  }
  if (process.env.TRUST_PROXY !== "1") return null;
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

/**
 * 감사 로그용 IP. 프록시 미신뢰 모드에서는 Next 서버가 넣어 준(또는 클라이언트가 보낸) X-Forwarded-For를
 * "(미검증)" 표시와 함께 남긴다 — 접속기록 보존용이며 보안 판단에는 쓰지 않는다.
 */
async function auditIp(): Promise<string | null> {
  const trusted = await clientIp();
  if (trusted || process.env.TRUST_PROXY === "1") return trusted;
  try {
    const h = await headers();
    const raw = h.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 64);
    return raw ? `${raw} (미검증)` : null;
  } catch {
    return null;
  }
}

type AuditEntry = { projectId?: string; entity: string; entityId: string; action: string; data?: unknown };

/** 감사 로그 행 (열 순서 = 테이블 열). id는 Prisma cuid와 같은 모양, createdAt은 한 번에 넣는 행끼리 같은 시각 (Prisma createMany와 같게) */
const auditRow = (user: Pick<SessionUser, "id">, entry: AuditEntry, ip: string | null, at: Date) => ({
  id: newCuid(),
  projectId: entry.projectId ?? null,
  entity: entry.entity,
  entityId: entry.entityId,
  action: entry.action,
  userId: user.id,
  data: entry.data === undefined ? null : JSON.stringify(entry.data),
  ip,
  createdAt: at,
});

/**
 * 변경·접속 기록 저장 (추가 전용 — 수정·삭제 API 없음).
 * 직접 SQL — 로그인·로그아웃처럼 다른 Prisma 조회가 없는 요청이 Prisma를 준비하지 않게 (운영 CPU)
 */
export async function audit(user: Pick<SessionUser, "id">, entry: AuditEntry) {
  const [s] = insertStatements("AuditLog", [auditRow(user, entry, await auditIp(), new Date())]);
  await sqlExec(s.sql, s.params as SqlParam[]);
}

/** 여러 건의 기록을 한 번에 저장 (같은 사용자·같은 요청) */
export async function auditMany(user: Pick<SessionUser, "id">, entries: AuditEntry[]) {
  if (!entries.length) return;
  const ip = await auditIp();
  const at = new Date();
  const stmts = insertStatements("AuditLog", entries.map((e) => auditRow(user, e, ip, at)));
  // 운영(D1): 한 번에 원자적으로 / 로컬: 순서대로
  if (!(await d1Batch(stmts))) for (const s of stmts) await sqlExec(s.sql, s.params as SqlParam[]);
}

type Ctx<P> = { params: Promise<P> };

/** DB 제약 오류 → 사용자 메시지 (경합 등으로 사전 확인을 지나친 경우) */
const PRISMA_ERRORS: Record<string, [number, string]> = {
  P2002: [409, "이미 같은 값이 있습니다."],
  P2025: [404, "대상을 찾을 수 없습니다."],
  P2003: [400, "연결된 데이터가 올바르지 않습니다."],
};

/** API 응답은 캐시하지 않는다 (개인 정보가 든 응답이 공유 캐시·브라우저 캐시에 남지 않게) — 이미 정했으면 그대로 */
function noStore(res: Response): Response {
  try {
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store, private");
  } catch {
    /* 헤더를 바꿀 수 없는 응답이면 그대로 */
  }
  return res;
}

/** 라우트 핸들러 래퍼: HttpError·DB 제약 오류 → JSON 에러 응답 */
export function route<P = Record<string, string>>(
  handler: (req: Request, ctx: Ctx<P>) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      return noStore(await handler(req, ctx));
    } catch (err) {
      if (err instanceof HttpError) return noStore(NextResponse.json({ error: err.message, ...err.extra }, { status: err.status }));
      // Prisma 오류면 Prisma 모듈은 이미 불러와져 있다 (직접 SQL만 쓰는 요청에서 모듈을 불러오지 않게 여기서만 참조)
      /* eslint-disable-next-line @typescript-eslint/no-require-imports */
      const { Prisma } = require("@prisma/client") as typeof import("@prisma/client");
      if (err instanceof Prisma.PrismaClientKnownRequestError && PRISMA_ERRORS[err.code]) {
        const [status, error] = PRISMA_ERRORS[err.code];
        console.warn(`[${err.code}]`, err.meta ?? "");
        return noStore(NextResponse.json({ error }, { status }));
      }
      console.error(err);
      return noStore(NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 }));
    }
  };
}

/** JSON 본문 상한 — 일반 1MB, 로그인·비밀번호 등 작은 요청은 호출부에서 더 작게 */
export const JSON_MAX_BYTES = 1024 * 1024;
export const SMALL_JSON_MAX_BYTES = 16 * 1024;

/** 본문을 상한까지만 읽는다 (Content-Length가 없거나 거짓이어도 상한을 넘으면 중단) */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "요청이 너무 큽니다.");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "요청이 너무 큽니다.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = JSON_MAX_BYTES): Promise<T> {
  // 폼 전송(text/plain 등)으로 위장한 교차 사이트 요청 차단
  const type = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "JSON 형식(application/json)으로 요청하세요.");
  // 본문 크기 상한 (큰 본문으로 서버 CPU·메모리를 쓰게 하는 요청 차단)
  const text = await readBodyLimited(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "잘못된 요청 형식입니다.");
  }
  // null·숫자·문자열 본문은 라우트가 body.x를 읽다 서버 오류가 나므로 여기서 거른다
  if (parsed === null || typeof parsed !== "object") throw new HttpError(400, "잘못된 요청 형식입니다.");
  return parsed as T;
}
