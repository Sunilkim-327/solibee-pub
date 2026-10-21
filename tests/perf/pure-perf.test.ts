// 순수 계산 라이브러리 성능 벤치 + 회귀 스냅샷
// - 합성 데이터(tests/perf/fixtures.ts, 한 달 600줄·직원 40명·항목 5개)로 함수별 실행 시간(ms, 중앙값)을 재고
// - 결과의 JSON(또는 큰 결과는 sha256)을 스냅샷으로 잡아 리팩토링 뒤에도 입력→출력이 완전히 같음을 보장한다.
// 실행: pnpm test tests/perf  (반복 횟수: PERF_ITERS=50 pnpm test tests/perf, 표 저장: PERF_OUT=경로)
//
// 2026-10-14 리팩토링 전 → 후 (같은 프로세스에서 HEAD 사본과 번갈아 80회, 중앙값 ms — 결과 JSON 동일 확인)
//   parseWorkbook 2시트 600줄  10.25 → 4.55   matchHolder ×600   2.29 → 0.20   chooseVendor(서식 2개) 1.06 → 0.07
//   nextUndecided ×600        15.32 → 2.38   bulkDecisions ×3   1.53 → 0.16   applyBulk              0.59 → 0.11
//   visibleExtra ×600          1.72 → 0.56   sheetSetups        0.28 → 0.15   settle 600건·40명      0.09 → 0.03
//   summarizeStatement         0.37 → 0.31   carryOver 600→600  5.19 → 4.74 (키 생성의 JSON 해석이 바닥)
//   companySplit·deductionList·memberExpectation·externalGroups·checkPolicy·closing: 이미 선형이라 변화 없음(±노이즈)
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  applyBulk, buildPreview, bulkDecisions, carryOver, chooseVendor, companySplit, dayLimitOver, deductionList, displayColumns, externalGroups, filterLines,
  matchHolder, memberExpectation, nextUndecided, parseExtra, parseWorkbook, pinClaims, profileScore, sheetSetups, summarizeStatement, visibleExtra, undecidedLines,
  type DisplayItem, type WorkbookResult,
} from "@/lib/pass-statement";
import { budgetSummary, monthlyByItem, payerUsage, riskItems, settle, type SettlementInput, type UsageRow } from "@/lib/settlement";
import { checkPolicy, koreanWon, dateWithWeekday, needsReview } from "@/lib/policy";
import { availableActions, defaultClosingMonth } from "@/lib/closing";
import { chunkIds } from "@/lib/chunk";
import type { ClosingStatus } from "@/lib/types";
import type { MonthSheetData } from "@/lib/month-sheet";
import { DISPLAY_KEYS, LINES, MEMBERS, START_DAY, YM, cafeConf, foodConf, items, makeCarryLines, makeHolders, makeLines, makeSheets, members, rng, type PerfLine } from "./fixtures";

// export.ts는 server-only·prisma를 불러오므로 흉내 (writeMonthSheet만 쓴다)
vi.mock("@/lib/access", () => ({ audit: async () => {}, HttpError: class HttpError extends Error {} }));
vi.mock("@/lib/sql-loaders", () => ({}));
vi.mock("@/lib/db", () => ({ toNumber: (v: unknown) => Number(v), prisma: {} }));

// ───────────────────────── 측정·직렬화

const ITERS = Number(process.env.PERF_ITERS) || 15;
const results: { name: string; ms: number }[] = [];

/** 함수 실행 시간 중앙값(ms) — 예열 3회 뒤 ITERS회. 마지막 반환값을 돌려준다 */
function bench<T>(name: string, fn: () => T): T {
  let out!: T;
  for (let i = 0; i < 3; i++) out = fn();
  const times: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    out = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  results.push({ name, ms: Math.round(times[Math.floor(times.length / 2)] * 1000) / 1000 });
  return out;
}

