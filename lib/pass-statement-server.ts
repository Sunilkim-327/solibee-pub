// 출입증 월 사용 내역 — 서버 공통 (조회·업체 양식·가져오기·야근 자동 인정)
import "server-only";
import { cache } from "react";
import { sortPeople } from "./org";
import { HttpError, projectRows, type SessionUser } from "./access";
import { d1Batch, d1Changes, deleteByIdStatements, insertStatements, newRowId, prisma, sqlBool, sqlDate, sqlIntReq, sqlRows, sqlStr } from "./db";
import { chunkIds } from "./chunk";
import { deleteEmptyStatementSql, deletePassGroupSql, deletePassLinesSql, updatePassFileNameSql } from "./guarded-sql";
import { formatDate, parseDateOnly, seoulTodayDate } from "./format";
import { servedSince } from "./membership";
import { parseStringArray } from "./json";
import { autoDecide, getOvertimeSource, noOvertimeSource } from "./overtime";
import { applyConfirmedDefaults, normStartDay, passPeriod, canSeeAllPass, carryOver, splitByScope, statementStartDay, fileNameAfterDelete, displayItemsOf, visibleExtra, type DisplayItem, holderMapKey, lineQuantity, matchHolder, parseExtra, parseProfile, passLockedProblem, type ParsedLine, type PassItem, type PassMember, type Relabel, type SheetConfig } from "./pass-statement";
import type { PassLineRow, PassStatementInfo } from "./dto";
import { PASS_CATEGORY_ID, PASS_CATEGORY_NAME } from "./pass-category";
import { sqlClosingRows, sqlPassImportProfiles, sqlPassItems, sqlPassStatementMonths, sqlPassStatementView, sqlPassVendorCounts, sqlPendingPassChecks, sqlStatementWithLines, sqlUserInfo } from "./sql-loaders";
import { parseClosingStatus, type ClosingStatus } from "./types";

type LineRecord = {
  id: string; date: Date | null; holderName: string; holderKey: string | null; place: string | null; amount: number; userId: string | null;
  memberClaim: string | null; memberNote: string | null; decision: string | null; decisionSource: string | null;
  usageItemId: string | null; usageItem?: { name: string } | null;
  time: string | null; cardNo: string | null; empNo: string | null; company: string | null; item: string | null; sheetName: string | null; placeType: string | null; vendor?: string | null;
  onBehalfName: string | null; collectFrom: string | null; collectedAt: Date | null; collectNote: string | null;
  extra: string | null; matchKeys: string | null;
  user: { name: string } | null;
};

/** DB 줄 → 화면 줄. items(표시 열 목록)를 주면 표시 열을 보이는 이름으로 바꾸고 숨긴 항목은 뺀다 */
export const toLineRow = (l: LineRecord, items?: DisplayItem[]): PassLineRow => ({
  id: l.id, date: l.date ? formatDate(l.date) : null, holderName: l.holderName, holderKey: l.holderKey, place: l.place, amount: l.amount,
  userId: l.userId, userName: l.user?.name ?? null, memberClaim: l.memberClaim, memberNote: l.memberNote,
  decision: l.decision, decisionSource: l.decisionSource, usageItemId: l.usageItemId, usageItemName: l.usageItem?.name ?? null,
  time: l.time, cardNo: l.cardNo, empNo: l.empNo, company: l.company, item: l.item, sheetName: l.sheetName, placeType: l.placeType ?? l.sheetName, vendor: l.vendor ?? null,
  onBehalfName: l.onBehalfName, collectFrom: l.collectFrom, collectedAt: l.collectedAt?.toISOString() ?? null, collectNote: l.collectNote,
  extra: items ? visibleExtra(parseExtra(l.extra), items) : parseExtra(l.extra), qty: lineQuantity(parseExtra(l.extra)), keys: parseStringArray(l.matchKeys),
});

