import ExcelJS from "exceljs";
import { byPositionThenName } from "@/lib/org";
import { HttpError, apiUser, assertProjectRole, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { boxRow, headRow as head, xlsxDownload } from "@/lib/export";
import { formatDate, sheetName, won as money } from "@/lib/format";
import {
  DECISION_LABEL, NO_VENDOR_LABEL, applyConfirmedDefaults, canSeeAllPass, deductionList, displayColumns, displayItemsOf, externalGroups, isDecision, onBehalfNote, parseExtra, sourceLabel, summarizeStatement,
} from "@/lib/pass-statement";
import { getImportProfiles, passItems, passMembers } from "@/lib/pass-statement-server";

type Params = { id: string };

const fmtDate = (d: Date | null) => (d ? formatDate(d) : "");

/**
 * 출입증 내역 엑셀 (?kind=deduct|full) — 이 프로젝트 PM·재무 승인·시스템 관리자
 * - deduct: 급여 공제 대상 (인사·급여 전달용) — 팀원별 합계(외부인 대납 비고) + 상세
 * - full: 업체 대조·청구용 전체 내역 (결정 포함) + 외부인 수금
 * 표시 열은 프로젝트 공통 목록 순서로 열을 만들고(이름은 보이는 이름), 그 업체 줄에 없는 값은 '—'. 전체 내역에는 업체 열도 둔다.
 */
export const GET = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const me = await apiUser();
  const st = await prisma.passStatement.findUnique({ where: { id }, include: { lines: { orderBy: { order: "asc" }, include: { usageItem: { select: { name: true } } } } } });
  if (!st) throw new HttpError(404, "출입증 내역을 찾을 수 없습니다.");
  const { project, user } = await assertProjectRole(me, st.projectId, ["MANAGER", "HQ", "ADMIN"]);
  if (!canSeeAllPass(user)) throw new HttpError(403, "PM·재무 승인·시스템 관리자만 내려받을 수 있습니다.");
  const kind = new URL(req.url).searchParams.get("kind") === "full" ? "full" : "deduct";
  // 팀원·업체 서식·회사 부담 항목은 서로 무관 — 한 번에 읽는다
  const [memberList, profiles, items] = await Promise.all([passMembers(st.projectId, st.yearMonth), getImportProfiles(st.projectId), passItems(st.projectId)]);
  const members = new Map(memberList.map((m) => [m.userId, m as { name: string; loginId: string | null; department: string | null; position?: string | null }]));
  // 팀원에서 빠진 사람도 이름은 표시
  const missing = [...new Set(st.lines.map((l) => l.userId).filter((u): u is string => !!u && !members.has(u)))];
  if (missing.length) {
    const extra = await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, loginId: true, email: true, position: true, department: { select: { name: true } } } });
    for (const u of extra) members.set(u.id, { name: u.name, loginId: u.loginId ?? u.email, department: u.department?.name ?? null, position: u.position });
  }
  const nameOf = (uid: string | null) => (uid ? members.get(uid)?.name ?? "" : "");

  // 표시 열 — 프로젝트 공통 목록 순서 (숨긴 항목 제외, 목록에 없는 옛 이름표는 뒤에).
  // 확정된 내역의 빈 결정은 본인 부담(출처 "기본")으로 — 급여 공제·전체 내역의 결정 열이 화면과 같게
  const lines = applyConfirmedDefaults(st.lines, st.status).map((l) => ({ ...l, extraFields: parseExtra(l.extra), usageItemName: l.usageItem?.name ?? null }));
  const columns = displayColumns(displayItemsOf(project.passDisplayItems, profiles), lines.map((l) => ({ extra: l.extraFields })));
  const labels = columns.map((c) => c.name);
  const extraValues = (l: (typeof lines)[number]) => columns.map((c) => l.extraFields.find((e) => e.label === c.key)?.value ?? "—");
  const hasVendor = lines.some((l) => l.vendor);
  const hasDate = lines.some((l) => l.date);

  const passName = project.clientPassName ?? "출입증";
  const status = st.status === "CONFIRMED" ? "확정" : "확정 전 (임시)";
  const wb = new ExcelJS.Workbook();

  if (kind === "deduct") {
    const list = deductionList(lines, items).map((p) => ({ ...p, m: members.get(p.userId) })).sort((a, b) => byPositionThenName({ position: a.m?.position, name: a.m?.name ?? "" }, { position: b.m?.position, name: b.m?.name ?? "" }));
    const ws = wb.addWorksheet("급여 공제 대상");
    ws.columns = [{ width: 12 }, { width: 28 }, { width: 18 }, { width: 14 }, { width: 8 }, { width: 36 }];
    ws.getCell("A1").value = `${project.name} · ${passName} 급여 공제 대상 (${sheetName(st.yearMonth)}) — ${status}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getRow(3).values = ["이름", "아이디(이메일)", "부서", "공제 금액", "건수", "비고"];
    head(ws.getRow(3));
    let r = 4;
    for (const p of list) {
      const row = ws.getRow(r++);
      row.values = [p.m?.name ?? "", p.m?.loginId ?? "", p.m?.department ?? "", p.amount, p.count, onBehalfNote(p.onBehalf)];
      row.getCell(4).numFmt = "#,##0";
      boxRow(row, 6);
    }
    const t = ws.getRow(r);
    t.values = ["합계", "", "", list.reduce((a, p) => a + p.amount, 0), list.reduce((a, p) => a + p.count, 0), ""];
    t.getCell(4).numFmt = "#,##0";
    t.font = { bold: true };
    boxRow(t, 6);

    const ds = wb.addWorksheet("공제 상세");
    const cols = ["이름", "아이디(이메일)", ...(hasDate ? ["사용일"] : []), "구분", ...labels, "금액", "실제 사용한 사람", "팀원 요청", "비고"];
    ds.columns = cols.map((c) => ({ width: c === "아이디(이메일)" ? 28 : c === "비고" ? 30 : 14 }));
    ds.getRow(1).values = cols;
    head(ds.getRow(1));
    const amountCol = cols.indexOf("금액") + 1;
    let d = 2;
    for (const p of list) {
      for (const l of p.lines) {
        const row = ds.getRow(d++);
        row.values = [
          p.m?.name ?? "", p.m?.loginId ?? "", ...(hasDate ? [fmtDate(l.date)] : []), l.placeType ?? l.sheetName ?? "", ...extraValues(l), l.deductAmount,
          // 팀원이 업무 사용을 요청했는데 PM이 본인 부담으로 정한 줄은 그 사실을 남긴다 (한도 초과분 줄은 회사 부담 결정이라 "업무 사용")
          l.onBehalfName ? `외부인 ${l.onBehalfName}` : "", l.memberClaim === "OVERTIME" ? (l.decision === "DEDUCT" ? "업무 사용(본인 부담 처리)" : "업무 사용") : "",
          // 회사 부담 줄의 하루 한도 초과분만 공제하는 건은 비고에 사용 금액·회사 부담분을 남긴다
          [l.companyAmount > 0 ? `1일 한도 초과분 (사용 ${money(l.amount)}원 중 회사 부담 ${money(l.companyAmount)}원)` : "", l.memberNote ?? l.collectNote ?? ""].filter(Boolean).join(" · "),
        ];
        row.getCell(amountCol).numFmt = "#,##0";
        boxRow(row, cols.length);
      }
    }
  } else {
    const s = summarizeStatement(lines.map((l) => ({ ...l, userName: nameOf(l.userId) })), items);
    const ws = wb.addWorksheet("업체 대조용 전체 내역");
    const cols = [...(hasDate ? ["사용일"] : []), ...(hasVendor ? ["업체"] : []), "구분", "이름(업체)", "연결 키", ...labels, "금액", "팀원", "실제 사용한 사람", "팀원 요청", "결정", "회사 부담 항목", "결정 출처", "비고"];
    ws.columns = cols.map((c) => ({ width: c === "비고" ? 30 : 13 }));
    ws.getCell("A1").value = `${project.name} · ${passName} 사용 내역 대조 (${sheetName(st.yearMonth)}) — ${status}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = `총 ${s.total.count}건 ${money(s.total.amount)}원 · 회사 부담 ${money(s.overtime.amount)}원 · 본인 부담 ${money(s.deduct.amount)}원`
      + `${s.external.count ? ` (외부인 대납 ${money(s.external.amount)}원 포함)` : ""}${s.undecided.count ? ` · 미결정 ${s.undecided.count}건` : ""}`;
    ws.getRow(4).values = cols;
    head(ws.getRow(4));
    const amountCol = cols.indexOf("금액") + 1;
    let r = 5;
    // 업체 → 구분 → 날짜 → 시간 순 (업체 청구서와 대조하기 쉽게)
    const key = (l: (typeof lines)[number]) => [l.vendor ?? "", l.placeType ?? l.sheetName ?? "", l.date ? fmtDate(l.date) : "", l.time ?? ""];
    const sorted = [...lines].sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) { const c = x[i].localeCompare(y[i], "ko"); if (c) return c; } return a.order - b.order; });
    for (const l of sorted) {
      const row = ws.getRow(r++);
      row.values = [
        ...(hasDate ? [fmtDate(l.date)] : []), ...(hasVendor ? [l.vendor ?? NO_VENDOR_LABEL] : []), l.placeType ?? l.sheetName ?? "", l.holderName, l.holderKey ?? "", ...extraValues(l), l.amount,
        nameOf(l.userId) || "(미확인)", l.onBehalfName ? `외부인 ${l.onBehalfName}` : "",
        l.memberClaim === "OVERTIME" ? `업무 사용${l.usageItemName && !l.decision ? ` (${l.usageItemName})` : ""}` : "", // 확정된 내역은 applyConfirmedDefaults로 빈 값이 본인 부담이 되므로, 여기 오는 미결정 줄은 확정 전(OPEN)뿐 — 요약의 '미결정 N건'과 같은 말
        isDecision(l.decision) ? DECISION_LABEL[l.decision] : l.memberClaim === "OVERTIME" ? "PM 확인 전" : "미결정(확정 시 본인 부담)",
        l.decision === "OVERTIME" ? l.usageItemName ?? "항목 미지정" : "",
        sourceLabel(l.decisionSource), l.memberNote ?? l.collectNote ?? "",
      ];
      row.getCell(amountCol).numFmt = "#,##0";
      boxRow(row, cols.length);
    }
    const t = ws.getRow(r);
    t.getCell(1).value = "합계";
    t.getCell(amountCol).value = s.total.amount;
    t.getCell(amountCol).numFmt = "#,##0";
    t.font = { bold: true };
    boxRow(t, cols.length);

    // 회사 부담 항목별 합계 (식당·카페 등 사용처 내역)
    const is = wb.addWorksheet("항목별 합계");
    is.columns = [{ width: 18 }, { width: 8 }, { width: 14 }, { width: 40 }];
    is.getRow(1).values = ["회사 부담 항목", "건수", "금액", "사용처별"];
    head(is.getRow(1));
    s.items.forEach((it, i) => {
      const row = is.getRow(i + 2);
      row.values = [it.name, it.count, it.amount, it.places.map((p) => `${p.place} ${money(p.amount)}`).join(" · ")];
      row.getCell(3).numFmt = "#,##0";
      boxRow(row, 4);
    });
    if (!s.items.length) is.getCell("A2").value = "회사 부담으로 정한 내역 없음";

    // 외부인 수금 (PM이 대신 공제받고 외부인에게 받아 낼 금액)
    const groups = externalGroups(lines);
    const xs = wb.addWorksheet("외부인 수금");
    xs.columns = [{ width: 14 }, { width: 12 }, { width: 8 }, { width: 14 }, { width: 10 }, { width: 30 }];
    xs.getRow(1).values = ["외부인(받을 대상)", "대납 PM", "건수", "금액", "받음", "비고"];
    head(xs.getRow(1));
    let x = 2;
    for (const g of groups) {
      const row = xs.getRow(x++);
      row.values = [g.name, g.payerIds.map(nameOf).join(", "), g.count, g.amount, g.allCollected ? "받음" : g.collected ? `${g.collected}/${g.count}` : "", g.note ?? ""];
      row.getCell(4).numFmt = "#,##0";
      boxRow(row, 6);
    }
    if (!groups.length) xs.getCell("A2").value = "외부인 사용 처리 건 없음";
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `${project.name}_${passName}_${kind === "deduct" ? "급여공제대상" : "전체내역"}(${st.yearMonth}).xlsx`;
  return xlsxDownload(user, { projectId: st.projectId, entityId: id, filename, buffer });
});