/** Map·Set·Date를 안정적으로 JSON으로 */
const ser = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x instanceof Map ? { __map: [...x] } : x instanceof Set ? { __set: [...x] } : x instanceof Date ? { __date: x.toISOString() } : x));
const sha = (v: unknown) => createHash("sha256").update(ser(v)).digest("hex");

afterAll(async () => {
  const w = Math.max(...results.map((r) => r.name.length));
  const table = results.map((r) => `${r.name.padEnd(w)}  ${String(r.ms.toFixed(3)).padStart(9)} ms`).join("\n");
  const text = `[perf] 규모: 한 달 ${LINES}줄 · 직원 ${MEMBERS}명 · 항목 ${items.length}개 (중앙값, ${ITERS}회)\n${table}\n`;
  console.log(`\n${text}`);
  // PERF_OUT=경로 를 주면 표를 파일로도 남긴다 (변경 전/후 비교용)
  if (process.env.PERF_OUT) await (await import("node:fs/promises")).writeFile(process.env.PERF_OUT, text, "utf8");
});

// ───────────────────────── 데이터

const lines = makeLines();
const sheets = makeSheets();
const profile = [foodConf, cafeConf];
const displayItems: DisplayItem[] = [...DISPLAY_KEYS.map((k) => ({ key: k, name: k })), { key: "옛항목", name: "옛항목", hidden: true }];
const holders = makeHolders();
const lineIds = lines.map((l) => l.id);
const halfIds = lineIds.filter((_, i) => i % 2 === 0);

// ───────────────────────── 출입증 명세

describe("출입증 명세 — 파일 해석", () => {
  let parsed: Extract<WorkbookResult, { ok: true }>;

  it("parseWorkbook (2시트 600줄)", () => {
    const r = bench("parseWorkbook", () => parseWorkbook(sheets, profile, YM, START_DAY, DISPLAY_KEYS));
    expect(r.ok).toBe(true);
    parsed = r as typeof parsed;
    expect(parsed.lines.length).toBeGreaterThan(500);
    expect({ count: parsed.lines.length, errors: parsed.errors.length, perSheet: parsed.perSheet, scope: parsed.scope, unconfigured: parsed.unconfigured }).toMatchSnapshot();
    expect(sha(parsed)).toMatchSnapshot();
  });

  it("buildPreview", () => {
    const p = bench("buildPreview", () => buildPreview(parsed));
    expect(sha(p)).toMatchSnapshot();
  });

  it("matchHolder × 600줄", () => {
    const m = bench("matchHolder x600", () => parsed.lines.map((l) => matchHolder(l, members, holders)));
    expect(m.filter((x) => x.userId).length).toBeGreaterThan(500);
    expect(sha(m)).toMatchSnapshot();
  });

  it("carryOver (기존 600줄 → 새 600줄)", () => {
    const old = makeCarryLines(lines);
    const fresh = lines.map((l) => ({ id: l.id, date: l.date, holderName: l.holderName, amount: l.amount, extra: l.extra, userId: l.userId }));
    // 표시 항목 순서가 바뀌어도 같은 줄로 이어받는지 — 새 줄의 extra 순서를 뒤집는다
    const shuffled = fresh.map((l) => ({ ...l, extra: l.extra ? JSON.stringify(parseExtra(l.extra).reverse()) : null }));
    const r = bench("carryOver", () => carryOver(old, shuffled));
    expect(r.carried).toBeGreaterThan(300);
    expect(sha(r)).toMatchSnapshot();
  });

  it("sheetSetups · profileScore · chooseVendor", () => {
    const s = bench("sheetSetups", () => sheetSetups(sheets, profile, displayItems));
    expect(sha(s)).toMatchSnapshot();
    const other = [{ ...foodConf, sheetName: "다른시트", nameCol: "없는이름" }];
    const score = bench("profileScore x2", () => [profileScore(sheets, profile), profileScore(sheets, other)]);
    expect(score).toMatchSnapshot();
    const v = bench("chooseVendor", () => chooseVendor(sheets, [{ vendorName: "B", sheets: other }, { vendorName: "A", sheets: profile }]));
    expect(v?.vendorName).toBe("A");
  });
});