/** 이 프로젝트의 출입증 표시 열 목록 (저장된 목록, 없으면 업체 서식에서) — 프로젝트 행·서식은 요청 안에서 함께 쓴다 */
export async function passDisplayItems(projectId: string): Promise<DisplayItem[]> {
  const [rows, profiles] = await Promise.all([projectRows(), getImportProfiles(projectId)]);
  return displayItemsOf(rows.find((p) => p.id === projectId)?.passDisplayItems, profiles);
}

/**
 * 회사 부담으로 고를 수 있는 항목: 이 프로젝트의 '업체 출입증' 분류 항목 (예: 야근 식사).
 * 재무 승인 담당이 프로젝트 운영비 → 출입증 회사 부담 항목에서 등록한다 (공통 항목에서 가져오기 가능).
 * 없으면 모든 사용분이 본인 부담(급여 공제).
 */
export async function passItems(projectId: string): Promise<PassItem[]> {
  // 직접 SQL — 팀원 내 지출 내역의 출입증 탭도 쓴다 (tests/sql-loaders-hot.test.ts가 Prisma 조회와 대조)
  return sqlPassItems(projectId, PASS_CATEGORY_ID);
}

/** 업체 출입증 분류가 없으면 만든다 (분류는 회사 공통) */
export async function ensurePassCategory() {
  await prisma.category.upsert({ where: { id: PASS_CATEGORY_ID }, create: { id: PASS_CATEGORY_ID, name: PASS_CATEGORY_NAME, order: 900 }, update: {} });
}

/**
 * 정산 기간 시작일 — ym을 주면 그 달에 올린 업체들의 서식 기준(줄이 가장 많은 업체), 없으면 최근 업체 서식. 서식이 없으면 1 = 달력 월
 */
export async function periodStartDay(projectId: string, ym?: string) {
  const [profiles, counts] = await Promise.all([
    getImportProfiles(projectId),
    ym
      ? sqlPassVendorCounts(projectId, ym)
      : [],
  ]);
  return statementStartDay(counts, profiles);
}

type Row = Record<string, unknown>;

/**
 * 팀원 전체 + 사용자·소속 이름 — 직접 SQL 한 번 (Prisma projectMember.findMany + user·department 관계는 조회 3번).
 * 같은 결과: prisma.projectMember.findMany({ where: { projectId }, select: { isPm, leftAt, user: { select: { id, name, loginId, email, position, department: { select: { name } } } } } })
 * (순서는 Prisma가 쓰는 (projectId, userId) 색인 순과 같게 userId 순 — 호출부가 직급 → 성명으로 다시 정렬한다)
 */
async function passMemberRows(projectId: string) {
  const rows = await sqlRows<Row>(
    `SELECT pm."isPm", pm."leftAt", u."id", u."name", u."loginId", u."email", u."position", u."departmentId", d."name" AS "deptName"
     FROM "ProjectMember" pm JOIN "User" u ON u."id" = pm."userId" LEFT JOIN "Department" d ON d."id" = u."departmentId"
     WHERE pm."projectId" = ? ORDER BY pm."userId" ASC`,
    [projectId],
  );
  return rows.map((r) => ({
    isPm: sqlBool(r.isPm), leftAt: sqlDate(r.leftAt),
    user: {
      id: String(r.id), name: String(r.name), loginId: sqlStr(r.loginId), email: sqlStr(r.email), position: sqlStr(r.position),
      department: r.departmentId != null && r.deptName != null ? { name: String(r.deptName) } : null,
    },
  }));
}

/**
 * 프로젝트 팀원 (팀원 매칭·지정 후보, 급여 공제 엑셀).
 * ym을 주면 그 달 내역 기간에 근무한 사람 (이전 팀원 포함, leftAt으로 구분), 없으면 현재 팀원만.
 */
