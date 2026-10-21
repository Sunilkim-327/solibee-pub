// 분류/항목 마스터 + 데모 프로젝트·계정·예산·지출 시드
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { addMonths } from "../lib/format";
import { checkPolicy, encodeFlags } from "../lib/policy";
import { copyItems } from "../lib/items";
import { defaultRole, planOrgHeads } from "../lib/directory";

const prisma = new PrismaClient();

const CATEGORIES = [
  {
    id: "office",
    name: "사무환경구축",
    items: [
      ["office-supplies", "사무용품", "소모품비", "문구,토너,복사용지,소모품,포스트잇"],
      ["office-equip", "비품구매", "비품", "모니터,키보드,마우스,의자,거치대,허브"],
      ["office-book", "도서구입", "도서인쇄비", "도서,책,교재,서적"],
      ["office-sw", "소프트웨어구독", "지급수수료", "구독,라이선스,saas,figma,notion,slack,github,jira"],
    ],
  },
  {
    id: "ops",
    name: "프로젝트운영",
    items: [
      ["ops-pm", "PM운영비", "복리후생비", "운영비"],
      ["ops-night", "야근식대", "복리후생비", "야근,석식,저녁식사,식당,김밥,배달,도시락,분식"],
      ["ops-night-taxi", "야근교통비", "여비교통비", "택시,카카오T,귀가,심야"],
      ["ops-meeting", "회의비", "회의비", "회의,미팅,거래처,고객사"],
      ["ops-snack", "간식비", "복리후생비", "간식,커피,음료,다과"],
    ],
  },
  {
    id: "event",
    name: "행사비",
    items: [
      ["event-dinner", "회식비", "복리후생비", "회식"],
      ["event-workshop", "워크숍", "복리후생비", "워크숍,워크샵,세미나"],
    ],
  },
  {
    id: "trip",
    name: "출장비",
    items: [
      ["trip-transport", "교통비", "여비교통비", "택시,ktx,srt,기차,주차,주유,버스,항공"],
      ["trip-lodging", "숙박비", "여비교통비", "숙박,호텔"],
      ["trip-meal", "출장식대", "여비교통비", "출장"],
    ],
  },
  { id: "etc", name: "기타", items: [["etc-misc", "기타", "잡비", ""]] },
] as const;

// 결정적 의사난수 (시드 재실행 시 동일 데이터)
let s = 42;
const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const amt = (min: number, max: number) => Math.round((min + rand() * (max - min)) / 100) * 100;

