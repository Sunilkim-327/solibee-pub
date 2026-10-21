// 조직도 동기화 실행 (서버 전용)
import "server-only";
import { randomBytes } from "node:crypto";
import { HttpError } from "./access";
import { chunkIds } from "./chunk";
import { prisma } from "./db";
import {
  DIRECTORY_SOURCE,
  defaultRole,
  planOrgHeads,
  normalizeSoliday,
  planSync,
  unwrap,
  type SolidayDepartment,
  type SolidayEmployee,
  type SrcDept,
  type SrcUser,
  type SyncPlan,
} from "./directory";
import { hashPassword } from "./password";

/** Soliday API 연결 설정 (.env) — 토큰은 Soliday 측에서 발급한 서비스 계정 토큰 */
export function solidayConfig() {
  const baseUrl = (process.env.SOLIDAY_BASE_URL || "https://hr.example.com").replace(/\/$/, "");
  const token = process.env.SOLIDAY_API_TOKEN || "";
  const header = process.env.SOLIDAY_AUTH_HEADER || "Authorization";
  return { baseUrl, token, header, configured: !!token };
}

/** Soliday API에서 부서·임직원을 가져온다 */
export async function fetchSoliday() {
  const cfg = solidayConfig();
  if (!cfg.configured) throw new HttpError(400, "Soliday API 토큰(SOLIDAY_API_TOKEN)이 설정되지 않았습니다. JSON 파일 업로드로 연동하세요.");
  const headers = { [cfg.header]: cfg.header.toLowerCase() === "authorization" ? `Bearer ${cfg.token}` : cfg.token, Accept: "application/json" };
  const get = async (path: string) => {
    const res = await fetch(`${cfg.baseUrl}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(20000) }).catch((e) => {
      throw new HttpError(502, `Soliday 연결 실패: ${(e as Error).message}`);
    });
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Soliday 인증 실패 — 토큰 권한을 확인하세요.");
    if (!res.ok) throw new HttpError(502, `Soliday 응답 오류 (${res.status}) ${path}`);
    return res.json();
  };
  const [d, e] = await Promise.all([get("/api/departments"), get("/api/org/employees")]);
  return { departments: unwrap<SolidayDepartment>(d, "departments"), employees: unwrap<SolidayEmployee>(e, "employees") };
}

export function parseUpload(body: { departments?: unknown; employees?: unknown }, departmentsOnly = false) {
  try {
    return {
      departments: unwrap<SolidayDepartment>(body.departments, "departments"),
      employees: departmentsOnly && !body.employees ? [] : unwrap<SolidayEmployee>(body.employees, "employees"),
    };
  } catch (e) {
    throw new HttpError(400, `파일 형식이 올바르지 않습니다: ${(e as Error).message}`);
  }
}

async function loadExisting() {
  const [departments, users] = await Promise.all([
    prisma.department.findMany({
      select: { id: true, code: true, name: true, parentId: true, order: true, active: true, externalId: true, level: true },
    }),
    prisma.user.findMany({
      select: {
        id: true, name: true, email: true, loginId: true, employeeNo: true, departmentId: true, position: true, joinDate: true, active: true,
        externalId: true, externalSource: true, employmentStatus: true,
      },
    }),
  ]);
  return { departments, users };
}

/** @param departmentsOnly true면 조직(부서) 구조만 맞추고 사람(계정)은 건드리지 않는다 */
export async function buildPlan(raw: { departments: SolidayDepartment[]; employees: SolidayEmployee[] }, departmentsOnly = false) {
  const src = normalizeSoliday(raw.departments, departmentsOnly ? [] : raw.employees);
  if (!src.departments.length) throw new HttpError(400, "부서 데이터가 비어 있습니다.");
  const plan = planSync(src, await loadExisting());
  if (departmentsOnly) plan.users = { create: [], update: [], deactivate: [] };
  return { src, plan };
}

/** 계획을 DB에 반영 */
export async function applyPlan(src: { departments: SrcDept[]; users: SrcUser[] }, plan: SyncPlan) {
  const now = new Date();
  const warnings = [...plan.warnings];
  await prisma.$transaction(
    async (tx) => {
      // 1) 부서 생성·수정 (상위 부서는 2단계에서 연결)
      for (const d of plan.departments.create) {
        await tx.department.create({
          data: { externalId: d.externalId, code: d.code, name: d.name, level: d.level, order: d.order, active: d.active, externalSource: DIRECTORY_SOURCE, lastSyncedAt: now },
        });
      }
      for (const u of plan.departments.update) {
        const d = u.src;
        await tx.department.update({
          where: { id: u.id },
          data: { externalId: d.externalId, code: d.code, name: d.name, level: d.level, order: d.order, active: d.active, externalSource: DIRECTORY_SOURCE, lastSyncedAt: now },
        });
      }
      for (const d of plan.departments.deactivate) {
        await tx.department.update({ where: { id: d.id }, data: { active: false, lastSyncedAt: now } });
      }
      // 2) 상위 부서 연결 — 상위가 그대로인 부서는 건너뛴다 (동기화마다 부서 수만큼 쓰지 않게)
      const all = await tx.department.findMany({ select: { id: true, externalId: true, code: true, parentId: true } });
      const idByExt = new Map(all.filter((d) => d.externalId).map((d) => [d.externalId!, d.id]));
      const parentOf = new Map(all.map((d) => [d.id, d.parentId]));
      for (const d of src.departments) {
        const id = idByExt.get(d.externalId);
        if (!id) continue;
        const parentId = d.parentExternalId ? idByExt.get(d.parentExternalId) ?? null : null;
        if (parentOf.get(id) === parentId) continue;
        await tx.department.update({ where: { id }, data: { parentId } });
      }
      const idByCode = new Map(all.filter((d) => d.code).map((d) => [d.code!, d.id]));

      // 3) 사용자
      const userData = (u: SrcUser) => ({
        name: u.name,
        email: u.email,
        loginId: u.loginId,
        position: u.position,
        joinDate: u.joinDate ? new Date(`${u.joinDate}T00:00:00Z`) : null,
        ...(u.employeeNo ? { employeeNo: u.employeeNo } : {}),
        departmentId: u.deptCode ? idByCode.get(u.deptCode) ?? null : null,
        active: u.active,
        deactivatedAt: u.active ? null : now,
        externalId: u.externalId,
        externalSource: DIRECTORY_SOURCE,
        employmentStatus: u.status,
        lastSyncedAt: now,
      });
      const deptNameByCode = new Map(src.departments.map((d) => [d.code, d.name]));
      for (const u of plan.users.create) {
        try {
          // 신규 계정은 기본 권한(재무회계팀 → 재무 승인, 그 외 팀원 — PM은 프로젝트 PM 지정 때 부여), 로그인 불가 상태로 생성 → 시스템 관리자가 임시 비밀번호를 발급(또는 추후 SSO)해야 로그인 가능
          await tx.user.create({
            data: {
              ...userData(u),
              role: defaultRole({ position: u.position, deptName: u.deptCode ? deptNameByCode.get(u.deptCode) ?? null : null }),
              passwordHash: hashPassword(randomBytes(24).toString("hex")),
              mustChangePassword: true,
              tempPasswordExpiresAt: new Date(0),
            },
          });
        } catch {
          warnings.push(`생성 실패(중복 아이디·사번): ${u.loginId}`);
        }
      }
      for (const u of plan.users.update) {
        try {
          await tx.user.update({ where: { id: u.id }, data: userData(u.src) });
        } catch {
          warnings.push(`수정 실패(아이디 충돌): ${u.src.loginId}`);
        }
      }
      for (const u of plan.users.deactivate) {
        await tx.user.update({ where: { id: u.id }, data: { active: false, deactivatedAt: now, lastSyncedAt: now } });
      }
      // 4) 조직장이 비어 있는 팀·본부·그룹은 팀장·본부장·그룹장으로 (시스템 관리자가 지정한 조직장은 유지)
      const heads = planOrgHeads(
        await tx.department.findMany({ select: { id: true, name: true, active: true, headId: true } }),
        await tx.user.findMany({ select: { id: true, name: true, position: true, departmentId: true, active: true } }),
      );
      for (const h of heads.assign) await tx.department.update({ where: { id: h.deptId }, data: { headId: h.userId } });
      for (const m of heads.multiple) warnings.push(`조직장 미지정: ${m.name}에 ${m.title}이 여러 명입니다 (${m.leaders.join(", ")})`);
    },
    { timeout: 120000 },
  );
  // 이번 동기화로 비활성화된 사람 중 아직 프로젝트 팀원(철수 전)인 사람 — PM이 이전 팀원으로 처리해야 정산표에서 빠진다
  const turnedOff = [...plan.users.deactivate.map((u) => u.id), ...plan.users.update.filter((u) => !u.src.active).map((u) => u.id)];
  if (turnedOff.length) {
    // D1 바인딩 한도(100) — 비활성화된 사람이 많으면 id를 나눠서
    const found = new Set<string>();
    for (const chunk of chunkIds(turnedOff)) {
      const members = await prisma.projectMember.findMany({ where: { userId: { in: chunk }, leftAt: null }, select: { userId: true }, distinct: ["userId"] });
      for (const m of members) found.add(m.userId);
    }
    if (found.size) warnings.push(`${INACTIVE_MEMBER_WARNING} ${found.size}명`);
  }
  return warnings;
}

/** 동기화 결과 안내: 프로젝트 팀원이 비활성화됨 (화면에서 이 문구로 찾아 따로 보여 준다) */
export const INACTIVE_MEMBER_WARNING = "프로젝트 팀원 중 비활성화";

/** 미리보기 응답용: 변경 예시 (시스템 관리자 화면) */
export function previewSamples(plan: SyncPlan) {
  return {
    departments: [
      ...plan.departments.create.slice(0, 15).map((d) => ({ kind: "추가", name: d.name, detail: d.code })),
      ...plan.departments.update.slice(0, 15).map((u) => ({ kind: "수정", name: u.src.name, detail: u.changes.join(", ") })),
      ...plan.departments.deactivate.slice(0, 15).map((d) => ({ kind: "사용 중지", name: d.name, detail: d.code ?? "" })),
    ],
    users: [
      ...plan.users.create.slice(0, 15).map((u) => ({ kind: "추가", name: u.name, detail: u.position ?? "" })),
      ...plan.users.update.slice(0, 15).map((u) => ({ kind: "수정", name: u.src.name, detail: u.changes.join(", ") })),
      ...plan.users.deactivate.slice(0, 15).map((u) => ({ kind: "비활성화", name: u.name, detail: "원본에 없음(퇴사 등)" })),
    ],
  };
}