export async function passMembers(projectId: string, ym?: string, startDayOverride?: number): Promise<(PassMember & { loginId: string | null; department: string | null; isPm: boolean; position: string | null; leftAt: string | null })[]> {
  const [all, startDay] = await Promise.all([passMemberRows(projectId), ym ? startDayOverride ?? periodStartDay(projectId, ym) : 1]);
  const from = ym ? passPeriod(ym, startDay).from : formatDate(seoulTodayDate());
  const rows = all.filter((r) => servedSince(r, from));
  return sortPeople(rows, (r) => r.user).map((r) => ({
    userId: r.user.id, name: r.user.name, loginId: r.user.loginId ?? r.user.email, department: r.user.department?.name ?? null, isPm: r.isPm, position: r.user.position,
    leftAt: r.leftAt ? formatDate(r.leftAt) : null,
  }));
}

async function userNames(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  return new Map((await sqlUserInfo(list)).map((u) => [u.id, u.name]));
}

// ───────────────────────── 월 마감 잠금 (지출과 같은 기준 — lib/pass-statement passLockedProblem)

/**
 * 그 달의 마감 상태 — 메인과 함께 상신하는 서브 프로젝트면 그 달 메인의 마감 (sqlClosingRows). 마감 행이 없으면 작성중.
 * 같은 요청 안에서는 한 번만 조회한다
 */
export const passClosingStatus = cache(async (projectId: string, ym: string): Promise<ClosingStatus> => {
  const rows = await sqlClosingRows(projectId);
  return parseClosingStatus(rows.find((r) => r.yearMonth === ym)?.status);
});

/** 상신·승인된 달의 출입증 정산 변경은 403 (마감은 상신 전이라 허용) — 줄 수정·일괄·확정·확정 취소·올리기·삭제 API가 모두 부른다 */
export async function assertPassUnlocked(projectId: string, ym: string) {
  const problem = passLockedProblem(await passClosingStatus(projectId, ym));
  if (problem) throw new HttpError(403, problem);
}

/**
 * 월 내역 조회 — 팀원·상위 조회자는 본인 줄만(서버에서 거름), 이 프로젝트 PM·재무 승인·시스템 관리자는 전체.
 * 외부인 사용 처리 건은 PM 본인 줄이므로 팀원에게는 보이지 않는다. closingStatus: 그 달 마감 상태 (잠금·반려 안내용).
 * 확정된 내역의 빈 결정은 본인 부담(출처 DEFAULT)으로 채워서 준다(applyConfirmedDefaults) — PM 보드·팀원 출입증 탭·API GET이 모두 이 경로
 */
export async function loadStatement(user: SessionUser, projectId: string, ym: string) {
  const itemsP = passDisplayItems(projectId);
  const closingP = passClosingStatus(projectId, ym);
  // 직접 SQL — 팀원 내 지출 내역의 출입증 탭(현황, Prisma 없이 도는 화면)도 쓴다
  const st = await sqlPassStatementView(projectId, ym, canSeeAllPass(user) ? undefined : user.id);
  if (!st) { await closingP; return null; }
  const [names, items, closingStatus] = await Promise.all([userNames([st.uploadedBy, st.confirmedBy]), itemsP, closingP]);
  const info: PassStatementInfo = {
    id: st.id, yearMonth: st.yearMonth, fileName: st.fileName, uploadedAt: st.uploadedAt.toISOString(),
    uploadedByName: names.get(st.uploadedBy) ?? null, status: st.status === "CONFIRMED" ? "CONFIRMED" : "OPEN",
    confirmedAt: st.confirmedAt?.toISOString() ?? null, confirmedByName: st.confirmedBy ? names.get(st.confirmedBy) ?? null : null,
  };
  return { statement: info, lines: applyConfirmedDefaults(st.lines.map((l) => toLineRow(l, items)), info.status), closingStatus };
}

/** 내역이 있는 월 (팀원: 본인 줄이 있는 월만) */
export async function statementMonths(user: SessionUser, projectId: string) {
  return sqlPassStatementMonths(projectId, canSeeAllPass(user) ? undefined : user.id);
}