describe("출입증 명세 — 집계·결정", () => {
  it("companySplit · dayLimitOver", () => {
    const s = bench("companySplit", () => companySplit(lines, items));
    expect(s.size).toBeGreaterThan(100);
    expect(sha(s)).toMatchSnapshot();
    const o = bench("dayLimitOver", () => dayLimitOver(lines, items));
    expect(sha(o)).toMatchSnapshot();
  });

  it("summarizeStatement", () => {
    const s = bench("summarizeStatement", () => summarizeStatement(lines, items));
    expect({ ...s, people: s.people.length, items: s.items }).toMatchSnapshot();
    expect(sha(s)).toMatchSnapshot();
  });

  it("deductionList", () => {
    const d = bench("deductionList", () => deductionList(lines, items));
    expect(d.map((p) => [p.userId, p.amount, p.count, p.onBehalf])).toMatchSnapshot();
    expect(sha(d)).toMatchSnapshot();
  });

  it("memberExpectation (전체 줄·한 사람 줄)", () => {
    const mine = lines.filter((l) => l.userId === "u07");
    const e = bench("memberExpectation", () => [memberExpectation(lines, items), memberExpectation(mine, items)]);
    expect(e).toMatchSnapshot();
  });

  it("externalGroups", () => {
    const g = bench("externalGroups", () => externalGroups(lines));
    expect(sha(g)).toMatchSnapshot();
  });

  it("bulkDecisions · applyBulk (절반 id 지정)", () => {
    const b = bench("bulkDecisions x3", () => [bulkDecisions(lines, "accept-claims", halfIds), bulkDecisions(lines, "all-overtime", halfIds), bulkDecisions(lines, "rest-deduct", null)]);
    expect(b.map((x) => x.length)).toMatchSnapshot();
    expect(sha(b)).toMatchSnapshot();
    const a = bench("applyBulk", () => applyBulk(lines, "all-overtime", halfIds, null, items, "PM"));
    expect(sha(a)).toMatchSnapshot();
  });

  it("pinClaims · filterLines · nextUndecided (모든 줄에서 다음 건)", () => {
    const pinned = bench("pinClaims+filterLines", () => filterLines(lines, pinClaims(lines)));
    expect(sha(pinned)).toMatchSnapshot();
    const visible = undecidedLines(lines).length;
    expect(visible).toBeGreaterThan(100);
    const next = bench("nextUndecided x600", () => lines.map((l, i) => nextUndecided(lines, l.id, i % 2 === 0)?.id ?? null));
    expect(sha(next)).toMatchSnapshot();
    expect(nextUndecided(lines, null)).toBe(undecidedLines(lines)[0]);
  });

  it("visibleExtra × 600 · displayColumns", () => {
    const extras = lines.map((l) => parseExtra(l.extra));
    const v = bench("visibleExtra x600", () => extras.map((e) => visibleExtra(e, displayItems)));
    expect(v[0]).toMatchSnapshot();
    expect(sha(v)).toMatchSnapshot();
    const c = bench("displayColumns", () => displayColumns(displayItems, extras.map((extra) => ({ extra }))));
    expect(c).toMatchSnapshot();
  });
});

// ───────────────────────── 정산·규정·마감

const r = rng(11);
const payerIds = members.map((m) => m.userId);
const expenses: SettlementInput[] = Array.from({ length: LINES }, (_, i) => {
  const k = r();
  const isHq = k < 0.1;
  return {
    amount: (10 + Math.floor(r() * 500)) * 100, payMethod: isHq ? "HQ" : k < 0.25 ? "SHARED_CARD" : "PERSONAL_CARD", isHq, payerId: payerIds[Math.floor(r() * MEMBERS)],
    itemId: items[i % items.length].id, yearMonth: `2026-${String(1 + (i % 12)).padStart(2, "0")}`,
  };
});

