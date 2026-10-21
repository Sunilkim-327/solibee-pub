// 변경계약 입력 검증 (서버 전용)
import { HttpError } from "./access";
import { MONEY_MAX } from "./format";
import { prisma } from "./db";
import { parseDateOnly } from "./format";

/** 변경계약 증감액 한도 (원) — DB 정수 범위 안 */
// 21억 초과 가능 (금액 칸 BigInt) — 입력 실수만 막는 상한
export const MAX_AMOUNT_DELTA = MONEY_MAX;

export type ChangeInput = {
  title?: string;
  signedAt?: string;
  amountDelta?: number | string;
  startDate?: string;
  endDate?: string;
  managerId?: string | null;
  note?: string | null;
  /**
   * 과업 종료일이 본계약 종료일을 넘으면: true = 본계약 기간 연장 변경, 아니면 거부(다음 연차로 넘김 안내)
   * 연장하면 Project.endDate를 과업 종료일로 덮어쓴다. 원 종료일은 그 과업의 ContractChange.extendedFrom에 보존
   * (여러 번 연장하면 가장 이른 extendedFrom) — lib/change-extension.ts originalEndDate()로 읽는다.
   */
  extendProject?: boolean;
};

export async function validateChange(project: { id: string; startDate: Date; endDate: Date; seriesId?: string | null }, body: ChangeInput, current?: { title: string; signedAt: Date; amountDelta: number; startDate: Date; endDate: Date; managerId: string | null; note: string | null }) {
  const title = (body.title ?? current?.title ?? "").trim();
  if (!title) throw new HttpError(400, "과업명을 입력하세요.");
  if (title.length > 60) throw new HttpError(400, "과업명은 60자 이내로 입력하세요.");
  const signedAt = body.signedAt === undefined ? current?.signedAt ?? null : parseDateOnly(body.signedAt);
  const startDate = body.startDate === undefined ? current?.startDate ?? null : parseDateOnly(body.startDate);
  const endDate = body.endDate === undefined ? current?.endDate ?? null : parseDateOnly(body.endDate);
  if (!signedAt) throw new HttpError(400, "변경계약일을 입력하세요.");
  if (!startDate || !endDate || endDate < startDate) throw new HttpError(400, "과업 기간을 올바르게 입력하세요.");
  if (startDate < project.startDate) throw new HttpError(400, "과업 시작일은 본계약 시작일 이후여야 합니다.");
  if (endDate > project.endDate && !body.extendProject) {
    throw new HttpError(409, "과업 종료일이 본계약 종료일을 넘습니다.", { needsExtension: true });
  }
  if (endDate > project.endDate && project.seriesId) {
    const next = await prisma.project.findFirst({
      where: { seriesId: project.seriesId, id: { not: project.id }, startDate: { gt: project.startDate, lte: endDate } },
      select: { name: true },
    });
    if (next) throw new HttpError(409, `다음 연차(${next.name})와 기간이 겹쳐 연장할 수 없습니다. 남은 과업은 다음 연차에서 이어받으세요.`);
  }
  const rawDelta = body.amountDelta === undefined ? current?.amountDelta ?? 0 : Number(String(body.amountDelta).replace(/,/g, ""));
  if (!Number.isInteger(rawDelta)) throw new HttpError(400, "증감액은 원 단위 정수로 입력하세요.");
  if (Math.abs(rawDelta) > MAX_AMOUNT_DELTA) throw new HttpError(400, "증감액은 ±1조원 이내로 입력하세요.");
  const managerId = body.managerId === undefined ? current?.managerId ?? null : body.managerId || null;
  if (managerId) {
    const m = await prisma.user.findUnique({ where: { id: managerId }, select: { role: true, active: true } });
    if (!m || !m.active || m.role === "HQ" || m.role === "ADMIN") throw new HttpError(400, "담당 PM으로 지정할 수 없는 사용자입니다.");
  }
  const note = body.note === undefined ? current?.note ?? null : body.note?.trim() || null;
  return { title, signedAt, amountDelta: rawDelta, startDate, endDate, managerId, note };
}