/**
 * 팀원 내 지출 내역의 출입증 탭 — 내역 월(내 줄이 있는 달, 오래된 달부터) 중 보여 줄 달:
 * 요청한 달 → 이번 달 → 가장 최근에 올라온 달. 그 달 내 줄·회사 부담 항목·정산 기간 시작일을 함께 읽는다 (모두 직접 SQL).
 */
export async function loadMyPassMonth(user: SessionUser, projectId: string, currentYm: string, requestedYm?: string) {
  const list = await statementMonths(user, projectId);
  const has = (m?: string) => !!m && list.some((x) => x.yearMonth === m);
  const ym = has(requestedYm) ? requestedYm! : has(currentYm) ? currentYm : list[0]?.yearMonth ?? currentYm;
  const [data, items, startDay] = await Promise.all([
    list.length ? loadStatement(user, projectId, ym) : null,
    passItems(projectId),
    periodStartDay(projectId, ym),
  ]);
  // 서버에서 이미 본인 줄만 (전체를 보는 역할이면 본인 줄로 거름)
  const mine = (data?.lines ?? []).filter((l) => l.userId === user.id);
  return { ym, months: list.map((m) => m.yearMonth).sort(), data, mine, items, startDay };
}

export async function findLine(id: string) {
  const line = await prisma.passStatementLine.findUnique({ where: { id }, include: { statement: true } });
  if (!line) throw new HttpError(404, "출입증 사용 내역을 찾을 수 없습니다.");
  return line;
}

/** 화면 줄에 쓰는 줄 칸 (toLineRow의 LineRecord) */
const LINE_ROW_TEXT = ["holderName", "holderKey", "place", "userId", "memberClaim", "memberNote", "decision", "decisionSource", "usageItemId",
  "time", "cardNo", "empNo", "company", "item", "sheetName", "placeType", "vendor", "onBehalfName", "collectFrom", "collectNote", "extra", "matchKeys"] as const;

/**
 * 줄 하나를 화면 줄로 (수정 응답) — 팀원 이름·회사 부담 항목 이름·내역 상태까지 직접 SQL 한 번
 * (Prisma findUniqueOrThrow + include user·usageItem은 조회 3번). 없으면 404.
 * 확정된 내역(수금 기록 등 확정 후에도 되는 수정)이면 빈 결정을 본인 부담으로 채운다 — loadStatement와 같은 모양
 */
export async function loadLineRow(id: string, items?: DisplayItem[]): Promise<PassLineRow> {
  const cols = ["id", "date", "amount", "collectedAt", ...LINE_ROW_TEXT].map((c) => `l."${c}"`).join(", ");
  const [r] = await sqlRows<Row>(
    `SELECT ${cols}, u."name" AS "userName", i."name" AS "usageItemName", s."status" AS "statementStatus"
     FROM "PassStatementLine" l LEFT JOIN "User" u ON u."id" = l."userId" LEFT JOIN "Item" i ON i."id" = l."usageItemId"
     LEFT JOIN "PassStatement" s ON s."id" = l."statementId" WHERE l."id" = ? LIMIT 1`,
    [id],
  );
  if (!r) throw new HttpError(404, "출입증 사용 내역을 찾을 수 없습니다.");
  const text = Object.fromEntries(LINE_ROW_TEXT.map((c) => [c, sqlStr(r[c])])) as Record<(typeof LINE_ROW_TEXT)[number], string | null>;
  const row = toLineRow({
    ...text, id: String(r.id), date: sqlDate(r.date), amount: sqlIntReq(r.amount), collectedAt: sqlDate(r.collectedAt), holderName: String(r.holderName),
    user: r.userName != null ? { name: String(r.userName) } : null,
    usageItem: r.usageItemName != null ? { name: String(r.usageItemName) } : null,
  }, items);
  return applyConfirmedDefaults([row], String(r.statementStatus ?? "OPEN"))[0];
}