describe("정산·예산 (settlement)", () => {
  it("settle (600건·결제자 40명)", () => {
    const s = bench("settle", () => settle(expenses, payerIds));
    expect(s.isValid).toBe(true);
    expect(s).toMatchSnapshot();
  });

  it("budgetSummary · monthlyByItem · payerUsage · riskItems", () => {
    const b = bench("budgetSummary", () => budgetSummary(items.map((it, i) => ({ itemId: it.id, planned: (i + 1) * 1_000_000 })), expenses));
    expect(b).toMatchSnapshot();
    const m = bench("monthlyByItem", () => monthlyByItem(expenses));
    expect(m).toMatchSnapshot();
    const sums = members.slice(5).map((x, i) => ({ payerId: i % 9 === 0 ? `x${i}` : x.userId, name: x.name, amount: i * 1000, count: i % 3 }));
    const p = bench("payerUsage", () => payerUsage(members.map((x) => ({ id: x.userId, name: x.name })), sums));
    expect(sha(p)).toMatchSnapshot();
    const rows: UsageRow[] = Array.from({ length: 60 }, (_, i) => ({
      itemId: `i${i}`, itemName: `항목${i}`, categoryName: `분류${i % 4}`, planned: 1_000_000, spent: i * 30_000, forecast: 900_000 + i * 10_000,
      months: Array.from({ length: 12 }, (_, m) => m * 1000), regular: i % 5 !== 0,
    }));
    const rk = bench("riskItems", () => riskItems(rows, 50, 10));
    expect(rk.map((x) => [x.itemId, x.status, x.rate])).toMatchSnapshot();
  });
});

describe("규정 점검 (policy)", () => {
  it("checkPolicy × 600 · koreanWon · dateWithWeekday", () => {
    const item = { name: "야근식대", accountCode: "복리후생비", perPersonLimit: 12_000, perCaseLimit: 100_000 };
    const inputs = expenses.map((e, i) => ({
      amount: e.amount, headcount: i % 4 === 0 ? null : 1 + (i % 6), date: new Date(Date.UTC(2026, 8, 1 + (i % 28))), hasExternal: i % 7 === 0, item,
      remainingBefore: i % 3 === 0 ? null : 50_000, sameEntries: i % 11 === 0 ? 1 : 0, passDuplicate: i % 13 === 0,
    }));
    const f = bench("checkPolicy x600", () => inputs.map(checkPolicy));
    expect(sha(f)).toMatchSnapshot();
    expect(f.filter((x) => needsReview(x.map((y) => y.code).join(","))).length).toMatchSnapshot();
    const w = bench("koreanWon x600", () => expenses.map((e) => koreanWon(e.amount * 137)));
    expect(sha(w)).toMatchSnapshot();
    const d = bench("dateWithWeekday x600", () => lines.map((l) => dateWithWeekday(l.date)));
    expect(sha(d)).toMatchSnapshot();
  });
});

describe("마감 (closing) · chunk", () => {
  it("defaultClosingMonth · availableActions", () => {
    const statuses: ClosingStatus[] = ["DRAFT", "CLOSED", "SUBMITTED", "APPROVED", "REJECTED"];
    const rows = Array.from({ length: 120 }, (_, i) => ({ ym: `${2020 + Math.floor(i / 12)}-${String(1 + (i % 12)).padStart(2, "0")}`, status: statuses[(i * 7) % 5] }));
    const d = bench("defaultClosingMonth x3", () => [defaultClosingMonth(rows, "MANAGER", "2026-10"), defaultClosingMonth(rows, "HQ", "2026-10"), defaultClosingMonth(rows.filter((x) => x.status === "APPROVED"), "MANAGER", "2026-10")]);
    expect(d).toMatchSnapshot();
    const a = bench("availableActions x5", () => statuses.map((s) => [availableActions(s, "MANAGER"), availableActions(s, "HQ")]));
    expect(a).toMatchSnapshot();
    expect(chunkIds(lineIds).map((c) => c.length)).toMatchSnapshot();
  });
});

