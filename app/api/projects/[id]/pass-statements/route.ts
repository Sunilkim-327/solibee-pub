import { NextResponse } from "next/server";
import { byPositionThenName } from "@/lib/org";
import { HttpError, apiUser, assertProjectRole, assertWritable, audit, route } from "@/lib/access";
import { isYearMonth, projectMonths } from "@/lib/format";
// 엑셀 라이브러리(exceljs)는 파일 원본을 받았을 때만 불러온다 (보통은 브라우저가 읽은 시트 글자를 보냄 — 운영 CPU 절약)
import { LIMITS } from "@/lib/pass-import-limits";
import {
  NO_VENDOR_LABEL, buildPreview, canSeeAllPass, chooseVendor, defaultVendorName, displayItemsOf, matchHolder, mergeDisplayItems, mergeProfileDetailed, normStartDay, splitByScope,
  parseDisplayItems, parseProfile, passPeriod, parseWorkbook, profileScore, replaceWarnings, sheetLabel, type DisplayItem,
  sheetSetups, sheetsFromWire, summarizeStatement, vendorNameProblem, type Sheet, type SheetConfig, type SheetProblem,
} from "@/lib/pass-statement";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notification-server";
import { passNotifications } from "@/lib/notifications";
import { applyRelabels, assertPassUnlocked, getImportProfiles, loadStatement, passItems, passMembers, saveImportProfile, saveStatement } from "@/lib/pass-statement-server";

type Params = { id: string };
const MAX_BYTES = 10 * 1024 * 1024;
/** 한 달 출입증 내역 최대 줄 수 */
const MAX_LINES = 20_000;

/** 월 출입증 내역 조회 (?ym=) — 팀원은 본인 줄만 (다른 사람 이름·금액은 응답에 포함하지 않음) */
export const GET = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await assertProjectRole(await apiUser(), id);
  const ym = new URL(req.url).searchParams.get("ym");
  if (!isYearMonth(ym)) throw new HttpError(400, "ym은 YYYY-MM 형식입니다.");
  const all = canSeeAllPass(user);
  // 출입증 내역·항목·팀원·업체 서식은 서로 무관 — 한 번에 읽는다
  const [data, items, members, profiles] = await Promise.all([
    loadStatement(user, id, ym), passItems(id), all ? passMembers(id, ym) : null, all ? getImportProfiles(id) : null,
  ]);
  return NextResponse.json({
    statement: data?.statement ?? null,
    lines: data?.lines ?? [],
    // 그 달 마감 상태 — 마감(CLOSED 이상)이면 출입증 내역을 바꿀 수 없다 (출입증 내역이 없으면 null)
    closingStatus: data?.closingStatus ?? null,
    summary: summarizeStatement(data?.lines ?? [], items),
    ...(members && profiles ? { members: members.map((m) => ({ userId: m.userId, name: m.name, leftAt: m.leftAt })), vendors: profiles.map((p) => ({ vendorName: p.vendorName, periodStartDay: p.periodStartDay })) } : {}),
  });
});

/**
 * 업체 내역 올리기 (multipart) — 이 프로젝트 PM·재무 승인·시스템 관리자
 *   ym, file, vendor?(쓸 업체 서식 이름 — 없으면 머리글이 가장 잘 맞는 서식을 자동 선택), newVendor?("1": 새 업체로 설정),
 *   profile?(JSON {vendorName(필수), isNew?, periodStartDay?(1~28, 21이면 전월 21일~당월 20일), sheets: SheetConfig[], displayItems?: 표시 열 목록(PM만 반영)}),
 *   setup?("1": 업체 양식 다시 설정), preview?("1"), allowErrors?("1"), profileOnly?("1": 서식만 저장 — PM 설정의 [업체 서식 추가], 출입증 내역 반영 없음),
 *   labels?(JSON {시트 이름: 구분} — 같은 시트 이름에 구분 설정이 여러 개일 때 고른 구분)
 * - 같은 시트 이름의 구분이 여러 개라 어느 구분인지 정할 수 없으면 422 { needLabel: [{sheet, labels}] } → 화면에서 구분을 골라 labels와 함께 다시 보냄
 * - 업체 서식은 프로젝트당 업체별로 여러 개. 한 달에 여러 업체 자료를 올릴 수 있고, 다시 올리면 같은 업체·같은 구분의 줄만 바뀐다
 * - 맞는 서식이 없거나(처음·새 업체), 파일이 서식과 다르거나, setup=1이면 422 { needSetup, problems, vendorName, isNew, vendors, sheets: SheetSetup[] } → 화면에서 확인 후 profile과 함께 다시 보냄
 * - preview=1: 저장하지 않고 미리보기 { preview, profile } (시트별 앞 5건·사람별·합계·건너뛴 행·오류) → [반영]은 같은 profile로 다시 보냄
 * - 행 오류가 있으면 422 { errors } → 오류 행을 빼고 올리려면 allowErrors=1
 * - 업체 양식의 시트 중 파일에 있는 시트만 읽고, 기존 출입증 내역에서 그 구분(식당·카페 등)의 줄만 바꾼다 (나머지 구분은 유지)
 * - 성공 시 보낸 profile을 그 업체의 서식에 합쳐 저장 (파일에 없는 시트의 설정은 유지)
 */