export async function findStatement(id: string) {
  const st = await prisma.passStatement.findUnique({ where: { id } });
  if (!st) throw new HttpError(404, "출입증 내역을 찾을 수 없습니다.");
  return st;
}

// ───────────────────────── 업체 양식

export type ImportProfile = { id: string; vendorName: string; periodStartDay: number; sheets: SheetConfig[]; updatedAt: Date };

/** 이 프로젝트의 업체 서식 목록 (최근 저장 순, 같은 요청 안에서 한 번만 조회). 읽을 수 없는 서식은 뺀다 */
export const getImportProfiles = cache(async (projectId: string): Promise<ImportProfile[]> => {
  const rows = await sqlPassImportProfiles(projectId);
  return rows.flatMap((p) => {
    let sheets: SheetConfig[] | null = null;
    try {
      sheets = parseProfile(JSON.parse(p.sheets));
    } catch {
      sheets = null;
    }
    return sheets ? [{ id: p.id, vendorName: p.vendorName, periodStartDay: normStartDay(p.periodStartDay), sheets, updatedAt: p.updatedAt }] : [];
  });
});

/**
 * 구분이 바뀐 설정의 기존 내역 줄 구분을 새 구분으로 (같은 업체·같은 시트·옛 구분, 확정 전 달만).
 * 구분 없이 만든 서식(시트 이름이 구분)을 고쳤을 때 기존 줄이 새 구분으로 이어지게 — 확정된 달은 바꾸지 않는다
 */
export async function applyRelabels(projectId: string, vendor: string, relabels: Relabel[]) {
  let changed = 0;
  for (const r of relabels) {
    const res = await prisma.passStatementLine.updateMany({
      where: { vendor, sheetName: r.sheetName, placeType: r.from, statement: { projectId, status: "OPEN" } },
      data: { placeType: r.to },
    });
    changed += res.count;
  }
  return changed;
}

/** 업체 서식 저장 (업체 이름별로 하나 — 있으면 고치고 없으면 만든다) */
export async function saveImportProfile(user: SessionUser, projectId: string, vendorName: string, sheets: SheetConfig[], periodStartDay = 1) {
  const data = { sheets: JSON.stringify(sheets), periodStartDay: normStartDay(periodStartDay), updatedBy: user.id };
  await prisma.passImportProfile.upsert({ where: { projectId_vendorName: { projectId, vendorName } }, create: { projectId, vendorName, ...data }, update: data });
}

// ───────────────────────── 야근 자동 인정 (Soliday 연동 지점)

/**
 * 야근 기록으로 미결정 줄 자동 인정 (Soliday 연동 전에는 아무것도 바뀌지 않음).
 * 가져오기 직후·팀원 지정 직후 실행한다. 외부인 대납 건은 제외. 바뀐 줄 수를 돌려준다.
 */
async function singleItem(projectId: string) {
  const items = await passItems(projectId);
  return items.length === 1 ? { usageItemId: items[0].id } : {};
}

export async function applyOvertime(statementId: string): Promise<number> {
  // 야근 기록 출처가 아직 없으면(연동 전) 인정할 줄도 없다 — 내역·줄·정산 기간을 읽지 않는다 (올리기·팀원 지정마다 조회 4번 절약)
  const source = getOvertimeSource();
  if (source === noOvertimeSource) return 0;
  const st = await prisma.passStatement.findUnique({
    where: { id: statementId },
    include: { lines: { where: { onBehalfName: null }, select: { id: true, date: true, userId: true, decision: true } } },
  });
  if (!st || st.status !== "OPEN") return 0;
  const lines = st.lines.map((l) => ({ id: l.id, date: l.date ? formatDate(l.date) : null, userId: l.userId, decision: l.decision }));
  const userIds = [...new Set(lines.map((l) => l.userId).filter((x): x is string => !!x))];
  if (!userIds.length) return 0;
  // 업체 정산 기간 (예: 7/21 ~ 8/20)
  const period = passPeriod(st.yearMonth, await periodStartDay(st.projectId, st.yearMonth));
  const from = parseDateOnly(period.from)!;
  const to = parseDateOnly(period.to)!;
  const overtime = await source.overtimeDates(userIds, from, to);
  const { lines: decided } = autoDecide(lines, overtime);
  const changedIds = decided.filter((l, i) => l.decision !== lines[i].decision).map((l) => l.id);
  if (!changedIds.length) return 0;
  // 회사 부담 항목이 하나뿐이면 그 항목으로. D1 바인딩 한도(100) — id를 나눠서
  const data = { decision: "OVERTIME", decisionSource: "SOLIDAY", decidedBy: null, decidedAt: new Date(), ...(await singleItem(st.projectId)) };
  let count = 0;
  for (const chunk of chunkIds(changedIds)) {
    const res = await prisma.passStatementLine.updateMany({ where: { id: { in: chunk }, decision: null }, data });
    count += res.count;
  }
  return count;
}