async function main() {
  // 데이터 보호: 이미 데이터가 있는 DB는 지우지 않는다. 데모로 초기화하려면 pnpm db:reset (자동 백업 후 초기화)
  const existing = await prisma.user.count().catch(() => 0);
  if (existing > 0 && !process.argv.includes("--reset")) {
    console.error(`DB에 이미 데이터가 있습니다 (사용자 ${existing}명). 입력한 데이터를 지우지 않도록 시드를 중단합니다.
데모 데이터로 초기화하려면: pnpm db:reset  (초기화 전에 prisma/backups/에 자동 백업)`);
    process.exit(1);
  }
  if (existing > 0) {
    const { backupDb } = await import("../scripts/db-backup.mjs");
    const file = await backupDb("before-reset");
    console.log(`초기화 전 백업: ${file}`);
  }
  await prisma.auditLog.deleteMany();
  await prisma.changeItem.deleteMany();
  await prisma.contractChange.deleteMany();
  await prisma.clientPassUsage.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.monthlyClosing.deleteMany();
  await prisma.budgetLine.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.projectSeries.deleteMany();
  await prisma.item.deleteMany();
  await prisma.category.deleteMany();
  await prisma.department.updateMany({ data: { parentId: null, headId: null } });
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.directoryImport.deleteMany();

  for (const [ci, c] of CATEGORIES.entries()) {
    await prisma.category.create({ data: { id: c.id, name: c.name, order: ci } });
    for (const [ii, [id, name, accountCode, keywords]] of c.items.entries()) {
      // 공통 기본 항목 (projectId 없음) — 새 프로젝트 생성 시 복사되는 템플릿
      await prisma.item.create({ data: { id, code: id, categoryId: c.id, name, accountCode, keywords, order: ii } });
    }
  }

  // 규정 예시: 야근식대 1인당 1.2만원(결제자 본인 1명분), 회식비 1인당 5만원 (야근교통비는 한도 없음)
  await prisma.item.update({ where: { id: "ops-night" }, data: { perPersonLimit: 12000 } });
  await prisma.item.update({ where: { id: "event-dinner" }, data: { perPersonLimit: 50000 } });
  await prisma.item.update({ where: { id: "office-equip" }, data: { hardBudget: true } });

  // 임시 조직도 (회사 조직도 연동 전) — code는 추후 외부 부서코드와 매핑
  const dept = async (name: string, code: string, parentId: string | null, order: number) =>
    (await prisma.department.create({ data: { name, code, parentId, order } })).id;
  const co = await dept("데모주식회사", "D000", null, 0);
  const mgmt = await dept("경영지원본부", "D100", co, 0);
  const fin = await dept("재무팀", "D110", mgmt, 0);
  const it = await dept("IT운영팀", "D120", mgmt, 1);
  // 경영지원본부·재무팀·IT운영팀은 직원은 있지만 프로젝트는 두지 않는 조직 (체계도 미사용)
  await prisma.department.updateMany({ where: { id: { in: [mgmt, fin, it] } }, data: { epsEnabled: false } });
  const biz = await dept("사업본부", "D200", co, 1);
  const plat = await dept("플랫폼사업팀", "D210", biz, 0);
  const data = await dept("데이터사업팀", "D220", biz, 1);

  // Soliday에서 가져온 회사 조직(부서) 구조 — prisma/data/soliday-departments.json (있을 때만, 사람은 제외)
  const solidayFile = path.join(__dirname, "data", "soliday-departments.json");
  if (fs.existsSync(solidayFile)) {
    const list = (JSON.parse(fs.readFileSync(solidayFile, "utf8")).departments ?? []) as {
      id: string; departmentCode: string; departmentName: string; departmentLevel: number; departmentOrder: number; parentId: string | null; hidden: boolean;
    }[];
    const idByExt = new Map<string, string>();
    for (const d of list) {
      const created = await prisma.department.create({
        data: { name: d.departmentName, code: d.departmentCode, externalId: d.id, level: d.departmentLevel, order: d.departmentOrder, active: !d.hidden, externalSource: "soliday", lastSyncedAt: new Date() },
      });
      idByExt.set(d.id, created.id);
    }
    for (const d of list) {
      if (d.parentId && idByExt.has(d.parentId)) {
        await prisma.department.update({ where: { id: idByExt.get(d.id)! }, data: { parentId: idByExt.get(d.parentId)! } });
      }
    }
  }

  // Soliday 조직도 임직원 — prisma/data/soliday-employees.txt (있을 때만)
  // 형식: 부서코드|성명|직급|이메일 @ 앞부분|입사일(YYYY-MM-DD, 없으면 빈칸)[|L=휴직]
  // 화면에 보이는 정보 기준이라 사번·연동키는 비어 있다 → 추후 Soliday 연동 시 아이디로 매칭되어 채워진다.
  // 로그인은 관리자가 임시 비밀번호를 발급해야 가능. 권한: 재무회계팀 → 재무팀, 그 외 팀원 (PM은 프로젝트 PM 지정 때 부여)
  const peopleFile = path.join(__dirname, "data", "soliday-employees.txt");
  if (fs.existsSync(peopleFile)) {
    const allDepts = await prisma.department.findMany({ select: { id: true, code: true, name: true } });
    const deptIdByCode = new Map(allDepts.map((d) => [d.code, d.id]));
    const deptNameByCode = new Map(allDepts.map((d) => [d.code, d.name]));
    const locked = hashPassword(randomBytes(24).toString("hex"));
    const rows = fs.readFileSync(peopleFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    await prisma.user.createMany({
      data: rows.map((line) => {
        const [code, name, position, localPart, joinDate, flag] = line.split("|");
        const status = flag === "L" ? "ON_LEAVE" : "ACTIVE";
        return {
          name, loginId: `${localPart}@example.com`, email: `${localPart}@example.com`, position: position || null, role: defaultRole({ position: position || null, deptName: deptNameByCode.get(code) ?? null }),
          joinDate: joinDate ? new Date(`${joinDate}T00:00:00Z`) : null,
          departmentId: deptIdByCode.get(code) ?? null,
          passwordHash: locked, mustChangePassword: true, tempPasswordExpiresAt: new Date(0),
          externalSource: "soliday", employmentStatus: status, lastSyncedAt: new Date(),
        };
      }),
    });
  }

  // 데모 계정은 비밀번호 password123 (첫 로그인 변경 강제 없음)
  const pw = hashPassword("password123");
  const mk = (name: string, email: string, role: string, employeeNo: string, departmentId: string, position: string) =>
    prisma.user.create({ data: { name, email, loginId: email, role, passwordHash: pw, employeeNo, departmentId, position } });
  const admin = await mk("시스템관리자", "admin@opex.local", "ADMIN", "E0001", it, "책임");
  const pm = await mk("김하늘", "pm@opex.local", "MANAGER", "E1001", plat, "팀장");
  const m1 = await mk("이서준", "member1@opex.local", "MEMBER", "E1002", plat, "선임");
  const m2 = await mk("박지민", "member2@opex.local", "MEMBER", "E1003", plat, "사원");
  const m3 = await mk("최유나", "member3@opex.local", "MEMBER", "E1004", plat, "사원");
  const hq = await mk("정재무", "hq@opex.local", "HQ", "E2001", fin, "팀장");
  await mk("한재경", "finance2@opex.local", "HQ", "E2002", fin, "선임");
  const pm2 = await mk("윤서진", "pm2@opex.local", "MANAGER", "E3001", data, "팀장");
  const m4 = await mk("한도윤", "member4@opex.local", "MEMBER", "E3002", data, "선임");
  // 서브 프로젝트 PM: 원래 팀원이었으나 PM 지정으로 PM 권한이 자동 부여된 예시
  const pm3 = await prisma.user.create({
    data: { name: "서하준", email: "pm3@opex.local", loginId: "pm3@opex.local", role: "MANAGER", pmAutoGranted: true, passwordHash: pw, employeeNo: "E1005", departmentId: plat, position: "책임" },
  });
  const m5 = await mk("강민서", "member5@opex.local", "MEMBER", "E1006", plat, "사원");
  // 조직장: 사업본부 본부장 — 본부 아래 모든 팀의 프로젝트를 조회·취합 (프로젝트 구성원 아님)
  const head = await mk("임도윤", "head@opex.local", "MEMBER", "E0100", biz, "본부장");
  await prisma.department.update({ where: { id: biz }, data: { headId: head.id } });
  await prisma.department.update({ where: { id: plat }, data: { headId: pm.id } });
  // 조직장 수동 지정 (자동 규칙 예외) — prisma/data/soliday-heads.txt: 부서코드|아이디
  const headsFile = path.join(__dirname, "data", "soliday-heads.txt");
  if (fs.existsSync(headsFile)) {
    for (const line of fs.readFileSync(headsFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))) {
      const [code, loginId] = line.split("|");
      const [dept, head] = await Promise.all([prisma.department.findFirst({ where: { code } }), prisma.user.findUnique({ where: { loginId } })]);
      if (dept && head) await prisma.department.update({ where: { id: dept.id }, data: { headId: head.id } });
      else console.warn(`조직장 수동 지정 건너뜀: ${line}`);
    }
  }
  // 조직장 = 팀장(팀)·본부장(본부)·그룹장(그룹), 1명일 때만 (이미 지정된 조직은 유지). 그 외 예외는 관리자가 직접 지정
  const heads = planOrgHeads(
    await prisma.department.findMany({ select: { id: true, name: true, active: true, headId: true } }),
    await prisma.user.findMany({ select: { id: true, name: true, position: true, departmentId: true, active: true } }),
  );
  for (const h of heads.assign) await prisma.department.update({ where: { id: h.deptId }, data: { headId: h.userId } });
  console.log(`조직장 지정 ${heads.assign.length}개 · 팀장 없음 ${heads.noLeader.length} · 여러 명 ${heads.multiple.length} · 직급 불일치 ${heads.mismatched.length}`);

  // 연속 사업: 플랫폼 운영 1차(25.12~26.11) → 2차(26.12~27.11). 연차별 계약은 각각 정산하고 묶어서 본다
  const platSeries = await prisma.projectSeries.create({ data: { name: "플랫폼 운영" } });
  const project = await prisma.project.create({
    data: {
      name: "플랫폼 운영 1차",
      code: "PRJ-2025-01",
      seriesId: platSeries.id,
      round: 1,
      departmentId: plat,
      startDate: new Date("2025-12-01T00:00:00Z"),
      endDate: new Date("2026-11-30T00:00:00Z"),
      fiscalStart: 12,
    },
  });
  const project2 = await prisma.project.create({
    data: {
      name: "데이터허브 구축",
      code: "PRJ-2026-03",
      departmentId: data,
      startDate: new Date("2026-03-01T00:00:00Z"),
      endDate: new Date("2027-02-28T00:00:00Z"),
      fiscalStart: 3,
      members: { create: [{ userId: pm2.id, isPm: true }, { userId: m4.id }, { userId: m3.id }] },
    },
  });

  // 프로젝트별 항목: 공통 기본 항목을 복사해 시작 (프로젝트마다 다르게 관리 가능)
  await copyItems(prisma, project.id, null, (it) => `p1-${it.id}`);
  await copyItems(prisma, project2.id, null, (it) => `p2-${it.id}`);
  // 데이터허브 프로젝트는 자체 항목 하나 추가 (프로젝트별 항목 차이 예시)
  await prisma.item.create({
    data: { id: "p2-ops-cloud", code: "ops-cloud", projectId: project2.id, categoryId: "ops", name: "클라우드 사용료", accountCode: "지급수수료", keywords: "aws,gcp,azure,클라우드", order: 9 },
  });
  const P1 = (id: string) => `p1-${id}`;
  const P2 = (id: string) => `p2-${id}`;

  // 최유나는 2월 신규 결제자 (엑셀의 "팀원 추가 시 정산표 수동 수정" 사례)
  await prisma.projectMember.createMany({
    data: [pm, m1, m2, m3].map((u) => ({ projectId: project.id, userId: u.id, isPayer: true, isPm: u === pm })),
  });

  const budget: [string, string, number, number][] = [
    ["office-supplies", "사무용품 일괄 구매", 1000000, 1],
    ["office-equip", "모니터·주변기기", 2000000, 1],
    ["office-book", "기술 도서", 50000, 12],
    ["office-sw", "협업툴 구독 (Figma·Notion)", 120000, 12],
    ["ops-pm", "PM 월 운영비", 300000, 12],
    ["ops-night", "야근식대 (팀원)", 200000, 12],
    ["ops-night-taxi", "야근 후 귀가 교통비 (팀원)", 80000, 12],
    ["ops-meeting", "고객사 회의비", 150000, 12],
    ["ops-snack", "팀 간식", 100000, 12],
    ["event-dinner", "분기 회식", 400000, 4],
    ["event-workshop", "상반기 워크숍", 1500000, 1],
    ["trip-transport", "고객사 방문 교통비", 100000, 12],
    ["trip-lodging", "지방 출장 숙박", 300000, 4],
    ["etc-misc", "예비비", 300000, 1],
  ];
  await prisma.budgetLine.createMany({
    data: budget.map(([itemId, detail, unitPrice, periods], order) => ({
      projectId: project.id,
      itemId: P1(itemId),
      detail,
      unitPrice,
      periods,
      planned: unitPrice * periods,
      order,
    })),
  });


  // PM 설정: 팀원에게 노출할 항목
  await prisma.memberItem.createMany({
    data: ["ops-night", "ops-night-taxi"].map((itemId) => ({ projectId: project.id, itemId: P1(itemId) })),
  });

  // [항목, 세부내역, 최소, 최대]
  type T = [string, string, number, number];
  const memberTemplates: T[] = [
    ["ops-night", "야근 석식", 9000, 12000],
    ["ops-night", "배포 작업 야근 저녁식사", 8000, 12000],
    ["ops-night-taxi", "야근 후 귀가 택시", 15000, 38000],
  ];
  const pmTemplates: [string, string, number, number, string?][] = [
    ["ops-pm", "PM운영비 - 팀 점심", 60000, 150000],
    ["ops-meeting", "고객사 미팅 다과", 20000, 80000, "㈜가나솔루션 김과장, 이대리"],
    ["ops-snack", "팀 커피·간식", 15000, 45000],
    ["trip-transport", "고객사 방문 택시", 8000, 25000, "㈜가나솔루션 김과장"],
    ["office-book", "기술 도서 구매", 25000, 48000],
  ];

  const months = Array.from({ length: 11 }, (_, i) => addMonths("2025-12", i)); // 2025-12 ~ 2026-10
  const expenses = [];
  const push = (ym: string, day: number, payer: { id: string; name: string }, itemId: string, detail: string, amount: number, people: string[]) =>
    expenses.push({
      projectId: project.id,
      payerId: payer.id,
      date: new Date(`${ym}-${String(day).padStart(2, "0")}T00:00:00Z`),
      amount,
      payMethod: "PERSONAL_CARD",
      itemId,
      detail,
      headcount: people.length,
      attendees: people.join(", "),
      yearMonth: ym,
      createdBy: payer.id,
    });
  for (const ym of months) {
    const team = ym < "2026-02" ? [m1, m2] : [m1, m2, m3]; // 최유나는 2월 합류
    const maxDay = ym === "2026-10" ? 8 : 27;
    const day = () => 1 + Math.floor(rand() * maxDay);
    // 팀원 입력: 개인식법인카드, 노출 항목만
    for (let i = 0, n = ym === "2026-10" ? 4 : 6 + Math.floor(rand() * 4); i < n; i++) {
      const [itemId, detail, min, max] = pick(memberTemplates);
      const payer = pick(team);
      const others = team.filter((t) => t !== payer && rand() < 0.5);
      // 야근식대·야근교통비는 결제자 본인 몫만 (한 사람이 여러 팀원 몫을 한 번에 결제하지 않음). others는 난수 순서 유지용
      void others;
      const people = [payer.name];
      push(ym, day(), payer, itemId, detail, amt(min, max), people);
    }
    // PM 별도 입력
    for (let i = 0, n = ym === "2026-10" ? 1 : 2 + Math.floor(rand() * 2); i < n; i++) {
      const [itemId, detail, min, max, client] = pick(pmTemplates);
      const people = client ? [pm.name, client] : [pm.name, ...team.map((t) => t.name)];
      push(ym, day(), pm, itemId, detail, amt(min, max), people);
    }
    // 공용법인카드: 협업툴 구독 (PM 보관)
    expenses.push({
      projectId: project.id,
      payerId: pm.id,
      date: new Date(`${ym}-05T00:00:00Z`),
      amount: 118000,
      payMethod: "SHARED_CARD",
      itemId: "office-sw",
      detail: "Figma·Notion 월 구독료",
      headcount: team.length + 1,
      attendees: `팀 공용 (${[pm, ...team].map((t) => t.name).join(", ")})`,
      yearMonth: ym,
      createdBy: pm.id,
    });
  }
  const once = (ym: string, day: number, payer: { id: string }, payMethod: string, itemId: string, detail: string, amount: number, headcount?: number) =>
    expenses.push({
      projectId: project.id,
      payerId: payer.id,
      date: new Date(`${ym}-${String(day).padStart(2, "0")}T00:00:00Z`),
      amount,
      payMethod,
      isHq: payMethod === "HQ",
      itemId,
      detail,
      headcount: headcount ?? null,
      attendees: headcount ? [pm, m1, m2, m3].slice(0, headcount).map((u) => u.name).join(", ") : null,
      yearMonth: ym,
      createdBy: payer.id,
    });
  once("2025-12", 10, hq, "HQ", "office-equip", "모니터 4대 (본사 일괄구매)", 1520000);
  once("2025-12", 12, hq, "HQ", "office-supplies", "사무용품 일괄 구매", 684000);
  once("2025-12", 20, pm, "PERSONAL_CARD", "event-dinner", "킥오프 회식", 412000, 4);
  once("2026-03", 27, pm, "PERSONAL_CARD", "event-dinner", "1분기 회식", 386000, 5);
  once("2026-05", 15, hq, "HQ", "event-workshop", "상반기 워크숍 (가평)", 1380000, 5);
  once("2026-06", 11, pm, "PERSONAL_CARD", "trip-lodging", "부산 고객사 출장 숙박", 168000, 1);
  once("2026-06", 11, pm, "PERSONAL_CARD", "trip-transport", "부산 출장 KTX 왕복", 119600, 1);
  once("2026-06", 26, pm, "PERSONAL_CARD", "event-dinner", "2분기 회식", 445000, 5);
  once("2026-09", 25, pm, "PERSONAL_CARD", "event-dinner", "3분기 회식", 398000, 5);

  await prisma.expense.createMany({ data: expenses.map((e) => ({ ...e, itemId: P1(e.itemId) })) });

  // 마감 이력: 2025-12 ~ 2026-07 승인, 2026-08 상신, 2026-09 반려, 2026-10 작성중
  for (const ym of months) {
    let status = "APPROVED";
    if (ym === "2026-08") status = "SUBMITTED";
    else if (ym === "2026-09") status = "REJECTED";
    else if (ym === "2026-10") continue;
    const closedAt = new Date(`${addMonths(ym, 1)}-03T09:00:00Z`);
    await prisma.monthlyClosing.create({
      data: {
        projectId: project.id,
        yearMonth: ym,
        status,
        closedAt,
        submittedAt: closedAt,
        reviewedAt: status === "SUBMITTED" ? null : new Date(`${addMonths(ym, 1)}-07T09:00:00Z`),
        reviewedBy: status === "SUBMITTED" ? null : hq.id,
        reviewNote: status === "REJECTED" ? "회식비 참석자 명단 누락 — 보완 후 재상신 바랍니다." : null,
      },
    });
  }

  // ── 두 번째 프로젝트 (재무팀 전체 현황 비교용) ──
  await prisma.budgetLine.createMany({
    data: ([
      ["ops-pm", "PM 월 운영비", 200000, 12],
      ["ops-night", "야근식대 (팀원)", 150000, 12],
      ["ops-night-taxi", "야근 교통비 (팀원)", 60000, 12],
      ["ops-meeting", "고객 워크숍·회의", 100000, 12],
      ["office-sw", "분석 도구 라이선스", 300000, 12],
      ["ops-cloud", "데이터 적재용 클라우드", 400000, 12],
    ] as [string, string, number, number][]).map(([itemId, detail, unitPrice, periods], order) => ({
      projectId: project2.id, itemId: P2(itemId), detail, unitPrice, periods, planned: unitPrice * periods, order,
    })),
  });
  await prisma.memberItem.createMany({ data: ["ops-night", "ops-night-taxi"].map((itemId) => ({ projectId: project2.id, itemId: P2(itemId) })) });

  // ── 업체 출입증: 데이터허브는 고객사 출입증으로 야근 식사·커피 결제 (개인카드 정산과 별도 집계) ──
  // 야근식대 1인 12,000원 → 식당 + 카페를 같은 항목으로 합산해 한도 점검
  await prisma.project.update({ where: { id: project2.id }, data: { clientPassEnabled: true, clientPassName: "고객사 출입증" } });
  await prisma.item.update({ where: { id: P2("ops-night") }, data: { perPersonLimit: 12000 } });
  const passRows: Prisma.ClientPassUsageCreateManyInput[] = [];
  for (const ym of ["2026-08", "2026-09", "2026-10"]) {
    for (const u of [m4, m3, pm2]) {
      for (let i = 0, n = ym === "2026-10" ? 2 : 3 + Math.floor(rand() * 3); i < n; i++) {
        const lastDay = ym === "2026-10" ? 9 : 28;
        let date = new Date(`${ym}-${String(1 + Math.floor(rand() * lastDay)).padStart(2, "0")}T00:00:00Z`);
        while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date = new Date(date.getTime() - 86400000);
        if (passRows.some((r) => r.userId === u.id && +r.date === +date)) continue;
        const meal = 7000 + Math.floor(rand() * 6) * 500; // 7,000 ~ 9,500
        const base = { projectId: project2.id, userId: u.id, createdBy: u.id, date, yearMonth: ym, itemId: P2("ops-night"), headcount: 1 };
        passRows.push({ ...base, amount: meal, placeType: "식당", place: "구내식당", memo: "데이터 적재 야근" });
        if (rand() < 0.6) passRows.push({ ...base, amount: Math.min(12000 - meal, 2500 + Math.floor(rand() * 3) * 500), placeType: "카페", place: "1층 카페", memo: null });
      }
    }
  }
  await prisma.clientPassUsage.createMany({ data: passRows });
  const ex2 = [];
  const months2 = Array.from({ length: 8 }, (_, i) => addMonths("2026-03", i)); // 2026-03 ~ 2026-10
  for (const ym of months2) {
    const team2 = [m4, m3];
    for (let i = 0, n = ym === "2026-10" ? 2 : 4 + Math.floor(rand() * 3); i < n; i++) {
      const payer = pick(team2);
      const isTaxi = rand() < 0.35;
      const people = [payer.name]; // 야근식대·교통비는 결제자 본인 몫만
      ex2.push({
        projectId: project2.id, payerId: payer.id, createdBy: payer.id, yearMonth: ym, payMethod: "PERSONAL_CARD",
        date: new Date(`${ym}-${String(2 + Math.floor(rand() * (ym === "2026-10" ? 6 : 25))).padStart(2, "0")}T00:00:00Z`),
        itemId: isTaxi ? "ops-night-taxi" : "ops-night",
        detail: isTaxi ? "야근 후 귀가 택시" : "데이터 적재 야근 석식",
        amount: isTaxi ? amt(18000, 36000) : amt(10000, 12000),
        headcount: people.length, attendees: people.join(", "),
      });
    }
    ex2.push({
      projectId: project2.id, payerId: pm2.id, createdBy: pm2.id, yearMonth: ym, payMethod: "PERSONAL_CARD",
      date: new Date(`${ym}-0${3 + Math.floor(rand() * 5)}T00:00:00Z`),
      itemId: "ops-meeting", detail: "고객 요구사항 회의 다과", amount: amt(60000, 160000),
      headcount: 3, attendees: `${pm2.name}, ㈜다라데이터 박차장, 최대리`, hasExternal: true,
    });
    ex2.push({
      projectId: project2.id, payerId: pm2.id, createdBy: pm2.id, yearMonth: ym, payMethod: "SHARED_CARD",
      date: new Date(`${ym}-10T00:00:00Z`), itemId: "office-sw", detail: "BI 도구 월 라이선스", amount: 330000,
      headcount: 3, attendees: `팀 공용 (${[pm2, m4, m3].map((u) => u.name).join(", ")})`,
    });
  }
  await prisma.expense.createMany({ data: ex2.map((e) => ({ ...e, itemId: P2(e.itemId) })) });
  for (const ym of months2.slice(0, 6)) {
    await prisma.monthlyClosing.create({
      data: {
        projectId: project2.id, yearMonth: ym, status: ym === "2026-08" ? "SUBMITTED" : "APPROVED",
        closedAt: new Date(`${addMonths(ym, 1)}-02T09:00:00Z`), submittedAt: new Date(`${addMonths(ym, 1)}-02T09:00:00Z`),
        reviewedAt: ym === "2026-08" ? null : new Date(`${addMonths(ym, 1)}-06T09:00:00Z`), reviewedBy: ym === "2026-08" ? null : hq.id,
      },
    });
  }

  // ── 서브 프로젝트: 플랫폼사업팀 > 모바일 앱 고도화 ──
  // 상위 PM(김하늘)은 이 프로젝트를 조회·취합할 수 있고, 서브 PM(서하준)은 상위 프로젝트를 볼 수 없다
  const sub = await prisma.project.create({
    data: {
      name: "모바일 앱 고도화", code: "PRJ-2026-05", departmentId: plat, parentId: project.id,
      startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2027-03-31T00:00:00Z"), fiscalStart: 8,
      members: { create: [{ userId: pm3.id, isPm: true }, { userId: m5.id }] },
    },
  });
  await copyItems(prisma, sub.id, null, (it) => `p3-${it.id}`);
  const P3 = (id: string) => `p3-${id}`;
  await prisma.budgetLine.createMany({
    data: ([["ops-pm", "서브 PM 운영비", 150000, 8], ["ops-night", "야근식대 (팀원)", 120000, 8], ["ops-night-taxi", "야근 교통비", 60000, 8]] as [string, string, number, number][])
      .map(([itemId, detail, unitPrice, periods], order) => ({ projectId: sub.id, itemId: P3(itemId), detail, unitPrice, periods, planned: unitPrice * periods, order })),
  });
  await prisma.memberItem.createMany({ data: ["ops-night", "ops-night-taxi"].map((itemId) => ({ projectId: sub.id, itemId: P3(itemId) })) });
  const ex3 = [];
  for (const ym of ["2026-08", "2026-09", "2026-10"]) {
    for (let i = 0; i < (ym === "2026-10" ? 2 : 4); i++) {
      const payer = pick([pm3, m5]);
      const taxi = rand() < 0.4;
      const people = [payer.name]; // 결제자 본인 몫만
      ex3.push({
        projectId: sub.id, payerId: payer.id, createdBy: payer.id, yearMonth: ym, payMethod: "PERSONAL_CARD",
        date: new Date(`${ym}-${String(3 + Math.floor(rand() * 22)).padStart(2, "0")}T00:00:00Z`),
        itemId: P3(taxi ? "ops-night-taxi" : "ops-night"), detail: taxi ? "야근 후 귀가 택시" : "앱 배포 야근 석식",
        amount: taxi ? amt(16000, 34000) : amt(10000, 12000), headcount: people.length, attendees: people.join(", "),
      });
    }
  }
  await prisma.expense.createMany({ data: ex3 });
  for (const ym of ["2026-08"]) {
    await prisma.monthlyClosing.create({
      data: { projectId: sub.id, yearMonth: ym, status: "APPROVED", closedAt: new Date(`${addMonths(ym, 1)}-02T09:00:00Z`), submittedAt: new Date(`${addMonths(ym, 1)}-02T09:00:00Z`), reviewedAt: new Date(`${addMonths(ym, 1)}-06T09:00:00Z`), reviewedBy: hq.id },
    });
  }

  // ── 연속 사업 2차 (26.12~27.11, 시작 전) — "다음 연차 만들기"와 같은 방식: 항목·팀원 항목·구성원·예산 복사 ──
  const y2 = await prisma.project.create({
    data: {
      name: "플랫폼 운영 2차", code: "PRJ-2026-12", departmentId: plat, seriesId: platSeries.id, round: 2,
      startDate: new Date("2026-12-01T00:00:00Z"), endDate: new Date("2027-11-30T00:00:00Z"), fiscalStart: 12,
    },
  });
  const y1Members = await prisma.projectMember.findMany({ where: { projectId: project.id } });
  await prisma.projectMember.createMany({ data: y1Members.map((m) => ({ projectId: y2.id, userId: m.userId, isPm: m.isPm, isPayer: m.isPayer })) });
  const y2Items = await copyItems(prisma, y2.id, project.id, (it) => `p4-${it.code}`);
  const y1MemberItems = await prisma.memberItem.findMany({ where: { projectId: project.id } });
  await prisma.memberItem.createMany({ data: y1MemberItems.map((m) => ({ projectId: y2.id, itemId: y2Items.get(m.itemId)! })) });
  const y1Lines = await prisma.budgetLine.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" } });
  await prisma.budgetLine.createMany({
    data: y1Lines.map((l) => ({ projectId: y2.id, itemId: y2Items.get(l.itemId)!, detail: l.detail, unitPrice: l.unitPrice, periods: l.periods, planned: l.planned, order: l.order })),
  });

  // ── 변경계약: 1차 변경 1차 "관리자 대시보드 추가" (본계약과 함께 정산, 담당 PM 박지민) ──
  const change1 = await prisma.contractChange.create({
    data: {
      projectId: project.id, seq: 1, title: "관리자 대시보드 추가", signedAt: new Date("2026-07-15T00:00:00Z"), amountDelta: 12000000,
      startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-11-30T00:00:00Z"), managerId: m2.id,
      note: "(데모) 과업 추가에 따른 변경계약",
      // 담당 PM 입력 항목: 팀원 항목(야근식대 등)과 별도로 회의비
      items: { create: [{ itemId: P1("ops-meeting") }] },
    },
  });
  const lastOrder = (await prisma.budgetLine.aggregate({ where: { projectId: project.id }, _max: { order: true } }))._max.order ?? 0;
  await prisma.budgetLine.create({
    data: { projectId: project.id, itemId: P1("ops-meeting"), detail: "대시보드 검수 회의 (변경 증액분)", unitPrice: 300000, periods: 4, planned: 1200000, order: lastOrder + 1, changeId: change1.id },
  });
  await prisma.expense.createMany({
    data: [["2026-09-08", 86000], ["2026-09-22", 124000], ["2026-10-06", 97000]].map(([date, amount]) => ({
      projectId: project.id, payerId: m2.id, createdBy: m2.id, yearMonth: String(date).slice(0, 7), payMethod: "PERSONAL_CARD",
      date: new Date(`${date}T00:00:00Z`), itemId: P1("ops-meeting"), detail: "관리자 대시보드 검수 회의 다과", amount: Number(amount),
      headcount: 4, attendees: [m2.name, pm.name, m1.name, m3.name].join(", "), changeId: change1.id,
    })),
  });

  // ── 종료된 프로젝트 예시: 레거시 시스템 전환 (25.03~25.11, 재무팀 종료 처리 → 조회 전용) ──
  const legacy = await prisma.project.create({
    data: {
      name: "레거시 시스템 전환", code: "PRJ-2025-03", departmentId: data,
      startDate: new Date("2025-03-01T00:00:00Z"), endDate: new Date("2025-11-30T00:00:00Z"), fiscalStart: 3,
      closedAt: new Date("2025-12-22T09:00:00Z"), closedBy: hq.id,
      members: { create: [{ userId: pm2.id, isPm: true }, { userId: m3.id }, { userId: m4.id }] },
    },
  });
  await copyItems(prisma, legacy.id, null, (it) => `p5-${it.id}`);
  await prisma.budgetLine.createMany({
    data: [["ops-pm", "PM 월 운영비", 150000, 9], ["ops-night", "야근식대 (팀원)", 100000, 9]].map(([itemId, detail, unitPrice, periods], order) => ({
      projectId: legacy.id, itemId: `p5-${itemId}`, detail: String(detail), unitPrice: Number(unitPrice), periods: Number(periods), planned: Number(unitPrice) * Number(periods), order,
    })),
  });
  for (const ym of ["2025-10", "2025-11"]) {
    await prisma.expense.create({
      data: {
        projectId: legacy.id, payerId: m4.id, createdBy: m4.id, yearMonth: ym, payMethod: "PERSONAL_CARD", date: new Date(`${ym}-14T00:00:00Z`),
        itemId: "p5-ops-night", detail: "전환 리허설 야근 석식", amount: 11000, headcount: 1, attendees: m4.name,
      },
    });
    await prisma.monthlyClosing.create({
      data: { projectId: legacy.id, yearMonth: ym, status: "APPROVED", closedAt: new Date(`${addMonths(ym, 1)}-02T09:00:00Z`), submittedAt: new Date(`${addMonths(ym, 1)}-02T09:00:00Z`), reviewedAt: new Date(`${addMonths(ym, 1)}-06T09:00:00Z`), reviewedBy: hq.id },
    });
  }

  // ── 사후 처리: 주말 건은 평일로 옮기고, 규정 점검 결과(flags)를 기록 ──
  const all = await prisma.expense.findMany({ include: { item: true } });
  for (const e of all) {
    let date = e.date;
    const dow = date.getUTCDay();
    if (!e.isHq && (dow === 0 || dow === 6)) date = new Date(date.getTime() + (dow === 6 ? 2 : 1) * 86400000);
    const flags = checkPolicy({
      amount: Number(e.amount), headcount: e.headcount, date, hasExternal: e.hasExternal, item: e.item, remainingBefore: null, sameEntries: 0,
    });
    await prisma.expense.update({
      where: { id: e.id },
      data: { date, flags: encodeFlags(flags), justification: flags.length ? "(데모) 고객 일정상 불가피하여 사전 구두 승인" : null },
    });
  }
  // 데모: 규정 점검에 걸린 건 예시 (팀원 야근식대 1인당 한도 초과 + 소명)
  await prisma.expense.create({
    data: {
      projectId: project.id, payerId: m1.id, createdBy: m1.id, yearMonth: "2026-10", payMethod: "PERSONAL_CARD",
      date: new Date("2026-10-06T00:00:00Z"), itemId: P1("ops-night"), detail: "장애 대응 야근 석식 (결제금액:14,000원)", amount: 12000,
      headcount: 1, attendees: m1.name,
      flags: "PER_PERSON", justification: "긴급 장애 대응으로 늦게 식사 (한도 초과 2,000원 본인 부담)",
    },
  });

  // 참석자 필수: 인당 한도가 있는 항목만 (lib/rules defaultNeedsAttendees)
  await prisma.item.updateMany({ where: { perPersonLimit: null }, data: { needsAttendees: false } });

  console.log(`시드 완료: 지출 ${expenses.length}건, 출입증 ${await prisma.clientPassUsage.count()}건, 관리자 ${admin.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