export const POST = route<Params>(async (req, { params }) => {
  const { id } = await params;
  // 올리기는 이 프로젝트 PM만 (재무 승인·시스템 관리자는 조회)
  const { project, user } = await assertProjectRole(await apiUser(), id, ["MANAGER"]);
  assertWritable(user);
  if (!project.clientPassEnabled) throw new HttpError(400, "이 프로젝트는 출입증을 사용하지 않습니다.");
  // 본문을 읽기 전에 크기 확인 (formData는 본문 전체를 메모리에 올림)
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) throw new HttpError(411, "파일 크기를 확인할 수 없습니다. 다시 올려 주세요.");
  if (length > MAX_BYTES + 1024 * 1024) throw new HttpError(413, "파일이 너무 큽니다 (10MB 이하).");
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) throw new HttpError(415, "파일(multipart/form-data)로 올려 주세요.");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "잘못된 요청 형식입니다.");
  }
  const ym = form.get("ym");
  if (!isYearMonth(ym)) throw new HttpError(400, "ym은 YYYY-MM 형식입니다.");
  if (!projectMonths(project.startDate, project.endDate).includes(ym)) throw new HttpError(400, "프로젝트 기간 밖의 월입니다.");
  // 마감(CLOSED 이상)된 달에는 올리기·다시 올리기 불가 (서식만 저장하는 profileOnly는 출입증 내역을 바꾸지 않으므로 허용)
  if (form.get("profileOnly") !== "1") await assertPassUnlocked(id, ym);
  // 브라우저가 파일을 읽어 보낸 시트(sheets)만 받는다 — 서버에서 xlsx 원본을 풀면 압축 폭탄(선언 크기 위조)을 막을 수 없다
  const wire = form.get("sheets");
  if (typeof wire !== "string" || !wire) throw new HttpError(400, "업체 내역 파일을 선택하세요.");
  const rawName = form.get("fileName");

  // 화면에서 확인한 업체 양식
  let sent: { sheets: SheetConfig[]; vendorName: string; isNew: boolean; periodStartDay: number; displayItems: DisplayItem[] | null } | null = null;
  const rawProfile = form.get("profile");
  if (typeof rawProfile === "string" && rawProfile) {
    let parsedJson: { sheets?: unknown; vendorName?: unknown; isNew?: unknown; periodStartDay?: unknown; displayItems?: unknown } = {};
    try {
      parsedJson = JSON.parse(rawProfile);
    } catch {
      /* 아래에서 오류 */
    }
    const sheets = parseProfile(parsedJson.sheets);
    if (!sheets) throw new HttpError(400, "업체 서식 설정이 올바르지 않습니다. 시트를 하나 이상 고르고 시트마다 이름·금액 열을 지정하세요 (이름·연결·금액·날짜 열은 서로 달라야 합니다).");
    const vendorName = typeof parsedJson.vendorName === "string" ? parsedJson.vendorName.trim() : "";
    const nameProblem = vendorNameProblem(vendorName, []);
    if (nameProblem) throw new HttpError(400, nameProblem);
    const displayItems = parsedJson.displayItems === undefined ? null : parseDisplayItems(parsedJson.displayItems);
    if (parsedJson.displayItems !== undefined && !displayItems) throw new HttpError(400, "표시 열 목록이 올바르지 않습니다 (이름이 비었거나 겹침).");
    sent = { sheets, vendorName, isNew: parsedJson.isNew === true, periodStartDay: normStartDay(parsedJson.periodStartDay), displayItems };
  }

  if (wire.length > MAX_BYTES * 2) throw new HttpError(413, "파일이 너무 큽니다 (10MB 이하).");
  const sheets: Sheet[] | null = sheetsFromWire(wire, { rows: LIMITS.rows, cols: LIMITS.cols, sheets: 50 });
  if (!sheets) throw new HttpError(400, "파일 내용을 읽을 수 없습니다. 다시 올려 주세요.");

  // 업체 서식 고르기: 보낸 설정 → 고른 업체 → 파일 머리글이 가장 잘 맞는 업체 (새 업체로 설정이면 없음)
  const profiles = await getImportProfiles(id);
  const names = profiles.map((p) => p.vendorName);
  // 표시 열 목록(프로젝트 공통) — 목록 고치기는 이 프로젝트 PM만 (재무 승인·시스템 관리자가 올릴 때는 기존 목록에 열만 연결)
  const canEditItems = user.role === "MANAGER";
  const projectItems = displayItemsOf(project.passDisplayItems, profiles);
  const items = canEditItems && sent?.displayItems ? mergeDisplayItems(projectItems, sent.displayItems) : projectItems;
  const itemKeys = items.filter((i) => !i.hidden).map((i) => i.key);
  const profileOnly = form.get("profileOnly") === "1";
  // 서식만 저장(PM 설정 > 업체 서식 추가)은 이 프로젝트 PM만 — 재무 승인·시스템 관리자는 조회
  if (profileOnly && user.role !== "MANAGER") throw new HttpError(403, "업체 서식은 이 프로젝트 PM이 설정합니다.");
  const askedName = typeof form.get("vendorName") === "string" ? String(form.get("vendorName")).trim() : "";
  // 고른 구분 (시트 이름 → 구분)
  let picks: Record<string, string> = {};
  try {
    const raw = form.get("labels");
    const v = typeof raw === "string" && raw ? JSON.parse(raw) : {};
    if (v && typeof v === "object" && !Array.isArray(v)) picks = Object.fromEntries(Object.entries(v).filter(([k, x]) => typeof x === "string" && k.length <= 100 && x.length <= 20)) as Record<string, string>;
  } catch {
    picks = {};
  }
  if (sent?.isNew) {
    const dup = vendorNameProblem(sent.vendorName, names);
    if (dup) throw new HttpError(409, dup);
  }
  const requested = form.get("vendor");
  const newVendor = form.get("newVendor") === "1";
  const byName = (n: unknown) => profiles.find((p) => p.vendorName === n) ?? null;
  const auto = !sent && !newVendor && !byName(requested) ? chooseVendor(sheets, profiles) : null;
  const saved = sent ? byName(sent.vendorName) : newVendor ? null : byName(requested) ?? auto;
  const vendorName = sent?.vendorName ?? saved?.vendorName ?? null;
  const needSetup = (problem: string, problems: SheetProblem[] = []) => {
    throw new HttpError(422, problem, {
      needSetup: true, problems,
      vendorName: vendorName ?? (askedName || defaultVendorName(names)), isNew: !saved, autoSelected: !!auto, vendors: names,
      periodStartDay: sent?.periodStartDay ?? saved?.periodStartDay ?? normStartDay(form.get("periodStartDay") ?? 1),
      sheets: sheetSetups(sheets, sent?.sheets ?? saved?.sheets, items, picks), displayItems: items, canEditItems,
    });
  };
  if (form.get("setup") === "1" || newVendor) {
    return needSetup(newVendor ? "새 업체 서식입니다. 업체 이름을 정하고 사용할 시트와 열을 고르세요." : "사용할 시트와 열을 확인하세요.");
  }
  const profile = sent?.sheets ?? saved?.sheets ?? null;
  if (!profile || !vendorName) {
    return needSetup(profiles.length
      ? `저장된 업체 서식(${names.join(", ")}) 중 이 파일과 맞는 것이 없습니다. 다른 업체 자료면 업체 이름을 정하고 시트와 열을 고르세요.`
      : "처음 올리는 업체 파일입니다. 업체 이름을 정하고 사용할 시트와 열을 고르세요.");
  }
  const startDay = sent?.periodStartDay ?? saved?.periodStartDay ?? 1;
  const parsed = parseWorkbook(sheets, profile, ym, startDay, itemKeys, picks);
  if (!parsed.ok && parsed.ambiguous?.length) {
    // 같은 시트 이름에 구분이 여러 개 — 구분을 자동으로 정하지 않고 고르게 (잘못 정하면 다른 구분 내역이 바뀜)
    throw new HttpError(422, `'${vendorName}' 서식에서 이 파일이 어느 구분인지 정할 수 없습니다. 구분을 고르세요.`, { needLabel: parsed.ambiguous, vendorName });
  }
  if (!parsed.ok) {
    // 고른(또는 자동 선택된) 업체 서식과 맞지 않음: 다른 업체 서식이 더 잘 맞으면 그 업체를, 아니면 새 업체로 설정을 먼저 권한다
    // (같은 업체의 새 구분으로 설정하면 이 업체 서식에 다른 업체 열이 섞인다)
    const better = sent ? null : chooseVendor(sheets, profiles.filter((p) => p.vendorName !== vendorName));
    const betterFits = !!better && profileScore(sheets, better.sheets) > profileScore(sheets, profile);
    const newFile = parsed.problems.some((x) => !x.sheet);
    const message = betterFits
      ? `이 파일은 '${better!.vendorName}' 업체 서식과 더 잘 맞습니다. 업체 선택에서 '${better!.vendorName}'(으)로 바꾸세요.`
      : newFile && !sent
        ? `이 파일은 '${vendorName}' 서식과 다릅니다. 다른 업체 파일이면 [새 업체로 설정]을, 같은 업체의 새 구분(예: 카페)이면 시트·열을 고르고 구분 이름을 정하세요.`
        : parsed.problems.map((x) => x.message).join(" ");
    return needSetup(message, parsed.problems);
  }
  // 합친 서식 + 구분이 바뀐 기존 설정 (구분 없던 설정을 고친 경우 등 — 기존 줄의 구분을 새 구분으로 이어 준다)
  const merge = mergeProfileDetailed(saved?.sheets, parsed.resolved, sheets.map((x) => x.name));
  // 표시 열 목록 저장 (PM이 고쳤을 때만)
  const saveItems = async () => {
    if (canEditItems && sent?.displayItems && JSON.stringify(items) !== JSON.stringify(projectItems)) {
      await prisma.project.update({ where: { id }, data: { passDisplayItems: JSON.stringify(items) } });
    }
  };

  // 서식만 저장 (PM 설정 > 업체 서식 추가: 샘플 파일로 시트·열을 정하고 출입증 내역은 반영하지 않음)
  if (profileOnly) {
    if (!sent) throw new HttpError(400, "업체 서식 설정을 보내 주세요.");
    await saveImportProfile(user, id, vendorName, merge.sheets, startDay);
    const relabeled = await applyRelabels(id, vendorName, merge.relabels);
    await saveItems();
    await audit(user, { projectId: id, entity: "PassImportProfile", entityId: vendorName, action: saved ? "update" : "create", data: { vendor: vendorName, periodStartDay: startDay, sheets: parsed.resolved.map((s) => s.sheetName), relabels: merge.relabels, relabeled } });
    return NextResponse.json({ profileOnly: true, vendor: vendorName, profileSaved: true, relabels: merge.relabels, relabeled }, { status: 201 });
  }

  if (form.get("preview") === "1") {
    const preview = buildPreview(parsed);
    const [members, holderRows, old] = await Promise.all([
      passMembers(id, ym, startDay),
      prisma.passHolder.findMany({ where: { projectId: id }, select: { holderKey: true, userId: true } }),
      // 기존 출입증 내역: 업체·구분별로 바뀌는 줄·그대로 두는 줄
      prisma.passStatement.findUnique({ where: { projectId_yearMonth: { projectId: id, yearMonth: ym } }, select: { status: true, lines: { select: { placeType: true, sheetName: true, vendor: true, amount: true, date: true } } } }),
    ]);
    const holders = new Map(holderRows.map((h) => [h.holderKey, h.userId]));
    const nameOf = new Map(members.map((m) => [m.userId, m.name]));
    // 팀원으로 확인된 사람 먼저 직급 → 성명 순, 연결 안 된 이름은 뒤에 이름순
    const posOf = new Map(members.map((m) => [m.userId, m.position]));
    const people = preview.people.map((p) => { const m = matchHolder(p, members, holders); return { ...p, userName: m.userId ? nameOf.get(m.userId) ?? null : null, position: m.userId ? posOf.get(m.userId) ?? null : null }; })
      .sort((a, b) => (a.userName ? 0 : 1) - (b.userName ? 0 : 1) || byPositionThenName({ position: a.position, name: a.userName ?? a.holderName }, { position: b.position, name: b.userName ?? b.holderName }));
    // 구분이 바뀌는 설정이면 기존 줄도 바뀔 구분으로 보고 비교 (반영할 때 함께 바뀐다)
    const relabeledLines = (old?.lines ?? []).map((l) => {
      const r = merge.relabels.find((x) => l.vendor === vendorName && l.sheetName === x.sheetName && l.placeType === x.from);
      return r ? { ...l, placeType: r.to } : l;
    });
    const existing: { label: string; count: number; amount: number; action: "keep" | "replace" }[] = [];
    if (old) {
      const { keep, replace } = splitByScope(relabeledLines, parsed.scope, vendorName);
      for (const [list, action] of [[replace, "replace"], [keep, "keep"]] as const) {
        const by = new Map<string, { count: number; amount: number }>();
        for (const l of list) { const k = `${l.vendor ?? NO_VENDOR_LABEL} ${l.placeType || l.sheetName || "-"}`; const v = by.get(k) ?? { count: 0, amount: 0 }; v.count++; v.amount += Number(l.amount); by.set(k, v); }
        for (const [label, v] of by) existing.push({ label, ...v, action });
      }
    }
    // 기존 줄을 다른 내용으로 바꾸려는 것 같으면 경고 (날짜 범위·건수·파일 이름의 구분)
    const fileLabel = (typeof rawName === "string" ? rawName : "");
    const warnings = old
      ? replaceWarnings(
        relabeledLines.map((l) => ({ ...l, date: l.date ? l.date.toISOString().slice(0, 10) : null })),
        parsed.lines.map((l) => ({ label: l.label, date: l.date })),
        parsed.scope, vendorName, fileLabel, [...new Set(profile.map(sheetLabel))],
      )
      : [];
    return NextResponse.json({
      preview: { ...preview, people, existing, warnings }, labels: picks,
      profile: { vendorName, isNew: !!sent?.isNew, periodStartDay: startDay, sheets: parsed.resolved },
      vendor: { name: vendorName, auto: !!auto, isNew: !saved }, vendors: names, displayItems: items,
      period: passPeriod(ym, startDay), usingSaved: !sent,
    });
  }

  if (parsed.lines.length === 0) throw new HttpError(400, `${ym}에 가져올 사용 내역이 없습니다.`, { errors: parsed.errors.slice(0, 50) });
  if (parsed.lines.length > MAX_LINES) throw new HttpError(413, `한 달 사용 내역이 너무 많습니다 (최대 ${MAX_LINES.toLocaleString("ko-KR")}건).`);
  if (parsed.errors.length && form.get("allowErrors") !== "1") {
    throw new HttpError(422, `읽을 수 없는 행 ${parsed.errors.length}건이 있습니다.`, { errors: parsed.errors.slice(0, 100), errorCount: parsed.errors.length, lineCount: parsed.lines.length });
  }

  const fileName = (typeof rawName === "string" ? rawName : "").slice(0, 120) || "업체내역";
  // 구분이 바뀐 설정: 기존 줄의 구분을 먼저 바꿔야 이번 파일이 그 줄을 교체한다 (이중 집계 방지)
  const relabeled = await applyRelabels(id, vendorName, merge.relabels);
  const result = await saveStatement(user, id, ym, fileName, parsed.lines, parsed.scope, vendorName, startDay);
  // 업체 서식 저장 (처음·다시 설정했거나, 머리글 행이 옮겨진 경우) — 고른 업체의 서식에만, 이 파일에 없는 시트의 설정은 유지
  if (sent || JSON.stringify(merge.sheets) !== JSON.stringify(saved?.sheets)) {
    await saveImportProfile(user, id, vendorName, merge.sheets, startDay);
  }
  await saveItems();
  await audit(user, {
    projectId: id, entity: "PassStatement", entityId: result.statementId, action: result.replaced ? "reupload" : "upload",
    data: {
      ym, vendor: vendorName, autoVendor: !!auto, relabels: merge.relabels, relabeled, periodStartDay: startDay, fileName, scope: parsed.scope, kept: result.kept, lineCount: result.lineCount, errorCount: parsed.errors.length, unmatched: result.unmatched.length,
      carried: result.carried, autoDecided: result.autoDecided, profileSaved: !!sent,
    },
  });
  // 줄이 있는 팀원에게 "내 사용분 확인" 앱 내 알림 — 내역당 한 번 (실패해도 올리기는 그대로)
  await notify(passNotifications({ event: "uploaded", project: { id, name: project.name }, ym, statementId: result.statementId, userIds: result.userIds }));
  const { userIds: _userIds, ...out } = result;
  return NextResponse.json({ ...out, vendor: vendorName, errors: parsed.errors.slice(0, 100), errorCount: parsed.errors.length, perSheet: parsed.perSheet, profileSaved: !!sent }, { status: 201 });
});