// ───────────────────────── 저장

/**
 * 내역 저장: 팀원 자동 매칭 → (기존 OPEN 내역이면) 같은 업체의 이번 파일이 바꾸는 구분(scope) 줄만 교체하며 표시·결정·외부인 처리 이어받기 → 야근 자동 인정.
 * 다른 업체·다른 구분의 줄(예: 업체 A 식당 파일을 올릴 때 A 카페·B 식당 줄)은 그대로 둔다. 확정된 내역은 409.
 * @param vendor 올릴 때 쓴 업체 서식의 업체 이름 (줄의 vendor로 저장)
 * @param startDay 그 업체 서식의 정산 기간 시작일 (팀원 근무 기간 판단)
 */
export async function saveStatement(user: SessionUser, projectId: string, ym: string, fileName: string, parsed: ParsedLine[], scope: string[], vendor: string, startDay?: number) {
  const [members, holderRows, existing] = await Promise.all([
    passMembers(projectId, ym, startDay),
    prisma.passHolder.findMany({ where: { projectId }, select: { holderKey: true, userId: true } }),
    // 기존 내역 + 모든 줄 (수천 건일 수 있어 직접 SQL — Prisma include와 같은 결과)
    sqlStatementWithLines(projectId, ym),
  ]);
  if (existing?.status === "CONFIRMED") throw new HttpError(409, "이 달 출입증 내역은 이미 확정되었습니다. 다시 올리려면 먼저 확정을 취소하세요.");
  const holders = new Map(holderRows.map((h) => [h.holderKey, h.userId]));
  const matched = parsed.map((l) => ({ ...l, userId: matchHolder(l, members, holders).userId }));
  const { keep, replace } = splitByScope(existing?.lines ?? [], scope, vendor);
  const { lines, carried } = carryOver(replace.map((o) => ({ ...o, date: o.date ? formatDate(o.date) : null })), matched.map((l) => ({ ...l, extra: l.extra.length ? JSON.stringify(l.extra) : null })));
  // 파일 이름: "업체: 파일" — 업체·구분별로 따로 올린 달은 이어서 기록 (이 업체 줄이 모두 바뀌면 이 업체의 이전 파일 이름은 뺀다)
  const label = `${vendor}: ${fileName}`;
  const vendorKept = keep.some((l) => l.vendor === vendor);
  const prev = (existing?.fileName.split(" + ") ?? []).filter((p) => vendorKept || !p.startsWith(`${vendor}: `));
  const name = !keep.length ? label : prev.includes(label) ? prev.join(" + ").slice(0, 200) : [...prev, label].join(" + ").slice(0, 200);
  const base = keep.reduce((a, l) => Math.max(a, l.order + 1), 0);

  const rows = lines.map((l, i) => ({
    statementId: "", order: base + i, date: l.date ? parseDateOnly(l.date) : null, holderName: l.holderName,
    holderKey: l.keys[0] ? l.keys[0].slice(l.keys[0].indexOf(":") + 1) : null, matchKeys: l.keys.length ? JSON.stringify(l.keys) : null, extra: l.extra,
    place: l.place, amount: l.amount, userId: l.userId, vendor,
    time: l.time, cardNo: l.cardNo, empNo: l.empNo, company: l.company, item: l.item, sheetName: l.sheetName, placeType: l.label,
    memberClaim: l.memberClaim ?? null, memberNote: l.memberNote ?? null,
    decision: l.decision ?? null, usageItemId: l.usageItemId ?? null, decisionSource: l.decisionSource ?? null, decidedBy: l.decidedBy ?? null, decidedAt: l.decidedAt ?? null,
    onBehalfName: l.onBehalfName ?? null, collectFrom: l.collectFrom ?? null, collectedAt: l.collectedAt ?? null, collectNote: l.collectNote ?? null,
  }));
  const st = existing
    ? await prisma.passStatement.update({ where: { id: existing.id }, data: { fileName: name, uploadedBy: user.id, uploadedAt: new Date() } })
    : await prisma.passStatement.create({ data: { projectId, yearMonth: ym, fileName: name, uploadedBy: user.id } });
  for (const r of rows) r.statementId = st.id;
  // 운영(D1): 기존 줄 삭제 + 새 줄 추가를 한 번에 원자적으로 (중간 실패로 그 구분 내역이 비지 않게, 쿼리 수·CPU 절약)
  // (쿼리당 값 100개 제한에 맞춰 삭제는 100개씩, 추가는 여러 행씩 묶는다)
  const done = await d1Batch([
    ...deleteByIdStatements("PassStatementLine", replace.map((l) => l.id)),
    ...insertStatements("PassStatementLine", rows.map((r) => ({ id: newRowId(), ...r }))),
  ]);
  if (!done) {
    await prisma.$transaction(async (tx) => {
      if (replace.length) await tx.passStatementLine.deleteMany({ where: { id: { in: replace.map((l) => l.id) } } });
      await tx.passStatementLine.createMany({ data: rows });
    }, { timeout: 60_000, maxWait: 10_000 });
  }
  const statement = st;
  const autoDecided = await applyOvertime(statement.id);

  // 미확인 사용자 (카드번호·이름별)
  const unmatched = new Map<string, { holderName: string; keys: string[]; count: number; amount: number }>();
  for (const l of lines.filter((x) => !x.userId)) {
    const k = holderMapKey(l);
    const u = unmatched.get(k) ?? { holderName: l.holderName, keys: l.keys, count: 0, amount: 0 };
    u.count++;
    u.amount += l.amount;
    unmatched.set(k, u);
  }
  // 이 달 내역에 줄이 있는 팀원 (남긴 줄 + 이번 파일) — 확인 알림 대상
  const userIds = [...new Set([...keep, ...lines].map((l) => l.userId).filter((u): u is string => !!u))];
  return { statementId: statement.id, replaced: replace.length > 0, kept: keep.length, lineCount: lines.length, carried, autoDecided, unmatched: [...unmatched.values()], userIds };
}

