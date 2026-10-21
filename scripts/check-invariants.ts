// 파생·중복 저장값 불변식 점검 — 읽기 전용, 출력만 (설계 검토(2026-10-14) 정보구조 D)
// 사용: pnpm check:invariants [DB 파일 경로]   (기본 prisma/dev.db — 고치지 않는다)
// 운영(D1)은 보고서의 "D1 확인 쿼리"로 따로 본다.
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { pmInvariantViolations } from "../lib/pm";
import { originalEndDate } from "../lib/change-extension";
import { referencedPartners } from "../lib/partners";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.resolve(root, process.argv[2] ?? "prisma/dev.db");
if (!existsSync(file)) {
  console.error(`DB 파일이 없습니다: ${file}`);
  process.exit(1);
}
const db = new DatabaseSync(file, { readOnly: true });
const all = <T>(sql: string) => db.prepare(sql).all() as T[];
const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
let problems = 0;
const section = (title: string, n: number) => {
  problems += n;
  console.log(`\n[${n ? "문제" : "정상"}] ${title}: ${n}건`);
};

console.log(`점검 DB: ${file}`);

// 1. User.role=MANAGER ↔ ProjectMember.isPm (lib/pm.ts pmRoleChange로 맞추는 두 소스)
const users = all<{ id: string; name: string; role: string; pmAutoGranted: number }>(`SELECT "id", "name", "role", "pmAutoGranted" FROM "User"`);
const members = all<{ userId: string; isPm: number }>(`SELECT "userId", "isPm" FROM "ProjectMember"`);
const pmBad = pmInvariantViolations(users.map((u) => ({ ...u, pmAutoGranted: !!u.pmAutoGranted })), members.map((m) => ({ userId: m.userId, isPm: !!m.isPm })));
section("PM 역할 ↔ PM 지정 불일치", pmBad.length);
for (const v of pmBad) console.log(`  - ${v.kind} ${v.name}(${v.userId}) role=${v.role} PM 지정 프로젝트 ${v.pmProjects}개`);

// 2. Expense.isHq는 항상 payMethod === "HQ" (lib/expenses.ts)
const hqBad = count(`SELECT COUNT(*) n FROM "Expense" WHERE ("payMethod" = 'HQ') <> ("isHq" = 1)`);
section("Expense.isHq ≠ (payMethod='HQ')", hqBad);

// 3. 변경계약 연장 ↔ Project.endDate (원 종료일은 ContractChange.extendedFrom에 보존)
const projects = all<{ id: string; name: string; endDate: number | string }>(`SELECT "id", "name", "endDate" FROM "Project"`);
const changes = all<{ projectId: string; seq: number; endDate: number | string; extendedFrom: number | string | null }>(`SELECT "projectId", "seq", "endDate", "extendedFrom" FROM "ContractChange"`);
const toDate = (v: number | string) => (typeof v === "number" ? new Date(v) : new Date(v));
let extBad = 0;
const extLines: string[] = [];
for (const p of projects) {
  const mine = changes.filter((c) => c.projectId === p.id);
  const end = toDate(p.endDate);
  // 연장 과업의 종료일이 본계약 종료일을 넘으면 덮어쓰기가 빠진 것
  for (const c of mine) if (toDate(c.endDate) > end) { extBad++; extLines.push(`  - ${p.name}: 변경 ${c.seq}차 종료일 ${toDate(c.endDate).toISOString().slice(0, 10)} > 본계약 ${end.toISOString().slice(0, 10)}`); }
  const original = originalEndDate(end, mine.map((c) => ({ extendedFrom: c.extendedFrom == null ? null : toDate(c.extendedFrom) })));
  if (original.getTime() !== end.getTime()) console.log(`  (참고) ${p.name}: 원 종료일 ${original.toISOString().slice(0, 10)} → 연장된 종료일 ${end.toISOString().slice(0, 10)}`);
}
section("변경계약 과업 종료일 > 본계약 종료일", extBad);
for (const l of extLines) console.log(l);

// 4. 협력 인력: 지출 참석자에 기록이 있는데 명단에 없는 사람은 찾을 수 없다(이름 문자열) — 비활성 인력 중 기록 없는 사람만 참고로
const partners = all<{ id: string; projectId: string; name: string; company: string | null; active: number }>(`SELECT "id", "projectId", "name", "company", "active" FROM "ProjectPartner"`);
const inactive = partners.filter((p) => !p.active);
if (inactive.length) {
  const attendees = all<{ projectId: string; attendees: string | null }>(`SELECT "projectId", "attendees" FROM "Expense" WHERE "attendees" IS NOT NULL`);
  const byProject = new Map<string, (string | null)[]>();
  for (const a of attendees) byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a.attendees]);
  const referenced = new Set(partners.map((p) => referencedPartners([p], byProject.get(p.projectId) ?? [])).flat().map((p) => p.id));
  const unreferenced = inactive.filter((p) => !referenced.has(p.id));
  console.log(`\n(참고) 협력 인력 ${partners.length}명 중 사용 안 함 ${inactive.length}명, 그중 지출 기록 없음(삭제 가능) ${unreferenced.length}명`);
}

// 5. 이전 방식 출입증(ClientPassUsage) 남은 행 — 이관·제거 추적
const legacy = all<{ projectId: string; n: number; a: string; b: string }>(`SELECT "projectId", COUNT(*) n, MIN("yearMonth") a, MAX("yearMonth") b FROM "ClientPassUsage" GROUP BY "projectId"`);
console.log(`\n(참고) ClientPassUsage 남은 행: ${legacy.reduce((s, r) => s + r.n, 0)}건` + (legacy.length ? ` — ${legacy.map((r) => `${r.projectId.slice(0, 8)}… ${r.n}건(${r.a}~${r.b})`).join(", ")}` : ""));

db.close();
console.log(`\n합계: 문제 ${problems}건`);
process.exit(problems ? 2 : 0);
