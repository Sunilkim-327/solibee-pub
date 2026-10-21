import { NextResponse } from "next/server";
import { HttpError, apiUser, audit, readJson, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { toLoginId } from "@/lib/loginid";
import { createUser, parseCsv, roleFromText } from "@/lib/users";

/**
 * CSV 일괄 등록 (시스템 관리자) — 조직도 연동 전 임시 구성용.
 * 헤더: 이름,아이디,사번,부서,직급,역할   (아이디 = 이메일 주소, '이메일' 열 이름도 가능 · 부서는 부서명 또는 부서코드)
 * 이미 있는 아이디는 건너뛴다. 결과로 행별 성공/실패와 임시 비밀번호를 돌려준다.
 */
export const POST = route(async (req) => {
  const admin = await apiUser(["ADMIN"]);
  const { csv } = await readJson<{ csv?: string }>(req);
  const rows = parseCsv(csv ?? "");
  if (rows.length < 2) throw new HttpError(400, "헤더와 1행 이상의 데이터가 필요합니다.");
  if (rows.length > 501) throw new HttpError(400, "한 번에 500명까지 등록할 수 있습니다.");

  const head = rows[0].map((h) => h.replace(/\s/g, ""));
  const col = (name: string) => head.indexOf(name);
  const idCol = col("아이디") >= 0 ? col("아이디") : col("이메일");
  const idx = { name: col("이름"), email: idCol, no: col("사번"), dept: col("부서"), pos: (col("직급") >= 0 ? col("직급") : col("직위")), role: col("역할") };
  if (idx.name < 0 || idx.email < 0 || idx.role < 0) throw new HttpError(400, "헤더에 이름, 아이디, 역할 열이 필요합니다.");

  // 부서·기존 아이디·사번을 한 번에 읽어 행마다 조회하지 않는다 (등록하면서 함께 갱신)
  const [depts, existing] = await Promise.all([
    prisma.department.findMany({ select: { id: true, code: true, name: true } }),
    prisma.user.findMany({ select: { loginId: true, employeeNo: true } }),
  ]);
  const known = {
    loginIds: new Set(existing.flatMap((u) => (u.loginId ? [u.loginId] : []))),
    employeeNos: new Set(existing.flatMap((u) => (u.employeeNo ? [u.employeeNo] : []))),
    departmentIds: new Set(depts.map((d) => d.id)),
  };
  const results: { row: number; name: string; email: string; ok: boolean; message: string; tempPassword?: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (j: number) => (j >= 0 ? r[j] ?? "" : "");
    const name = get(idx.name);
    const email = toLoginId(get(idx.email));
    try {
      const deptText = get(idx.dept);
      const dept = deptText ? depts.find((d) => d.code === deptText || d.name === deptText) : undefined;
      if (deptText && !dept) throw new HttpError(400, `부서를 찾을 수 없습니다: ${deptText}`);
      const role = roleFromText(get(idx.role));
      if (!role) throw new HttpError(400, `역할을 알 수 없습니다: ${get(idx.role)} (시스템 관리자/재무 승인/프로젝트 PM/팀원)`);
      if (known.loginIds.has(email)) {
        results.push({ row: i + 1, name, email, ok: false, message: "이미 등록됨 — 건너뜀" });
        continue;
      }
      const { user, tempPassword } = await createUser(
        { name, loginId: email, role, employeeNo: get(idx.no), position: get(idx.pos), departmentId: dept?.id ?? null },
        known,
      );
      if (user.loginId) known.loginIds.add(user.loginId);
      if (user.employeeNo) known.employeeNos.add(user.employeeNo);
      results.push({ row: i + 1, name: user.name, email: user.loginId ?? email, ok: true, message: "등록", tempPassword });
    } catch (e) {
      results.push({ row: i + 1, name, email, ok: false, message: e instanceof HttpError ? e.message : "오류" });
    }
  }
  const created = results.filter((r) => r.ok).length;
  await audit(admin, { entity: "User", entityId: "import", action: "import", data: { created, total: results.length } });
  return NextResponse.json({ created, results });
});