/** 대시보드 할 일: 미결정 줄이 있는 OPEN 내역 */
export async function pendingPassChecks(projectId: string) {
  // 확정 전 내역마다: 팀원 회사 부담 요청(미결정)·팀원 미확인 줄 수 — 직접 SQL 한 번 (현황 할 일이 매 요청 쓴다)
  return sqlPendingPassChecks(projectId);
}

/** 팀원: 확정 전 내역에 내 사용분이 있는 달 (확인·회사 부담 요청 안내) */
/** 확정 전(OPEN) 출입증 내역이 있는 달 — PM 안내용 (오래된 달부터) */
export async function openPassMonths(projectId: string) {
  const rows = await prisma.passStatement.findMany({ where: { projectId, status: "OPEN" }, select: { yearMonth: true }, orderBy: { yearMonth: "asc" } });
  return rows.map((r) => r.yearMonth);
}

export async function myOpenPassMonths(projectId: string, userId: string) {
  const rows = await prisma.passStatement.findMany({
    where: { projectId, status: "OPEN", lines: { some: { userId, onBehalfName: null } } },
    select: { yearMonth: true },
    orderBy: { yearMonth: "asc" },
  });
  return rows.map((r) => r.yearMonth);
}

// ───────────────────────── 올린 내역 삭제 (잘못 올린 자료)