// ───────────────────────── 엑셀 월 시트 (exceljs)

describe("엑셀 월 시트 (writeMonthSheet)", () => {
  it("600줄 월 시트 — 셀 값·수식·서식이 기준과 같다", async () => {
    const { writeMonthSheet } = await import("@/lib/export");
    const rr = rng(23);
    const row = (i: number, isHq: boolean) => ({
      label: isHq ? "본사" : i % 9 === 0 ? "공용법인카드" : members[i % MEMBERS].name, date: new Date(Date.UTC(2026, 8, 1 + (i % 30))), amount: (10 + Math.floor(rr() * 500)) * 100,
      method: isHq ? "본사지출" : "개인카드", category: `분류${i % 4}`, item: `항목${i % 5}`, detail: `세부내역 ${i}`, headcount: i % 3 === 0 ? null : 1 + (i % 5), attendees: i % 3 === 0 ? null : `참석자${i % 7}`,
    });
    const personal = Array.from({ length: 540 }, (_, i) => row(i, false));
    const hq = Array.from({ length: 60 }, (_, i) => row(i, true));
    const byPayer: Record<string, number> = {};
    for (const p of personal) if (p.label !== "공용법인카드") byPayer[p.label] = (byPayer[p.label] ?? 0) + p.amount;
    const sharedCard = personal.filter((p) => p.label === "공용법인카드").reduce((a, p) => a + p.amount, 0);
    const hqSum = hq.reduce((a, p) => a + p.amount, 0);
    const personalSum = personal.reduce((a, p) => a + p.amount, 0);
    const data: MonthSheetData = {
      personal, travel: [], travelSum: 0, hq,
      st: { total: personalSum + hqSum, personal: personalSum, byPayer, sharedCard, hq: hqSum, pass: 0, isValid: true },
      slots: Object.entries(byPayer).map(([label, amount]) => ({ label, amount })),
    };
    const build = (kind: "names" | "inline") => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("9월");
      writeMonthSheet(ws, data, kind === "names" ? { kind } : { kind, methods: ["개인카드", "공용법인카드", "본사지출"], categories: ["분류0", "분류1", "분류2", "분류3"], start: new Date(Date.UTC(2026, 0, 1)), end: new Date(Date.UTC(2026, 11, 31)) });
      return ws;
    };
    const ws = bench("writeMonthSheet(names) 600줄", () => build("names"));
    bench("writeMonthSheet(inline) 600줄", () => build("inline"));
    const cells: unknown[] = [];
    ws.eachRow({ includeEmpty: false }, (r, n) => r.eachCell({ includeEmpty: true }, (c, i) => cells.push([n, i, r.height ?? null, c.value instanceof Date ? c.value.toISOString() : c.value, c.numFmt ?? null, c.style, c.dataValidation ?? null])));
    const merges = Object.keys((ws as unknown as { _merges: Record<string, unknown> })._merges).sort();
    expect(cells.length).toBeGreaterThan(5000);
    expect(sha({ cells, merges, widths: (ws.columns ?? []).map((c) => c.width ?? null) })).toMatchSnapshot();
    const inline = build("inline");
    const vals: unknown[] = [];
    inline.eachRow({ includeEmpty: false }, (r, n) => r.eachCell({ includeEmpty: true }, (c, i) => vals.push([n, i, c.value instanceof Date ? c.value.toISOString() : c.value, c.numFmt ?? null, c.style, c.dataValidation ?? null])));
    expect(sha(vals)).toMatchSnapshot();
  });
});

// 타입 확인용 (PerfLine이 집계·결정 함수 입력 타입을 모두 만족하는지)
const _typeCheck: PerfLine[] = lines;
void _typeCheck;
