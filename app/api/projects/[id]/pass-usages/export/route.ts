import ExcelJS from "exceljs";
import { HttpError, apiUser, assertProjectRole, route } from "@/lib/access";
import { prisma } from "@/lib/db";
import { boxRow, headRow as head, xlsxDownload } from "@/lib/export";
import { isYearMonth, sheetName, won } from "@/lib/format";
import { summarizePass } from "@/lib/pass";
import { canSeeAllPass } from "@/lib/pass-statement";

type Params = { id: string };

/** 출입증 사용 내역 엑셀 (업체 전달용) — PM·재무 승인·시스템 관리자 */
export const GET = route<Params>(async (req, { params }) => {
  const { id } = await params;
  const { project, user } = await assertProjectRole(await apiUser(), id, ["MANAGER", "HQ", "ADMIN"]);
  // 상위 PM·조직장 조회(view)는 개인별 사용 내역을 받을 수 없음
  if (!canSeeAllPass(user)) throw new HttpError(403, "PM·재무 승인·시스템 관리자만 내려받을 수 있습니다.");
  const ym = new URL(req.url).searchParams.get("ym");
  if (!isYearMonth(ym)) throw new HttpError(400, "ym은 YYYY-MM 형식입니다.");
  const rows = await prisma.clientPassUsage.findMany({
    where: { projectId: id, yearMonth: ym },
    include: { user: { select: { name: true } }, item: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const s = summarizePass(rows.map((r) => ({ userId: r.userId, userName: r.user.name, itemId: r.itemId, itemName: r.item.name, amount: r.amount, placeType: r.placeType })));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${sheetName(ym)} 출입증 사용`);
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 12 }, { width: 9 }, { width: 20 }, { width: 12 }, { width: 7 }, { width: 28 }];
  ws.getCell("A1").value = `${project.name} · ${project.clientPassName ?? "출입증"} 사용 내역 (${sheetName(ym)})`;
  ws.getCell("A1").font = { bold: true, size: 13 };

  // 1) 항목별 합계 (사용처 구분 내역)
  ws.getCell("A3").value = "항목별 합계";
  ws.getCell("A3").font = { bold: true };
  ws.getRow(4).values = ["항목", "건수", "합계", "사용처 내역"];
  head(ws.getRow(4));
  ws.mergeCells("D4:H4");
  let r = 5;
  for (const it of s.byItem) {
    const row = ws.getRow(r);
    row.values = [it.name, it.count, it.amount, it.places.map((p) => `${p.placeType} ${won(p.amount)}원`).join(" · ")];
    row.getCell(3).numFmt = "#,##0";
    ws.mergeCells(`D${r}:H${r}`);
    boxRow(row, 4);
    r++;
  }
  const t = ws.getRow(r);
  t.values = ["합계", s.count, s.total];
  t.getCell(3).numFmt = "#,##0";
  t.font = { bold: true };
  boxRow(t, 3);

  // 2) 상세 내역
  r += 2;
  ws.getCell(`A${r}`).value = "상세 내역";
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  ws.getRow(r).values = ["날짜", "팀원", "항목", "사용처 구분", "사용처", "금액", "인원", "비고"];
  head(ws.getRow(r));
  r++;
  for (const x of rows) {
    const row = ws.getRow(r++);
    row.values = [x.date, x.user.name, x.item.name, x.placeType, x.place ?? "", x.amount, x.headcount ?? "", x.memo ?? ""];
    row.getCell(1).numFmt = "yyyy-mm-dd";
    row.getCell(6).numFmt = "#,##0";
    boxRow(row, 8);
  }

  // 3) 팀원별
  r++;
  ws.getCell(`A${r}`).value = "팀원별";
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  for (const u of s.byUser) {
    const row = ws.getRow(r++);
    row.values = [u.name, `${u.count}건`, u.amount];
    row.getCell(3).numFmt = "#,##0";
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `${project.name}_${project.clientPassName ?? "업체출입증"}_사용내역(${ym}).xlsx`;
  return xlsxDownload(user, { projectId: id, entityId: id, filename, buffer });
});
