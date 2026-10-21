// 프로젝트별 항목 관리 — 새 프로젝트는 공통 기본 항목(또는 다른 프로젝트 항목)을 복사해 시작한다
import type { PrismaClient } from "@prisma/client";
import type { Db as DbClient, Tx } from "./db";

// 시드(prisma/seed.ts)는 확장 없는 PrismaClient를 넘긴다
type Db = DbClient | Tx | PrismaClient;

/**
 * 항목 복사
 * @param from null = 공통 기본 항목, 문자열 = 다른 프로젝트 id
 * @param idFor 새 항목 id 생성 규칙 (기본: 자동). 시드처럼 고정 id가 필요할 때 사용
 * @param onlyIds 이 원본 항목만 복사 (공통 항목에서 고른 것)
 * @returns 원본 항목 id → 새 항목 id
 */
export async function copyItems(db: Db, toProjectId: string, from: string | null, idFor?: (src: { id: string; code: string | null }) => string, onlyIds?: string[]) {
  const src = await db.item.findMany({ where: { projectId: from, ...(onlyIds ? { id: { in: onlyIds } } : {}) }, orderBy: [{ categoryId: "asc" }, { order: "asc" }] });
  const map = new Map<string, string>();
  for (const it of src) {
    const created = await db.item.create({
      data: {
        ...(idFor ? { id: idFor(it) } : {}),
        projectId: toProjectId,
        code: it.code ?? it.id,
        categoryId: it.categoryId,
        name: it.name,
        accountCode: it.accountCode,
        keywords: it.keywords,
        perPersonLimit: it.perPersonLimit,
        perCaseLimit: it.perCaseLimit,
        hardBudget: it.hardBudget,
        needsAttendees: it.needsAttendees,
        order: it.order,
        active: it.active,
      },
    });
    map.set(it.id, created.id);
  }
  // 출입증 항목의 연결 예산 항목도 복사한 항목으로 다시 잇는다
  for (const it of src) {
    if (it.linkedItemId && map.has(it.linkedItemId)) await db.item.update({ where: { id: map.get(it.id)! }, data: { linkedItemId: map.get(it.linkedItemId)! } });
  }
  return map;
}
