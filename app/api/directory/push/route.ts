// Soliday 화면(로그인된 브라우저)에서 조직도를 보내 받는 엔드포인트 — 북마클릿 전용
// 인증: 시스템 관리자가 발급한 10분짜리 용도 한정 토큰(1회용). CORS는 Soliday 출처만 허용.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { solidayConfig } from "@/lib/directory-sync";
import { readPurposeTokenData } from "@/lib/session";

const MAX_BYTES = 5 * 1024 * 1024;

/** 본문을 실제로 읽은 바이트 수로 제한 (Content-Length 위조·청크 전송 대비). 초과 시 null */
async function readLimited(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = new URL(solidayConfig().baseUrl).origin;
  return {
    "Access-Control-Allow-Origin": origin === allowed ? allowed : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // Chrome 사설망 접근(공개 사이트 → localhost) 사전 요청 허용
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}

type AnyRec = Record<string, unknown>;
const obj = (v: unknown) => (v && typeof v === "object" ? (v as AnyRec) : {});
/** 문자열만 받고 길이를 자른다 (다른 타입은 null) */
const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : null);
/** 정수·숫자 문자열만 (다른 타입은 null) */
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);
const MAX_DEPARTMENTS = 5000;
const MAX_EMPLOYEES = 50000;

type Fail = (status: number, error: string) => Response;

export async function POST(req: Request) {
  let headers: Record<string, string> = {};
  const fail: Fail = (status, error) => NextResponse.json({ error }, { status, headers });
  try {
    headers = { ...cors(req), "Cache-Control": "no-store, private" };
    return await receive(req, headers, fail);
  } catch (err) {
    console.error(err);
    return fail(500, "서버 오류가 발생했습니다.");
  }
}

async function receive(req: Request, headers: Record<string, string>, fail: Fail) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, "데이터가 너무 큽니다.");
  const text = await readLimited(req, MAX_BYTES).catch(() => "");
  if (text === null) return fail(413, "데이터가 너무 큽니다.");
  let body: AnyRec;
  try {
    body = obj(JSON.parse(text));
  } catch {
    return fail(400, "잘못된 요청 형식입니다.");
  }
  const tok = readPurposeTokenData(String(body.token ?? ""), "directory-push");
  const uid = tok?.uid;
  if (!tok || !uid) return fail(401, "전송 링크가 만료되었거나 올바르지 않습니다. 시스템 관리자 화면에서 새로 만드세요.");
  const admin = await prisma.user.findUnique({ where: { id: uid } });
  if (!admin || !admin.active || admin.role !== "ADMIN") return fail(403, "시스템 관리자 권한이 필요합니다.");

  const deps = Array.isArray(body.departments) ? body.departments : [];
  const emps = Array.isArray(body.employees) ? body.employees : [];
  if (!deps.length || !emps.length) return fail(400, "부서·임직원 데이터가 비어 있습니다.");
  if (deps.length > MAX_DEPARTMENTS || emps.length > MAX_EMPLOYEES) return fail(413, "데이터가 너무 큽니다.");
  if (deps.some((d) => !d || typeof d !== "object") || emps.some((e) => !e || typeof e !== "object")) return fail(400, "데이터 형식이 올바르지 않습니다.");

  // 필요한 필드만 보관 (휴대폰·입사일 등은 버림)
  const departments = deps.map((d) => {
    const x = obj(d);
    return {
      id: txt(x.id), departmentCode: txt(x.departmentCode), departmentName: txt(x.departmentName),
      departmentLevel: num(x.departmentLevel), departmentOrder: num(x.departmentOrder), parentId: txt(x.parentId), hidden: !!x.hidden,
    };
  });
  const employees = emps.map((e) => {
    const x = obj(e);
    return {
      id: txt(x.id), fullName: txt(x.fullName), emailAddress: txt(x.emailAddress), employeeNumber: txt(x.employeeNumber),
      employeeStatus: txt(x.employeeStatus),
      department: x.department ? { departmentCode: txt(obj(x.department).departmentCode) } : null,
      title: x.title ? { titleName: txt(obj(x.title).titleName) } : null,
    };
  });

  // 전송 링크는 1회만 사용 (jti 기록이 이미 있으면 거부). 저장과 같은 트랜잭션으로
  let saved;
  try {
    [, saved] = await prisma.$transaction([
      prisma.usedToken.create({ data: { jti: tok.jti } }),
      prisma.directoryImport.create({
        data: {
          departments: JSON.stringify(departments),
          employees: JSON.stringify(employees),
          deptCount: departments.length,
          userCount: employees.length,
          createdBy: admin.id,
        },
      }),
    ]);
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return fail(409, "이미 사용한 전송 링크입니다. 시스템 관리자 화면에서 새로 만드세요.");
    throw err;
  }
  // 만료된 사용 기록 정리 (토큰 유효시간 10분 → 하루 지난 기록은 불필요)
  await prisma.usedToken.deleteMany({ where: { usedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } }).catch(() => {});
  await prisma.auditLog.create({
    data: { entity: "Directory", entityId: saved.id, action: "push", userId: admin.id, data: JSON.stringify({ departments: departments.length, employees: employees.length }) },
  });
  return NextResponse.json({ ok: true, departments: departments.length, employees: employees.length }, { headers });
}