export type DeletedPass = { ym: string; vendor: string | null; label: string | null; count: number; amount: number; decided: number; claims: number; fileName: string; statementDeleted: boolean };

const groupLabel = (l: { placeType: string | null; sheetName: string | null }) => l.placeType || l.sheetName || "";

/**
 * 확정 전 내역의 올린 내역 삭제 — group을 주면 그 묶음(업체 + 구분)만, 없으면 그 달 전체.
 * 줄이 남지 않으면 내역도 지워 그 달을 '올리기 전'으로. 운영(D1)은 확정 전 조건을 넣은 한 배치(원자적), 로컬은 트랜잭션.
 * 확정된 달은 409 (확정 취소 후 삭제)
 */
export async function deletePassUpload(statementId: string, group?: { vendor: string | null; label: string }): Promise<DeletedPass> {
  const st = await prisma.passStatement.findUnique({
    where: { id: statementId },
    include: { lines: { select: { id: true, vendor: true, placeType: true, sheetName: true, amount: true, decision: true, memberClaim: true } } },
  });
  if (!st) throw new HttpError(404, "출입증 내역을 찾을 수 없습니다.");
  if (st.status !== "OPEN") throw new HttpError(409, "확정된 달은 지울 수 없습니다. 먼저 확정을 취소한 뒤 삭제하세요.");
  const target = group ? st.lines.filter((l) => (l.vendor ?? null) === group.vendor && groupLabel(l) === group.label) : st.lines;
  if (!target.length) throw new HttpError(404, "지울 내역이 없습니다. 새로고침 후 다시 확인하세요.");
  const rest = st.lines.filter((l) => !target.includes(l));
  const remainingVendors = [...new Set(rest.map((l) => l.vendor).filter((v): v is string => !!v))];
  const fileName = rest.length ? fileNameAfterDelete(st.fileName, remainingVendors) : st.fileName;

  const stmts = [
    group ? deletePassGroupSql(statementId, group.vendor, group.label) : deletePassLinesSql(statementId),
    ...(rest.length && fileName !== st.fileName ? [updatePassFileNameSql(statementId, fileName)] : []),
    deleteEmptyStatementSql(statementId),
  ];
  const changes = await d1Changes(stmts);
  if (changes) {
    // 첫 문장(줄 삭제)이 0행이면 그 사이 확정된 것
    if (!changes[0]) throw new HttpError(409, "출입증 내역이 방금 확정되었습니다. 확정을 취소한 뒤 삭제하세요.");
  } else {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.passStatement.findUnique({ where: { id: statementId }, select: { status: true } });
      if (fresh?.status !== "OPEN") throw new HttpError(409, "출입증 내역이 방금 확정되었습니다. 확정을 취소한 뒤 삭제하세요.");
      await tx.passStatementLine.deleteMany({ where: { id: { in: target.map((l) => l.id) } } });
      if (!rest.length) await tx.passStatement.delete({ where: { id: statementId } });
      else if (fileName !== st.fileName) await tx.passStatement.update({ where: { id: statementId }, data: { fileName } });
    });
  }
  return {
    ym: st.yearMonth, vendor: group?.vendor ?? null, label: group?.label ?? null, count: target.length,
    amount: target.reduce((a, l) => a + l.amount, 0), decided: target.filter((l) => l.decision).length, claims: target.filter((l) => l.memberClaim === "OVERTIME").length,
    fileName: st.fileName, statementDeleted: !rest.length,
  };
}
