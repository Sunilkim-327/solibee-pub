import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { autoDecide, noOvertimeSource } from "@/lib/overtime";
import { fileToSheets } from "@/lib/pass-import";
import {
  applyBulk, applyClear, applyConfirmedDefaults, buildPreview, bulkDecisions, canAssumeExternal, clearTargets, clearableLines, filterLines, filterPeople, nextUndecided, pinClaims, undecidedLines, canManagePass, canReopenPass, canSeeAllPass, carryOver, cellText, confirmProblem, decodeText, deductionList,
  detectHeader, externalAssignment, externalGroups, holderMapKey, linePatchProblem, mappingKeys, matchHolder, matchKey, memberExpectation,
  normStartDay, onBehalfNote, parseCellAmount, parseCellDate, parseCsv, parseProfile, parseSheet, parseWorkbook, passMonthOf, passPeriod, passPeriodLabel,
  resolveSheet, sheetSetups, suggestColumns, choiceItemId, choiceOf, choiceToClaim, claimRestorePatch, claimSnapshot, claimToggleText, memberListNotice, memberListTitle, choiceToDecision, claimChoiceOf, colLetter, companyChoice, decisionSourceOf, isCompanyChoice, sourceLabel,
  dayLimitOver, defaultDeductIds, summarizeStatement, toSheetConfig, mergeProfile, sheetLabel, splitByScope, sheetsFromWire, sheetsToWire, type CarryLine, type SheetConfig, type Sheet,
} from "@/lib/pass-statement";
import { buildTodos } from "@/lib/todo";

// 모든 값은 가상 데이터 (실제 업체 파일·이름 사용 금지)
const FOOD_HEAD = ["판매일자", "판매시간", "고객성명", "사원카드번호", "상품한글명", "매대명", "사원번호", "표시금액1", "개인부담금액", "회사부담금액", "총금액1"];
const foodSheet = (rows: (string | number | null)[][], formulas?: Set<string>): Sheet => ({ name: "식당", table: [FOOD_HEAD, ...rows], formulas });
const foodConf: SheetConfig = { sheetName: "식당", headerRow: 1, nameCol: "고객성명", keyCols: ["사원카드번호"], amountCols: ["총금액1"], dateCol: "판매일자", display: [{ item: "판매시간", col: "판매시간" }, { item: "상품한글명", col: "상품한글명" }] };

describe("파일 읽기", () => {
  it("CSV: UTF-8 BOM, 따옴표·쉼표, 앞자리 0 보존", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('이름,금액\n"홍길동","12,000"\n김테스트,00123\n')]);
    const t = parseCsv(decodeText(bytes));
    expect(t[0]).toEqual(["이름", "금액"]);
    expect(t[1]).toEqual(["홍길동", "12,000"]);
    expect(t[2][1]).toBe("00123");
  });

  it("CSV: EUC-KR(CP949) 대체 해석", () => {
    // "홍길동" EUC-KR 바이트
    const bytes = new Uint8Array([0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf, 0x2c, 0x31]);
    expect(parseCsv(decodeText(bytes))[0]).toEqual(["홍길동", "1"]);
  });

  it("탭 구분 CSV", () => {
    expect(parseCsv("이름\t금액\n가\t1")[1]).toEqual(["가", "1"]);
  });

  it("날짜·금액 해석", () => {
    const ymd = (v: Parameters<typeof parseCellDate>[0]) => parseCellDate(v)?.toISOString().slice(0, 10) ?? null;
    expect(ymd("2026-10-05")).toBe("2026-10-05");
    expect(ymd("2026.10.05")).toBe("2026-10-05");
    expect(ymd("2026. 10. 5.")).toBe("2026-10-05");
    expect(ymd("20261005")).toBe("2026-10-05");
    expect(ymd(20261005)).toBe("2026-10-05");
    expect(ymd(46300)).toBe("2026-10-05"); // 엑셀 일련번호
    expect(ymd(new Date(Date.UTC(2026, 9, 5)))).toBe("2026-10-05");
    expect(ymd("2026-02-30")).toBeNull();
    expect(ymd("합계")).toBeNull();
    expect(parseCellAmount("12,000원")).toBe(12000);
    expect(parseCellAmount("₩ 8,500")).toBe(8500);
    expect(parseCellAmount("(3,000)")).toBe(-3000);
    expect(parseCellAmount(4500)).toBe(4500);
    expect(parseCellAmount(12.5)).toBeNull();
    expect(parseCellAmount("abc")).toBeNull();
    expect(cellText(new Date(Date.UTC(1899, 11, 30, 19, 5, 0)))).toBe("19:05:00"); // 엑셀 시간
  });
});

describe("머리글 추천", () => {
  it("업체 머리글 동의어 — 이름·금액(총금액 우선)·날짜·카드번호·표시 항목", () => {
    const s = suggestColumns(FOOD_HEAD)!;
    expect(s.nameCol).toBe(2);
    expect(s.amountCols).toEqual([10]); // 총금액1 (표시금액1보다 우선)
    expect(s.dateCol).toBe(0);
    expect(s.keyCols).toEqual([3]);
    expect(s.display).toEqual({ 판매시간: 1, 상품한글명: 4, 매대명: 5 }); // 표시 항목 목록이 없으면(처음) 시간·상품·매대 머리글 이름으로 추천
  });

  it("영문·일반 머리글", () => {
    const s = suggestColumns(["Date", "Name", "Store", "Amount"])!;
    expect(s).toMatchObject({ nameCol: 1, amountCols: [3], dateCol: 0 });
  });

  it("표지 아래 머리글 행 찾기, 공문 시트는 인식 안 됨", () => {
    expect(detectHeader([["월 사용 내역"], [], ["사용일", "성명", "결제금액"]])?.headerRow).toBe(3);
    expect(detectHeader([["수신: 테스트 회사"], ["제목: 이용 요금 청구"]])).toBeNull();
  });

  it("시트 설정 후보: 표지 시트는 기본 미선택", () => {
    const setups = sheetSetups([{ name: "공문(식당)", table: [["청구 안내"]] }, foodSheet([["2026-10-01", "12:00:00", "홍길동", "001", "백반", "A", "9", 8000, 0, 8000, 8000]])]);
    expect(setups.map((s) => [s.name, s.include])).toEqual([["공문(식당)", false], ["식당", true]]);
  });
});

describe("업체 양식", () => {
  it("화면 선택 → 머리글 글자로 저장, 빈 머리글은 #열번호", () => {
    const conf = toSheetConfig("식당", 1, FOOD_HEAD, { nameCol: 2, keyCols: [3], amountCols: [8, 9], dateCol: 0, display: { 상품: 4 } })!;
    expect(conf).toMatchObject({ nameCol: "고객성명", keyCols: ["사원카드번호"], amountCols: ["개인부담금액", "회사부담금액"], dateCol: "판매일자", display: [{ item: "상품", col: "상품한글명" }] });
    expect(toSheetConfig("x", 1, ["", "금액"], { nameCol: 0, keyCols: [], amountCols: [1], display: {} })!.nameCol).toBe("#0");
    expect(toSheetConfig("x", 1, ["이름"], { keyCols: [], amountCols: [], display: {} })).toBeNull();
  });

  it("검증: 이름·금액 필수, 핵심 열 중복 금지", () => {
    expect(parseProfile([foodConf])).toHaveLength(1);
    expect(parseProfile([{ ...foodConf, amountCols: [] }])).toBeNull();
    expect(parseProfile([{ ...foodConf, amountCols: ["고객성명"] }])).toBeNull();
    expect(parseProfile([foodConf, foodConf])).toBeNull();
    expect(parseProfile([{ ...foodConf, dateCol: undefined }])![0].dateCol).toBeNull();
    expect(parseProfile("x")).toBeNull();
  });

  it("머리글 행이 옮겨져도 다시 찾음, 없는 열은 알려 줌", () => {
    const shifted: Sheet = { name: "식당", table: [["안내문"], FOOD_HEAD, ["2026-10-01", "", "홍길동", "001", "", "", "", 0, 0, 0, 8000]] };
    const r = resolveSheet(foodConf, shifted);
    expect(r.ok && r.sheet.headerRow).toBe(2);
    const changed: Sheet = { name: "식당", table: [FOOD_HEAD.map((h) => (h === "총금액1" ? "결제액" : h))] };
    const bad = resolveSheet(foodConf, changed);
    expect(!bad.ok && bad.missing).toEqual(["총금액1"]);
  });

  it("파일이 양식과 다르면 어떤 시트·열인지 알려 줌 (양식의 시트가 하나도 없을 때만 시트 없음)", () => {
    const r = parseWorkbook([{ name: "식당", table: [FOOD_HEAD.filter((h) => h !== "총금액1")] }], [foodConf, { ...foodConf, sheetName: "카페" }], "2026-10");
    expect(!r.ok && r.problems.map((p) => p.message)).toEqual(["식당 시트의 '총금액1' 열을 찾을 수 없습니다."]);
    const none = parseWorkbook([{ name: "Sheet1", table: [["안내"], ["다른 양식"]] }], [foodConf], "2026-10");
    expect(!none.ok && none.problems.map((p) => p.message)).toEqual(["저장된 서식(식당)에 없는 파일입니다. 새 구분(예: 카페)이면 시트·열을 고르고 구분 이름을 정하세요. 기존 식당 내역은 그대로 남습니다."]);
  });
});

describe("시트별 반영 (식당·카페를 따로 받다가 합본으로 받는 업체)", () => {
  const row = ["2026-10-01", "12:00:00", "홍길동", "001", "백반", "A", "9", 0, 0, 0, 8000];
  const cafeConf: SheetConfig = { ...foodConf, sheetName: "개인별 이용 내역", label: "카페" };

  it("양식의 시트 중 파일에 있는 것만 읽고, 그 구분만 바꾼다", () => {
    const r = parseWorkbook([foodSheet([row])], [foodConf, cafeConf], "2026-10");
    if (!r.ok) throw new Error();
    expect(r.scope).toEqual(["식당"]);
    expect(r.lines.map((l) => l.label)).toEqual(["식당"]);
    const cafe = parseWorkbook([{ ...foodSheet([row]), name: "개인별 이용 내역" }], [foodConf, cafeConf], "2026-10");
    expect(cafe.ok && [cafe.scope, cafe.lines[0].label, cafe.perSheet[0].label]).toEqual([["카페"], "카페", "카페"]);
  });

  it("양식에 없는 사용 내역 시트는 알려 준다 (표지는 제외)", () => {
    const r = parseWorkbook([foodSheet([row]), { ...foodSheet([row]), name: "카페" }, { name: "공문(카페)", table: [["청구 안내"]] }], [foodConf], "2026-10");
    expect(r.ok && r.unconfigured).toEqual(["카페"]);
  });

  it("시트 이름이 바뀌어도(다른 프로젝트·다른 달 파일) 머리글이 같으면 그 양식으로 읽는다", () => {
    const renamed = { ...foodSheet([row]), name: "개인별 이용 내역(11월)" };
    // 식당 설정과 카페 설정의 머리글이 같으면 어느 구분인지 정하지 않는다 (잘못 정하면 다른 구분 내역이 바뀜) → 구분을 고르게
    const amb = parseWorkbook([{ name: "공문", table: [["청구 안내"]] }, renamed], [foodConf, cafeConf], "2026-10");
    expect(!amb.ok && amb.ambiguous).toEqual([{ sheet: "개인별 이용 내역(11월)", labels: ["식당", "카페"] }]);
    const r = parseWorkbook([{ name: "공문", table: [["청구 안내"]] }, renamed], [foodConf, cafeConf], "2026-10", 1, [], { "개인별 이용 내역(11월)": "식당" });
    if (!r.ok) throw new Error();
    expect([r.scope, r.perSheet[0].sheetName, r.lines.length, r.unconfigured]).toEqual([["식당"], "개인별 이용 내역(11월)", 1, []]);
    // 머리글이 맞는 설정이 하나뿐이면 그대로
    const one = parseWorkbook([renamed], [foodConf], "2026-10");
    expect(one.ok && one.scope).toEqual(["식당"]);
    // 이름이 같은 시트가 있으면 이름 우선, 같은 구분을 두 번 읽지 않음
    const both = parseWorkbook([foodSheet([row]), { ...foodSheet([row]), name: "카페 내역" }], [foodConf, { ...foodConf, sheetName: "식당 예전", label: "식당" }], "2026-10");
    expect(both.ok && [both.scope, both.lines.length, both.unconfigured]).toEqual([["식당"], 1, ["카페 내역"]]);
  });

  it("양식 설정 화면도 머리글로 찾은 시트를 미리 선택", () => {
    const setups = sheetSetups([{ name: "표지", table: [["안내"]] }, { ...foodSheet([row]), name: "Sheet7" }], [cafeConf]);
    expect(setups.map((x) => [x.name, x.label, x.include])).toEqual([["표지", "표지", false], ["Sheet7", "카페", true]]);
  });

  it("새 시트(카페 파일 처음): 기존 식당 양식을 참고로 보여 주고 같은 머리글은 미리 고른다", () => {
    const CAFE_HEAD = ["이용일", "고객성명", "사원카드번호", "메뉴명", "결제금액"];
    const cafe: Sheet = { name: "카페 이용", table: [CAFE_HEAD, ["2026-10-02", "홍길동", "001", "아메리카노", 2000]] };
    const [s] = sheetSetups([cafe], [foodConf]);
    expect(s.label).toBe("카페 이용");
    expect(s.reference?.label).toBe("식당");
    expect(s.reference?.applied).toBe(true);
    expect(s.reference?.cols.find((c) => c.role === "금액")).toMatchObject({ header: "총금액1", found: false });
    expect(s.selection.nameCol).toBe(1);
    expect(s.selection.keyCols).toEqual([2]);
  });

  it("브라우저에서 읽은 시트 전송: 날짜·수식 위치 보존, 형식 오류·크기 초과는 거부", () => {
    const sheet: Sheet = { name: "식당", table: [FOOD_HEAD, [new Date("2026-10-01T00:00:00Z"), "12:00:00", "홍길동", "001", "백반", "A", "9", 8000, 0, 8000, 8000]], formulas: new Set(["1:10"]) };
    const back = sheetsFromWire(sheetsToWire([sheet]), { rows: 100, cols: 50, sheets: 5 })!;
    expect(back[0].table[1][0]).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(back[0].table[1][7]).toBe(8000);
    expect([...back[0].formulas!]).toEqual(["1:10"]);
    expect(sheetsFromWire("not json", { rows: 100, cols: 50, sheets: 5 })).toBeNull();
    expect(sheetsFromWire(JSON.stringify([{ name: "x", table: [[{ evil: 1 }]] }]), { rows: 100, cols: 50, sheets: 5 })).toBeNull();
    expect(sheetsFromWire(sheetsToWire([sheet]), { rows: 1, cols: 50, sheets: 5 })).toBeNull();
  });

  it("시간은 표시 항목에 없어도 시간 머리글이 있으면 읽는다 (저녁 식사 판단용)", () => {
    const r = parseWorkbook([foodSheet([["2026-10-01", "19:40:12", "홍길동", "001", "석식", "A", "9", 0, 0, 0, 9000]])], [{ ...foodConf, display: [{ item: "상품한글명", col: "상품한글명" }] }], "2026-10");
    expect(r.ok && [r.lines[0].time, r.lines[0].item]).toEqual(["19:40:12", "석식"]);
  });

  it("다시 올리기: 이번 구분의 줄만 교체", () => {
    const lines = [{ id: 1, placeType: "식당", sheetName: "식당" }, { id: 2, placeType: "카페", sheetName: "개인별 이용 내역" }, { id: 3, placeType: null, sheetName: "카페" }];
    const own = lines.map((l) => ({ ...l, vendor: "업체B" }));
    const r = splitByScope(own, ["카페"], "업체B");
    expect([r.keep.map((l) => l.id), r.replace.map((l) => l.id)]).toEqual([[1], [2, 3]]);
  });

  it("업체 양식 합치기: 파일에 있는 시트는 새 설정, 없는 시트 설정은 유지", () => {
    const saved = [foodConf, cafeConf];
    expect(mergeProfile(saved, [{ ...foodConf, headerRow: 2 }], ["식당", "공문(식당)"])).toEqual([cafeConf, { ...foodConf, headerRow: 2 }]);
    // 합본 파일에서 카페 시트를 새로 고르면 구분이 같은 두 설정이 함께 남는다 (어느 파일이 와도 카페로 처리)
    const cafe2 = { ...foodConf, sheetName: "카페" };
    expect(mergeProfile(saved, [foodConf, cafe2], ["식당", "카페"]).map((c) => c.sheetName)).toEqual(["개인별 이용 내역", "식당", "카페"]);
    expect(mergeProfile(null, [foodConf], ["식당"])).toEqual([foodConf]);
  });

  it("구분: 화면 입력 → 저장(시트 이름과 같으면 생략), 검증", () => {
    expect(toSheetConfig("개인별", 1, FOOD_HEAD, { nameCol: 2, keyCols: [], amountCols: [10], display: {} }, " 카페 ")!.label).toBe("카페");
    expect(toSheetConfig("식당", 1, FOOD_HEAD, { nameCol: 2, keyCols: [], amountCols: [10], display: {} }, "식당")!.label).toBeUndefined();
    expect(parseProfile([cafeConf])![0].label).toBe("카페");
    expect(parseProfile([{ ...foodConf, label: "x".repeat(21) }])).toBeNull();
    expect(sheetLabel(foodConf)).toBe("식당");
  });

  it("개인부담금액만 있는 카페 시트도 사용 내역 시트로 인식 (머리글이 3행)", () => {
    const head = ["판매일자", "판매시간", "고객ID", "사원번호", "고객성명", "사원카드번호", "상품한글명", "계약단가", "개인부담금액", "판매수량"];
    const d = detectHeader([["개인별 이용 내역"], ["총결제금액", 0], head]);
    expect(d && [d.headerRow, head[d.selection.nameCol!], head[d.selection.amountCols[0]]]).toEqual([3, "고객성명", "개인부담금액"]);
    // 식당 시트처럼 총금액이 있으면 총금액 우선
    expect(FOOD_HEAD[suggestColumns(FOOD_HEAD)!.amountCols[0]]).toBe("총금액1");
  });

  it("시트 설정 후보: 저장된 구분을 보여 주고, 저장된 양식의 시트가 없는 파일은 사용 내역 시트를 기본 선택", () => {
    const setups = sheetSetups([{ ...foodSheet([row]), name: "개인별 이용 내역" }], [foodConf, cafeConf]);
    expect(setups.map((x) => [x.name, x.label, x.include])).toEqual([["개인별 이용 내역", "카페", true]]);
    // 저장된 양식과 머리글이 같은 시트는 그 구분으로, 전혀 다른 시트만 있으면 사용 내역 시트를 기본 선택
    expect(sheetSetups([{ ...foodSheet([row]), name: "Sheet1" }], [foodConf]).map((x) => [x.label, x.include])).toEqual([["식당", true]]);
    const other = { name: "Sheet1", table: [["사용일", "이름", "금액"], ["2026-10-01", "홍길동", 1000]] };
    expect(sheetSetups([other], [foodConf]).map((x) => [x.label, x.include])).toEqual([["Sheet1", true]]);
  });
});

describe("시트 해석", () => {
  const conf = (c: SheetConfig, sheet: Sheet) => { const r = resolveSheet(c, sheet); if (!r.ok) throw new Error("resolve"); return r.sheet; };

  it("빈 날짜·수식 합계·합계 행·빈 행은 건너뛰고, 월 밖 날짜·금액 오류는 보고", () => {
    const sheet = foodSheet([
      ["2026-10-01", "12:01:00", "홍길동", "000123", "백반", "1층", "77", 8000, 0, 8000, 8000],
      ["2026.10.02", "19:30:00", "김테스트", "000456", "국수", "2층", "", 0, 6000, 0, 6000],
      ["2026-09-30", "12:00:00", "홍길동", "000123", "백반", "1층", "", 0, 0, 0, 7000],
      ["2026-10-03", "", "홍길동", "000123", "", "", "", 0, 0, 0, "abc"],
      [null, null, null, null, null, null, null, null, null, null, null],
      ["", "", "", "", "", "", "", "", "", "", 99999],
      ["합계", "", "", "", "", "", "", "", "", "", 21000],
      ["2026-10-04", "", "홍길동", "000123", "", "", "", 0, 0, 0, 30000],
      ["2026-10-05", "", "", "", "", "", "", 0, 0, 0, 1000],
    ], new Set(["8:10"]));
    const r = parseSheet(sheet, conf(foodConf, sheet), "2026-10");
    expect(r.lines.map((l) => [l.date, l.holderName, l.amount])).toEqual([["2026-10-01", "홍길동", 8000], ["2026-10-02", "김테스트", 6000]]);
    expect(r.lines[0].keys).toEqual(["사원카드번호:000123"]); // 앞자리 0 보존
    expect(r.lines[0].cardNo).toBe("000123");
    expect(r.lines[0].extra).toEqual([{ label: "판매시간", value: "12:01:00" }, { label: "상품한글명", value: "백반" }]);
    expect(r.lines[0].time).toBe("12:01:00");
    expect(r.lines[0].item).toBe("백반");
    expect(r.errors.map((e) => e.row)).toEqual([4, 5]);
    expect(r.errors[0].message).toContain("2026-10");
    expect(r.skipped).toMatchObject({ blank: 1, noDate: 1, total: 1, formula: 1, noName: 1 });
  });

  it("금액 열 여러 개는 합계 (빈 칸 0), 0원은 건너뜀", () => {
    const c: SheetConfig = { ...foodConf, amountCols: ["개인부담금액", "회사부담금액"] };
    const sheet = foodSheet([
      ["2026-10-01", "", "홍길동", "", "", "", "", 0, 3000, 5000, 8000],
      ["2026-10-01", "", "홍길동", "", "", "", "", 0, "", 4000, 4000],
      ["2026-10-01", "", "홍길동", "", "", "", "", 0, 0, 0, 0],
    ]);
    const r = parseSheet(sheet, conf(c, sheet), "2026-10");
    expect(r.lines.map((l) => l.amount)).toEqual([8000, 4000]);
    expect(r.lines[0].keys).toEqual([]);
    expect(r.skipped.zero).toBe(1);
  });

  it("날짜 열이 없으면 날짜 없이 가져오고 월 검사도 하지 않음", () => {
    const c: SheetConfig = { sheetName: "CSV", headerRow: 1, nameCol: "이름", keyCols: [], amountCols: ["금액"], dateCol: null, display: [{ item: "사용처", col: "사용처" }] };
    const sheet: Sheet = { name: "CSV", table: [["이름", "사용처", "금액"], ["홍길동", "테스트카페", "4,500"], ["합계", "", "4,500"]] };
    const r = parseWorkbook([sheet], [c], "2026-10");
    expect(r.ok && r.lines.map((l) => [l.date, l.amount, l.extra[0].value])).toEqual([[null, 4500, "테스트카페"]]);
    expect(r.ok && r.perSheet[0].skipped.total).toBe(1);
  });

  it("미리보기: 시트별 앞 5건·사람별·전체 합계", () => {
    const sheet = foodSheet(Array.from({ length: 7 }, (_, i) => [`2026-10-0${i + 1}`, "", i % 2 ? "김테스트" : "홍길동", "", "", "", "", 0, 0, 0, 1000]));
    const r = parseWorkbook([sheet], [foodConf], "2026-10");
    if (!r.ok) throw new Error();
    const p = buildPreview(r);
    expect(p.total).toEqual({ count: 7, amount: 7000 });
    expect(p.sheets[0].rows).toHaveLength(5);
    expect(p.sheets[0].columns).toEqual(["판매시간", "상품한글명"]);
    expect(p.people.map((x) => [x.holderName, x.count])).toEqual([["홍길동", 4], ["김테스트", 3]]);
  });

  it("xlsx: 여러 시트·수식 합계 행·텍스트 번호", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("공문(카페)").getCell("A1").value = "이용 요금 청구 안내";
    const ws = wb.addWorksheet("카페");
    ws.addRow(["판매일자", "판매시간", "고객ID", "고객성명", "사원카드번호", "영업장 명칭", "표시금액", "총금액"]);
    ws.addRow(["2026-10-02", "08:40:00", "0007", "홍길동", "000123", "테스트카페", 4500, 4500]);
    ws.addRow([new Date(Date.UTC(2026, 9, 3)), "15:00:00", "0008", "외부손님", "000999", "테스트카페", 3000, 3000]);
    ws.addRow([null, null, null, null, null, null, null, { formula: "SUM(H2:H3)", result: 7500 }]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const sheets = await fileToSheets("vendor.xlsx", buf);
    expect(sheets.map((s) => s.name)).toEqual(["공문(카페)", "카페"]);
    const setup = sheetSetups(sheets);
    expect(setup.map((s) => s.include)).toEqual([false, true]);
    const cafe = setup[1];
    const conf = toSheetConfig(cafe.name, cafe.headerRow, cafe.rows[0], cafe.selection)!;
    expect(conf).toMatchObject({ nameCol: "고객성명", amountCols: ["총금액"], dateCol: "판매일자", keyCols: ["사원카드번호"] });
    const r = parseWorkbook(sheets, [conf], "2026-10");
    if (!r.ok) throw new Error();
    expect(r.lines.map((l) => [l.date, l.holderName, l.amount, l.keys[0]])).toEqual([
      ["2026-10-02", "홍길동", 4500, "사원카드번호:000123"],
      ["2026-10-03", "외부손님", 3000, "사원카드번호:000999"],
    ]);
    expect(r.lines[0].place).toBe("테스트카페");
  });

  it("예전 xls는 안내", async () => {
    await expect(fileToSheets("a.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toThrow(/xlsx/);
  });
});

describe("직원 매칭", () => {
  const members = [{ userId: "u1", name: "홍길동" }, { userId: "u2", name: "김테스트" }, { userId: "u3", name: "이동명" }, { userId: "u4", name: "이동명" }];
  it("보조 연결 키 매핑 → 이름 매핑 → 유일한 이름 → 미확인", () => {
    const holders = new Map([[matchKey("사원카드번호", "000999"), "u2"], ["nm:박외부", "u1"]]);
    expect(matchHolder({ holderName: "아무개", keys: ["사원카드번호:000999"] }, members, holders)).toEqual({ userId: "u2", source: "HOLDER" });
    expect(matchHolder({ holderName: "박 외부", keys: [] }, members, holders)).toEqual({ userId: "u1", source: "HOLDER" });
    expect(matchHolder({ holderName: "홍 길동", keys: ["사원카드번호:1"] }, members, holders)).toEqual({ userId: "u1", source: "NAME" });
    expect(matchHolder({ holderName: "이동명", keys: [] }, members, holders).userId).toBeNull(); // 동명이인
    expect(matchHolder({ holderName: "외부손님", keys: [] }, members, holders).userId).toBeNull();
    // 구성원에서 빠진 사람으로 기억된 매핑은 무시
    expect(matchHolder({ holderName: "x", keys: ["k:1"] }, members, new Map([["k:1", "gone"]])).userId).toBeNull();
  });
  it("매핑 키", () => {
    expect(matchKey("사원 카드번호", "00-12 3")).toBe("사원카드번호:00123");
    expect(holderMapKey({ holderName: "홍 길동", keys: [] })).toBe("nm:홍길동");
    expect(mappingKeys({ holderName: "홍길동", keys: ["a:1", "b:2"] })).toEqual(["a:1", "b:2"]);
  });
});

describe("결정·확정", () => {
  const lines = [
    { id: "a", userId: "u1", memberClaim: "OVERTIME", decision: null },
    { id: "b", userId: "u1", memberClaim: null, decision: null },
    { id: "c", userId: "u2", memberClaim: "OVERTIME", decision: "DEDUCT" },
    { id: "d", userId: null, memberClaim: null, decision: null },
  ];
  it("체크한 건 제외 인정 / 남은 건 급여 공제 / 선택 제외 인정", () => {
    expect(bulkDecisions(lines, "accept-claims")).toEqual([{ id: "a", decision: "OVERTIME" }]);
    // 옛 값 PERSONAL은 표시 없음과 같다 — 요청대로 정하기에서 본인 부담으로 "정해 주지" 않고 미결정으로 남긴다
    expect(bulkDecisions([...lines, { id: "p", userId: "u1", memberClaim: "PERSONAL", decision: null }], "accept-claims")).toEqual([{ id: "a", decision: "OVERTIME" }]);
    expect(bulkDecisions(lines, "rest-deduct")).toEqual([{ id: "a", decision: "DEDUCT" }, { id: "b", decision: "DEDUCT" }, { id: "d", decision: "DEDUCT" }]);
    expect(bulkDecisions(lines, "rest-deduct", ["b"])).toEqual([{ id: "b", decision: "DEDUCT" }]);
    expect(bulkDecisions(lines, "all-overtime", ["c"])).toEqual([{ id: "c", decision: "OVERTIME" }]);
  });
  it("일괄 결정을 화면 줄에 바로 반영 — 항목은 지정 → 줄의 항목(팀원 요청) → 하나뿐인 항목, 줄은 사라지지 않는다", () => {
    const items = [{ id: "night", name: "야근식대", perPersonLimit: null }];
    const rows = [
      { id: "a", userId: "u1", memberClaim: "OVERTIME", decision: null, usageItemId: "night", usageItemName: "야근식대" },
      { id: "b", userId: "u1", memberClaim: null, decision: null, usageItemId: null, usageItemName: null },
      { id: "c", userId: "u2", memberClaim: "OVERTIME", decision: "DEDUCT", usageItemId: null, usageItemName: null },
    ];
    const accepted = applyBulk(rows, "accept-claims", null, null, items, "PM");
    expect(accepted.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(accepted[0]).toMatchObject({ decision: "OVERTIME", usageItemId: "night", usageItemName: "야근식대", decisionSource: "PM" });
    expect(accepted[1]).toBe(rows[1]);
    const over = applyBulk(rows, "all-overtime", ["b"], null, items, "PM");
    expect(over[1]).toMatchObject({ decision: "OVERTIME", usageItemId: "night", usageItemName: "야근식대" });
    const ded = applyBulk(rows, "rest-deduct", ["b"], null, items, "PM");
    expect(ded[1]).toMatchObject({ decision: "DEDUCT", usageItemId: null, usageItemName: null });
    expect(applyBulk(rows, "rest-deduct", ["c"], null, items, "PM")).toBe(rows);
  });
  it("결정 지우기(clear): 고른 줄 중 결정이 있는 줄만, 팀원이 회사 부담을 요청한 줄은 요청 항목을 남긴다 (✓ 해제와 같은 값)", () => {
    const rows = [
      { id: "a", userId: "u1", memberClaim: "OVERTIME", decision: "OVERTIME", usageItemId: "night", usageItemName: "야근식대", decisionSource: "PM" },
      { id: "b", userId: "u1", memberClaim: null, decision: "OVERTIME", usageItemId: "night", usageItemName: "야근식대", decisionSource: "PM" },
      { id: "c", userId: "u1", memberClaim: null, decision: "DEDUCT", usageItemId: null, usageItemName: null, decisionSource: "PM" },
      { id: "d", userId: "u1", memberClaim: null, decision: null, usageItemId: null, usageItemName: null, decisionSource: null },
      { id: "e", userId: "u1", memberClaim: null, decision: "OVERTIME", usageItemId: "night", usageItemName: "야근식대", decisionSource: "SOLIDAY" },
    ];
    // 대상: 결정이 있는 줄만 (d는 바꿀 게 없다). 고른 줄은 그대로 — Soliday 자동 줄(e)도 골랐으면 지운다
    const t = clearTargets(rows, ["a", "b", "c", "d", "e", "없는줄"]);
    expect(t.keepItem.map((l) => l.id)).toEqual(["a"]);
    expect(t.dropItem.map((l) => l.id)).toEqual(["b", "c", "e"]);
    // 화면 반영: 줄은 그대로 남고 결정·출처만 비운다, 팀원 요청 항목은 남는다
    const out = applyClear(rows, ["a", "b", "c"]);
    expect(out.map((l) => l.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(out[0]).toMatchObject({ decision: null, decisionSource: null, usageItemId: "night", usageItemName: "야근식대", memberClaim: "OVERTIME" });
    expect(out[1]).toMatchObject({ decision: null, decisionSource: null, usageItemId: null, usageItemName: null });
    expect(out[2]).toMatchObject({ decision: null, decisionSource: null });
    expect(out[3]).toBe(rows[3]);
    expect(out[4]).toBe(rows[4]);
    expect(applyClear(rows, ["d"])).toBe(rows);
    // 머리글 '정한 것 모두 지우기' 대상: 사람이 정한 결정만 — Soliday 자동(e)·확정 후 보정(DEFAULT)·외부인 대납은 제외
    const ext = { id: "f", userId: "u1", memberClaim: null, decision: "DEDUCT", usageItemId: null, usageItemName: null, decisionSource: "PM", onBehalfName: "손님" };
    const def = { id: "g", userId: "u1", memberClaim: null, decision: "DEDUCT", usageItemId: null, usageItemName: null, decisionSource: "DEFAULT" };
    expect(clearableLines([...rows, ext, def]).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
  it("요청 확인할 직원만: 요청을 다 정해도 켤 때 있던 직원은 남고, 새 요청 직원은 보인다 (줄이 사라지는 회귀 방지)", () => {
    const before = [{ userId: "u1", claims: 2 }, { userId: "u2", claims: 0 }, { userId: "u3", claims: 1 }];
    const pinned = new Set(before.filter((g) => g.claims > 0).map((g) => g.userId));
    expect(filterPeople(before, pinned).map((g) => g.userId)).toEqual(["u1", "u3"]);
    // u1의 요청을 모두 정한 뒤(요청대로 정하기·마지막 건 결정) — 그대로 보인다
    const after = [{ userId: "u1", claims: 0 }, { userId: "u2", claims: 1 }, { userId: "u3", claims: 0 }];
    expect(filterPeople(after, pinned).map((g) => g.userId)).toEqual(["u1", "u2", "u3"]);
    expect(filterPeople(after, null).length).toBe(3);
  });
  it("건마다 보며 정하기: 다음 건은 보던 줄 다음의 정하지 않은 줄, 끝이면 처음부터, 없으면 null", () => {
    const rows = [
      { id: "a", decision: null }, { id: "b", decision: "OVERTIME" }, { id: "c", decision: null, onBehalfName: "손님" }, { id: "d", decision: null },
    ];
    expect(undecidedLines(rows).map((l) => l.id)).toEqual(["a", "d"]);
    expect(nextUndecided(rows, null)?.id).toBe("a");
    expect(nextUndecided(rows, "a")?.id).toBe("d");
    expect(nextUndecided(rows, "d")?.id).toBe("a");
    // 방금 정한 줄(b 자리)은 목록에 없어도 그 다음부터
    expect(nextUndecided(rows, "b")?.id).toBe("d");
    // 방금 정한 줄이 화면 목록에서 아직 미정으로 보여도(옛 값) 그 줄로 돌아가지 않는다
    expect(nextUndecided(rows, "d", true)?.id).toBe("a");
    expect(nextUndecided([{ id: "a", decision: null }], "a", true)).toBeNull();
    expect(nextUndecided([{ id: "x", decision: "DEDUCT" }], null)).toBeNull();
  });
  it("확정 조건: 직원 확인 + 팀원 요청 확인 (정하지 않은 건은 기본 급여 공제)", () => {
    expect(confirmProblem([])).toMatch(/없습니다/);
    expect(confirmProblem(lines)).toMatch(/연결 안 된 이름.*팀원을 지정/);
    expect(confirmProblem([{ userId: "u", decision: null }])).toBeNull();
    expect(confirmProblem([{ userId: "u", decision: null, memberClaim: "OVERTIME" }])).toMatch(/요청/);
    expect(defaultDeductIds([{ id: "a", decision: null }, { id: "b", decision: "OVERTIME" }])).toEqual(["a"]);
    expect(confirmProblem([{ userId: "u", decision: "DEDUCT" }])).toBeNull();
  });
  it("확정된 내역의 빈 결정은 본인 부담(출처 DEFAULT)으로 읽는다 — 확정 때 줄을 바꾸지 않으므로 읽기에서 채움", () => {
    const rows = [
      { id: "a", decision: null, decisionSource: null, usageItemId: null, memberClaim: null },
      { id: "b", decision: "OVERTIME", decisionSource: "PM", usageItemId: "it", memberClaim: "OVERTIME" },
      { id: "c", decision: "DEDUCT", decisionSource: "PM", usageItemId: null, memberClaim: null },
      { id: "d", decision: null, decisionSource: "SOLIDAY", usageItemId: "it", memberClaim: "PERSONAL" },
      { id: "e", decision: "BOGUS", decisionSource: null, usageItemId: null, memberClaim: null },
    ];
    // OPEN: 그대로 (같은 배열 — 미결정 유지)
    expect(applyConfirmedDefaults(rows, "OPEN")).toBe(rows);
    const out = applyConfirmedDefaults(rows, "CONFIRMED");
    expect(out.map((l) => [l.id, l.decision, l.decisionSource])).toEqual([
      ["a", "DEDUCT", "DEFAULT"], ["b", "OVERTIME", "PM"], ["c", "DEDUCT", "PM"], ["d", "DEDUCT", "SOLIDAY"], ["e", "DEDUCT", "DEFAULT"],
    ]);
    // usageItemId·memberClaim 등 다른 칸은 손대지 않고, 이미 정한 줄은 같은 객체
    expect(out[3].usageItemId).toBe("it");
    expect(out[0].memberClaim).toBeNull();
    expect(out[1]).toBe(rows[1]);
    expect(rows[0].decision).toBeNull(); // 원본 불변
    // 채운 뒤에는 미결정 0건·본인 부담에 합산 — 금액 계산은 원래부터 "정하지 않은 건 = 본인 부담"
    const money = [{ id: "x", userId: "u", holderName: "u", amount: 1000, memberClaim: null, decision: null }, { id: "y", userId: "u", holderName: "u", amount: 500, memberClaim: null, decision: "OVERTIME" }];
    const before = summarizeStatement(money), after = summarizeStatement(applyConfirmedDefaults(money, "CONFIRMED"));
    expect([before.undecided.count, before.defaultDeduct.amount, before.deduct.amount]).toEqual([1, 1000, 0]);
    expect([after.undecided.count, after.defaultDeduct.amount, after.deduct.amount, after.overtime.amount]).toEqual([0, 0, 1000, 500]);
    expect(deductionList(applyConfirmedDefaults(money, "CONFIRMED")).map((p) => [p.userId, p.amount])).toEqual(deductionList(money).map((p) => [p.userId, p.amount]));
    // 확정 취소(OPEN)되면 자동으로 다시 미결정
    expect(applyConfirmedDefaults(applyConfirmedDefaults(rows, "OPEN"), "OPEN")[0].decision).toBeNull();
  });
  it("외부인 사용 → PM 사용분 (기본 급여 공제)", () => {
    expect(externalAssignment({ holderName: "외부손님" }, "pm")).toMatchObject({ userId: "pm", onBehalfName: "외부손님", collectFrom: "외부손님", decision: "DEDUCT", decisionSource: "PM" });
    expect(externalAssignment({ holderName: "x" }, "pm", " 담당자 ").collectFrom).toBe("담당자");
  });
});

describe("다시 올리기", () => {
  const old = (o: Partial<CarryLine>): CarryLine => ({
    date: "2026-10-01", holderName: "홍길동", amount: 8000, extra: null, userId: "u1", memberClaim: null, memberNote: null, usageItemId: null,
    decision: null, decisionSource: null, decidedBy: null, decidedAt: null, onBehalfName: null, collectFrom: null, collectedAt: null, collectNote: null, ...o,
  });
  it("같은 줄의 체크·결정·외부인 처리를 이어받음", () => {
    const r = carryOver(
      [old({ memberClaim: "OVERTIME", memberNote: "야근" }), old({ holderName: "외부손님", amount: 3000, userId: "pm", onBehalfName: "외부손님", decision: "DEDUCT" })],
      [
        { date: "2026-10-01", holderName: "홍길동", amount: 8000, extra: null, userId: "u1" },
        { date: "2026-10-01", holderName: "외부손님", amount: 3000, extra: null, userId: null },
        { date: "2026-10-02", holderName: "홍길동", amount: 8000, extra: null, userId: "u1" },
      ],
    );
    expect(r.carried).toBe(2);
    expect(r.lines[0]).toMatchObject({ memberClaim: "OVERTIME", memberNote: "야근" });
    expect(r.lines[1]).toMatchObject({ userId: "pm", onBehalfName: "외부손님", decision: "DEDUCT" });
    expect(r.lines[2].memberClaim).toBeUndefined();
  });
  it("다른 직원으로 매칭된 줄은 이어받지 않음", () => {
    const r = carryOver([old({ memberClaim: "OVERTIME" })], [{ date: "2026-10-01", holderName: "홍길동", amount: 8000, extra: null, userId: "u9" }]);
    expect(r.carried).toBe(0);
  });
});

describe("집계", () => {
  const rows = [
    { id: "1", userId: "u1", userName: "홍길동", holderName: "홍길동", amount: 8000, memberClaim: "OVERTIME", decision: "OVERTIME", onBehalfName: null, collectFrom: null, collectedAt: null, collectNote: null },
    { id: "2", userId: "u1", userName: "홍길동", holderName: "홍길동", amount: 4500, memberClaim: null, decision: "DEDUCT", onBehalfName: null, collectFrom: null, collectedAt: null, collectNote: null },
    { id: "3", userId: "pm", userName: "PM", holderName: "외부손님", amount: 3000, memberClaim: null, decision: "DEDUCT", onBehalfName: "외부손님", collectFrom: "외부손님", collectedAt: null, collectNote: "월말 정산" },
    { id: "4", userId: "pm", userName: "PM", holderName: "외부손님", amount: 2000, memberClaim: null, decision: "DEDUCT", onBehalfName: "외부손님", collectFrom: "외부손님", collectedAt: new Date(), collectNote: null },
    { id: "5", userId: null, holderName: "미상", amount: 1000, memberClaim: null, decision: null, onBehalfName: null, collectFrom: null, collectedAt: null, collectNote: null },
  ];
  it("전체·제외 인정·급여 공제·미결정·외부인", () => {
    const s = summarizeStatement(rows);
    expect(s.total).toEqual({ amount: 18500, count: 5 });
    expect(s.overtime.amount).toBe(8000);
    expect(s.deduct.amount).toBe(9500);
    expect(s.undecided).toEqual({ amount: 1000, count: 1 });
    expect(s.external.amount).toBe(5000);
    expect(s.unmatched).toBe(1);
    expect(s.people.map((p) => p.name)).toEqual(["홍길동", "PM", "미상"]);
  });
  it("PM이 확인할 요청(pendingClaims)은 업무 사용 표시뿐 — 옛 값 PERSONAL은 표시 없음과 같게 기본 급여 공제로 센다", () => {
    const base = { userId: "u1", userName: "홍길동", holderName: "홍길동", decision: null, onBehalfName: null, collectFrom: null, collectedAt: null, collectNote: null };
    const s = summarizeStatement([
      { ...base, id: "a", amount: 8000, memberClaim: "OVERTIME" },
      { ...base, id: "b", amount: 4000, memberClaim: "PERSONAL" },
      { ...base, id: "c", amount: 3000, memberClaim: null },
    ]);
    expect(s.pendingClaims).toBe(1);
    expect(s.claimed).toEqual({ amount: 8000, count: 1 });
    expect(s.defaultDeduct).toEqual({ amount: 7000, count: 2 });
    expect(s.undecided.count).toBe(3);
  });
  it("급여 공제 대상: 사람별 합계 + 외부인 대납 비고", () => {
    const d = deductionList(rows);
    expect(d.map((p) => [p.userId, p.amount, p.count])).toEqual([["u1", 4500, 1], ["pm", 5000, 2]]);
    expect(onBehalfNote(d[1].onBehalf)).toBe("외부인(외부손님) 대납 포함 5,000원");
    expect(onBehalfNote([])).toBe("");
  });
  it("외부인 수금", () => {
    const g = externalGroups(rows);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ name: "외부손님", count: 2, amount: 5000, collected: 1, allCollected: false, note: "월말 정산", payerIds: ["pm"] });
  });
  it("팀원 예상 공제액: 공제 확정 + 미결정 중 제외 체크 안 한 건", () => {
    expect(memberExpectation([
      { amount: 8000, memberClaim: "OVERTIME", decision: null },
      { amount: 4500, memberClaim: null, decision: null },
      { amount: 3000, memberClaim: "OVERTIME", decision: "DEDUCT" },
      { amount: 2000, memberClaim: null, decision: "OVERTIME" },
    ])).toEqual({ total: 17500, checked: 11000, expected: 7500, deducted: 3000, likely: 4500, overtime: 2000 });
  });
});

describe("Soliday 야근 자동 인정", () => {
  it("야근한 날의 미결정 줄만 SOLIDAY로 제외 인정", () => {
    const ot = new Map([["u1", new Set(["2026-10-01"])]]);
    const r = autoDecide([
      { date: "2026-10-01", userId: "u1", decision: null },
      { date: "2026-10-01", userId: "u1", decision: "DEDUCT" },
      { date: "2026-10-02", userId: "u1", decision: null },
      { date: null, userId: "u1", decision: null },
      { date: "2026-10-01", userId: null, decision: null },
    ], ot);
    expect(r.changed).toBe(1);
    expect(r.lines[0]).toMatchObject({ decision: "OVERTIME", decisionSource: "SOLIDAY" });
    expect(r.lines[1].decision).toBe("DEDUCT");
  });
  it("기본 출처는 야근 기록 없음", async () => {
    expect((await noOvertimeSource.overtimeDates(["u1"], new Date(), new Date())).size).toBe(0);
  });
});

describe("권한", () => {
  const pm = { id: "pm", role: "MANAGER" as const };
  const member = { id: "m1", role: "MEMBER" as const };
  it("조회 범위: 팀원·상위 조회자는 본인 줄만", () => {
    expect(canSeeAllPass(pm)).toBe(true);
    expect(canSeeAllPass({ ...pm, readOnly: true, readOnlyReason: "closed" })).toBe(true);
    expect(canSeeAllPass({ ...pm, readOnly: true, readOnlyReason: "view" })).toBe(false);
    expect(canSeeAllPass(member)).toBe(false);
    expect(canSeeAllPass({ id: "h", role: "HQ" })).toBe(true);
    // 올리기·결정·확정은 이 프로젝트 PM만, 확정 취소는 PM·재무팀
    expect(canManagePass({ id: "h", role: "HQ" })).toBe(false);
    expect(canManagePass({ id: "a", role: "ADMIN", readOnly: true, readOnlyReason: "admin" })).toBe(false);
    expect(canManagePass({ ...pm, readOnly: true })).toBe(false);
    expect(canReopenPass(pm)).toBe(true);
    expect(canReopenPass({ id: "h", role: "HQ" })).toBe(true);
    expect(canReopenPass({ id: "a", role: "ADMIN", readOnly: true, readOnlyReason: "admin" })).toBe(false);
    expect(canReopenPass({ ...pm, readOnly: true, readOnlyReason: "view" })).toBe(false);
    expect(canAssumeExternal(pm)).toBe(true);
    expect(canAssumeExternal({ id: "h", role: "HQ" })).toBe(false);
  });
  it("줄 수정", () => {
    const own = { userId: "m1" };
    expect(linePatchProblem(member, own, "OPEN", { memberClaim: "OVERTIME", memberNote: "야근" })).toBeNull();
    expect(linePatchProblem(member, { userId: "m2" }, "OPEN", { memberClaim: "OVERTIME" })).toMatch(/본인/);
    expect(linePatchProblem(member, own, "CONFIRMED", { memberClaim: null })).toMatch(/확정/);
    expect(linePatchProblem(member, own, "OPEN", { decision: "OVERTIME" })).toMatch(/PM/);
    expect(linePatchProblem(member, own, "OPEN", { memberClaim: "X" })).toMatch(/올바르지/);
    // 옛 값 PERSONAL(본인 부담 확인)은 더 저장할 수 없다 — 표시는 업무 사용(OVERTIME)·해제(null)뿐
    expect(linePatchProblem(member, own, "OPEN", { memberClaim: "PERSONAL" })).toMatch(/올바르지/);
    expect(linePatchProblem(pm, own, "OPEN", { decision: "DEDUCT" })).toBeNull();
    expect(linePatchProblem(pm, own, "OPEN", { userId: "m2" })).toBeNull();
    expect(linePatchProblem({ ...pm, readOnly: true }, own, "OPEN", { decision: "DEDUCT" })).toMatch(/조회/);
    // 외부인
    expect(linePatchProblem(pm, { userId: null }, "OPEN", { external: true })).toBeNull();
    expect(linePatchProblem({ id: "h", role: "HQ" }, { userId: null }, "OPEN", { external: true })).toMatch(/PM만/);
    expect(linePatchProblem(pm, { userId: "pm", onBehalfName: "외부손님" }, "OPEN", { userId: "m1" })).toMatch(/되돌리/);
    expect(linePatchProblem({ id: "pm", role: "MANAGER" }, { userId: "pm", onBehalfName: "외부손님" }, "OPEN", { memberClaim: "OVERTIME" })).toMatch(/본인/);
    // 수금 기록은 확정 후에도
    expect(linePatchProblem(pm, { userId: "pm", onBehalfName: "외부손님" }, "CONFIRMED", { collected: true })).toBeNull();
    expect(linePatchProblem(pm, { userId: "m1" }, "OPEN", { collected: true })).toMatch(/외부인/);
    expect(linePatchProblem(member, { userId: "pm", onBehalfName: "x" }, "OPEN", { collected: true })).toMatch(/PM/);
  });
});

describe("PM 할 일", () => {
  it("출입증 확정 전 명세: 팀원 요청(업무 사용 표시) → 직원 미확인 → 확정 안내", () => {
    const t = buildTodos({
      ym: "2026-10", now: "2026-10", months: ["2026-10"], setup: { hasBudget: true, hasMemberItems: true, hasMembers: true },
      payers: [], expenses: [], closings: [], passChecks: [{ ym: "2026-08", count: 3 }, { ym: "2026-09", count: 0, unmatched: 2 }, { ym: "2026-10", count: 0 }],
    });
    expect(t.map((x) => [x.key, x.title, x.href])).toEqual([
      ["pass", "출입증 팀원 요청 3건", "/pass?ym=2026-08"],
      ["pass", "출입증 연결 안 된 이름 1개월", "/pass?ym=2026-09"],
      ["pass", "출입증 확정 전 1개월", "/pass?ym=2026-10"],
    ]);
  });
});

describe("요청 확인할 직원·건만 (줄 고정)", () => {
  type L = { id: string; decision: string | null; memberClaim: string | null };
  const rows: L[] = [
    { id: "a", decision: null, memberClaim: "OVERTIME" }, // 요청 건
    { id: "b", decision: null, memberClaim: null }, // 요청 없음 (미정)
    { id: "c", decision: "OVERTIME", memberClaim: "OVERTIME" }, // 켜기 전에 이미 정한 요청
    { id: "d", decision: "DEDUCT", memberClaim: null }, // 켜기 전에 이미 정함
  ];
  it("켤 때 고정되는 줄은 정하지 않은 요청 건만", () => {
    expect([...pinClaims(rows)]).toEqual(["a"]);
  });
  it("켜면 고정한 줄만 보이고, 고정한 줄은 정한 뒤에도 결과가 보인다", () => {
    const pinned = pinClaims(rows);
    expect(filterLines(rows, pinned).map((l) => l.id)).toEqual(["a"]);
    const decided = rows.map((l) => (l.id === "a" ? { ...l, decision: "DEDUCT" } : l));
    expect(filterLines(decided, pinned).map((l) => l.id)).toEqual(["a"]);
  });
  it("켜기 전에 정한 줄·요청이 없던 줄은 숨기고, 켠 뒤 새로 들어온 요청은 보인다", () => {
    const pinned = pinClaims(rows);
    const later = [...rows, { id: "e", decision: null, memberClaim: "OVERTIME" }];
    expect(filterLines(later, pinned).map((l) => l.id)).toEqual(["a", "e"]);
    // 켤 때 없던 요청을 정하면(고정 집합에 없음) 다시 숨는다
    expect(filterLines(later.map((l) => (l.id === "e" ? { ...l, decision: "OVERTIME" } : l)), pinned).map((l) => l.id)).toEqual(["a"]);
  });
  it("null이면 전체", () => {
    expect(filterLines(rows, null)).toBe(rows);
  });
});

describe("정산 기간 (업체 마감일)", () => {
  it("시작일 1이면 달력 월, 21이면 전월 21일 ~ 당월 20일 (결산 월 = 끝나는 달)", () => {
    expect(passPeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(passPeriod("2026-08", 21)).toEqual({ from: "2026-07-21", to: "2026-08-20" });
    expect(passPeriod("2026-01", 21)).toEqual({ from: "2025-12-21", to: "2026-01-20" });
    expect(passPeriodLabel("2026-08", 21)).toBe("7월 21일 ~ 8월 20일");
  });

  it("사용일 → 결산 월", () => {
    expect(passMonthOf("2026-07-20", 21)).toBe("2026-07");
    expect(passMonthOf("2026-07-21", 21)).toBe("2026-08");
    expect(passMonthOf("2026-12-25", 21)).toBe("2027-01");
    expect(passMonthOf("2026-07-31")).toBe("2026-07");
  });

  it("시작일 값 정리: 1~28 정수만", () => {
    expect(normStartDay("21")).toBe(21);
    expect([normStartDay(0), normStartDay(29), normStartDay(2.5), normStartDay(null)]).toEqual([1, 1, 1, 1]);
  });

  it("시작일 21: 7/21~8/20은 8월분으로 가져오고, 기간 밖 날짜는 오류", () => {
    const c: SheetConfig = { sheetName: "CSV", headerRow: 1, nameCol: "이름", keyCols: [], amountCols: ["금액"], dateCol: "날짜", display: [] };
    const sheet: Sheet = {
      name: "CSV",
      table: [["날짜", "이름", "금액"], ["2026-07-21", "홍길동", "1000"], ["2026-08-20", "홍길동", "2000"], ["2026-08-21", "홍길동", "3000"], ["2026-07-20", "홍길동", "4000"]],
    };
    const r = parseWorkbook([sheet], [c], "2026-08", 21);
    if (!r.ok) throw new Error();
    expect(r.lines.map((l) => l.amount)).toEqual([1000, 2000]);
    expect(r.errors.map((e) => e.row)).toEqual([4, 5]);
    expect(r.errors[0].message).toContain("7월 21일 ~ 8월 20일");
    // 달력 월 기준이면 7월 날짜는 오류
    const cal = parseWorkbook([sheet], [c], "2026-08");
    expect(cal.ok && cal.lines.map((l) => l.amount)).toEqual([2000, 3000]);
  });
});

describe("회사 부담 항목", () => {
  const items = [{ id: "night", name: "야근식대", perPersonLimit: 12000 }, { id: "meet", name: "회의비", perPersonLimit: null }];
  const base = { userId: "u1", date: "2026-08-03", memberClaim: null, decision: "OVERTIME" as string | null, usageItemId: "night" as string | null };

  it("항목별 합계: 식당·카페가 달라도 같은 항목으로 합산, 사용처별 내역", () => {
    const s = summarizeStatement([
      { ...base, holderName: "홍길동", amount: 8000, sheetName: "식당", usageItemName: "야근식대" },
      { ...base, holderName: "홍길동", amount: 3000, sheetName: "카페", usageItemName: "야근식대" },
      { ...base, holderName: "홍길동", amount: 5000, sheetName: "카페", decision: "DEDUCT", usageItemName: null },
    ]);
    expect(s.items).toEqual([{ name: "야근식대", amount: 11000, count: 2, places: [{ place: "식당", amount: 8000 }, { place: "카페", amount: 3000 }] }]);
    expect(s.deduct.amount).toBe(5000);
  });

  it("하루 한도: 같은 사람·날·항목 합계가 1인 한도를 넘으면 그 날 줄 모두 표시 (팀원 요청 포함)", () => {
    const over = dayLimitOver([
      { ...base, id: "a", amount: 8000 },
      { ...base, id: "b", amount: 3000, decision: null, memberClaim: "OVERTIME" },
      { ...base, id: "c", amount: 2000, date: "2026-08-03" },
      { ...base, id: "d", amount: 9000, date: "2026-08-04" },
      { ...base, id: "e", amount: 50000, usageItemId: "meet" },
      { ...base, id: "f", amount: 9000, decision: "DEDUCT", usageItemId: null },
    ], items);
    expect([...over.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(over.get("a")).toEqual({ limit: 12000, used: 13000, itemName: "야근식대", company: 12000, personal: 1000 });
  });

  it("항목 값 검증: 팀원은 요청과 함께, PM은 결정과 함께", () => {
    const member = { id: "u1", role: "MEMBER" as const };
    const pm = { id: "pm", role: "MANAGER" as const };
    expect(linePatchProblem(member, { userId: "u1" }, "OPEN", { memberClaim: "OVERTIME", usageItemId: "night" })).toBeNull();
    expect(linePatchProblem(member, { userId: "u1" }, "OPEN", { usageItemId: "night" })).toMatch(/PM/);
    expect(linePatchProblem(pm, { userId: "u1" }, "OPEN", { decision: "OVERTIME", usageItemId: "night" })).toBeNull();
    expect(linePatchProblem(pm, { userId: "u1" }, "OPEN", { decision: "OVERTIME", usageItemId: 3 })).toMatch(/항목/);
  });
});

describe("처리 선택 값 (O:<항목 id>)", () => {
  it("결정·요청 → 선택 값 → 저장 값 왕복", () => {
    expect(choiceOf({ decision: "OVERTIME", usageItemId: "night" })).toBe("O:night");
    expect(choiceOf({ decision: "OVERTIME", usageItemId: null })).toBe("O:");
    expect(choiceOf({ decision: "DEDUCT", usageItemId: "night" })).toBe("");
    expect(claimChoiceOf({ memberClaim: "OVERTIME", usageItemId: "night" })).toBe("O:night");
    expect(claimChoiceOf({ memberClaim: null, usageItemId: null })).toBe("");
    expect(choiceToDecision("O:night")).toEqual({ decision: "OVERTIME", usageItemId: "night" });
    expect(choiceToDecision("O:")).toEqual({ decision: "OVERTIME", usageItemId: null });
    expect(choiceToDecision("D")).toEqual({ decision: "DEDUCT" });
    expect(choiceToClaim("O:x")).toEqual({ memberClaim: "OVERTIME", usageItemId: "x" });
    expect(choiceToClaim("")).toEqual({ memberClaim: null });
    expect(isCompanyChoice(companyChoice("a"))).toBe(true);
    expect(choiceItemId("D")).toBeUndefined();
  });
});

describe("팀원 표시 되돌리기 (토스트)", () => {
  const line = { memberClaim: "OVERTIME", usageItemId: "it1", memberNote: "배포 야근", decision: null, other: 1 };
  it("스냅샷은 표시·항목·사유만 담는다", () => {
    expect(claimSnapshot(line)).toEqual({ memberClaim: "OVERTIME", usageItemId: "it1", memberNote: "배포 야근" });
  });
  it("업무 사용이었으면 항목·사유까지 그대로 되돌린다", () => {
    expect(claimRestorePatch(claimSnapshot(line))).toEqual({ memberClaim: "OVERTIME", usageItemId: "it1", memberNote: "배포 야근" });
    // 항목 미지정(하나뿐이라 서버가 정한 경우)은 null — 서버가 다시 자동 지정
    expect(claimRestorePatch({ memberClaim: "OVERTIME", usageItemId: null, memberNote: null })).toEqual({ memberClaim: "OVERTIME", usageItemId: null, memberNote: "" });
  });
  it("표시 전이었으면 해제로 되돌리고 항목은 보내지 않는다 (서버가 비움)", () => {
    const r = claimRestorePatch({ memberClaim: null, usageItemId: "it1", memberNote: null });
    expect(r).toEqual({ memberClaim: null, memberNote: "" });
    expect("usageItemId" in r).toBe(false);
  });
  it("옛 값 PERSONAL(본인 부담 확인)이었던 줄은 표시 없음과 같아 해제로 되돌린다 — PERSONAL은 다시 저장하지 않는다", () => {
    const r = claimRestorePatch({ memberClaim: "PERSONAL", usageItemId: null, memberNote: "x" });
    expect(r).toEqual({ memberClaim: null, memberNote: "x" });
    expect("usageItemId" in r).toBe(false);
  });
  it("토스트 문구: 표시·해제 둘뿐", () => {
    expect(claimToggleText("테스트국수", true)).toBe("'테스트국수' 업무 사용으로 표시했어요");
    expect(claimToggleText("테스트국수", false)).toBe("'테스트국수' 업무 사용 표시를 해제했어요");
    expect(claimToggleText("테스트국수", "OVERTIME")).toBe("'테스트국수' 업무 사용으로 표시했어요");
    expect(claimToggleText("테스트국수", null)).toBe("'테스트국수' 업무 사용 표시를 해제했어요");
  });
});

describe("팀원 내역 한 목록 안내", () => {
  const base = { confirmed: false, monthLocked: false, noItems: false, toCheck: 3, undecided: 3 };
  it("표시 전 줄이 있으면 '업무 사용이 있으면 ○를 눌러 표시' + 표시 안 한 건은 본인 부담이라는 안내 (확인을 요구하지 않는다)", () => {
    expect(memberListNotice(base)).toBe("업무로 쓴 건은 ○를 눌러 ‘업무 사용’을 표시하세요. 표시하지 않은 건은 본인 부담(급여 공제)이에요.");
    expect(memberListNotice(base)).not.toMatch(/확인할 내역|본인 부담으로 확인|확인함/);
    expect(memberListTitle(base)).toBe("사용 내역");
  });
  it("확정·마감·항목 없음은 그 사유가 먼저", () => {
    expect(memberListNotice({ ...base, confirmed: true })).toContain("확정");
    expect(memberListTitle({ confirmed: true })).toBe("확정된 내역");
    expect(memberListNotice({ ...base, monthLocked: true, closingStatus: "SUBMITTED" })).toContain("상신되어");
    expect(memberListNotice({ ...base, monthLocked: true, closingStatus: "APPROVED" })).toContain("승인되어");
    expect(memberListNotice({ ...base, noItems: true })).toContain("항목이 정해져 있지 않아");
  });
  it("표시 전 줄이 없으면: 모두 정했음(회사 부담만 표시, 나머지 본인 부담) / 정한 건은 못 바꿈", () => {
    expect(memberListNotice({ ...base, toCheck: 0, undecided: 0 })).toBe("PM이 모두 정했어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 바꾸려면 PM에게 요청하세요.");
    expect(memberListNotice({ ...base, toCheck: 0, undecided: 2 })).toContain("정한 건은 바꿀 수 없어요");
  });
  it("표시 전 줄이 없고 PM 확인 중인 줄이 남으면 그 상태 안내 — 줄별 결과를 따로 알리지 않는다", () => {
    expect(memberListNotice({ ...base, toCheck: 0, undecided: 2, pending: 2 })).toBe("표시한 건은 PM이 확인 중이에요. 바꾸려면 ○를 다시 누르세요. 표시가 없는 건은 본인 부담(급여 공제)이에요.");
    // 모든 상태에서 "표시 없음 = 본인 부담" 규칙이 정확히 한 번 (범례 줄이 따로 없다)
    for (const s of [base, { ...base, confirmed: true }, { ...base, monthLocked: true, closingStatus: "SUBMITTED" as const }, { ...base, toCheck: 0, undecided: 0 }, { ...base, toCheck: 0, undecided: 2 }, { ...base, toCheck: 0, undecided: 2, pending: 2 }])
      expect(memberListNotice(s).split("본인 부담(급여 공제)").length - 1).toBe(1);
    // 모두 정해졌으면 '모두 정했어요'
    expect(memberListNotice({ ...base, toCheck: 0, undecided: 0, pending: 0 })).toContain("모두 정했어요");
    // 표시 전 줄이 있으면 표시 방법 안내가 먼저
    expect(memberListNotice({ ...base, pending: 2 })).toContain("○를 눌러");
    // 안내문 어디에도 'PM이 정함'·'본인 부담 확인' 같은 줄별 상태 글자는 없다
    for (const s of [base, { ...base, toCheck: 0, undecided: 2, pending: 2 }, { ...base, toCheck: 0, undecided: 0 }, { ...base, toCheck: 0, undecided: 2 }]) {
      expect(memberListNotice(s)).not.toMatch(/PM이 정함|본인 부담 확인|확인함/);
    }
  });
  it("확정된 달이 상신·승인까지 되면 PM도 확정 취소를 못 하므로 그 안내 (monthLocked와 무관)", () => {
    expect(memberListNotice({ ...base, confirmed: true, monthLocked: false, closingStatus: "SUBMITTED" })).toBe("이 달은 상신되어 PM도 바꿀 수 없어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 고칠 게 있으면 PM에게 알려 주세요.");
    expect(memberListNotice({ ...base, confirmed: true, monthLocked: false, closingStatus: "APPROVED" })).toBe("이 달은 승인되어 바꿀 수 없어요. 회사 부담 표시가 없는 건은 본인 부담(급여 공제)이에요. 고칠 게 있으면 PM에게 알려 주세요.");
    for (const closingStatus of ["DRAFT", "CLOSED", "REJECTED", null, undefined] as const) {
      expect(memberListNotice({ ...base, confirmed: true, closingStatus })).toContain("확정 취소를 요청하세요");
    }
  });
});

describe("결정 출처", () => {
  it("PM·재무팀·관리자 구분", () => {
    expect(decisionSourceOf({ id: "u", role: "MANAGER" })).toBe("PM");
    expect(decisionSourceOf({ id: "u", role: "HQ" })).toBe("HQ");
    expect(decisionSourceOf({ id: "u", role: "ADMIN" })).toBe("ADMIN");
    expect(sourceLabel("ADMIN")).toBe("시스템 관리자");
    expect(sourceLabel("HQ")).toBe("재무 승인");
    expect(sourceLabel("DEFAULT")).toBe("기본"); // 확정 때 따로 정하지 않아 본인 부담으로 읽는 줄
    expect(sourceLabel("OTHER")).toBe("OTHER");
    expect(sourceLabel(null)).toBe("");
  });
});

describe("열 문자", () => {
  it("Z 다음은 AA", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(701)).toBe("ZZ");
    expect(colLetter(702)).toBe("AAA");
  });
});

describe("CSV 경계", () => {
  it("따옴표 안 줄바꿈·이스케이프 따옴표, CRLF", () => {
    expect(parseCsv('a,"b\nc","d""e"\r\nx,y')).toEqual([["a", "b\nc", 'd"e'], ["x", "y"]]);
  });
});

// ───────────────────────── 월 마감 잠금 (lib/pass-statement passLockedProblem · passClosingNotice)
import { passClosingNotice, passLockedProblem } from "@/lib/pass-statement";

describe("월 마감 잠금", () => {
  it("상신·승인된 달은 출입증 정산을 바꿀 수 없다 (상태별 문구·푸는 방법) — 마감(상신 전)은 수정 가능", () => {
    expect(passLockedProblem("CLOSED")).toBeNull();
    expect(passLockedProblem("SUBMITTED")).toMatch(/^상신된 달의 출입증 정산은 변경할 수 없습니다\. .*반려/);
    expect(passLockedProblem("APPROVED")).toMatch(/^승인된 달의 출입증 정산은 변경할 수 없습니다\. .*승인을 취소/);
  });

  it("작성중·반려 달과 마감 행이 없는 달은 수정할 수 있다", () => {
    expect(passLockedProblem("DRAFT")).toBeNull();
    expect(passLockedProblem("REJECTED")).toBeNull();
    expect(passLockedProblem(null)).toBeNull();
    expect(passLockedProblem(undefined)).toBeNull();
    expect(passLockedProblem("")).toBeNull();
  });

  it("화면 안내: 잠긴 달은 이유, 반려된 달은 다시 확정 → 마감 › 상신 안내", () => {
    expect(passClosingNotice("SUBMITTED", "CONFIRMED")).toEqual({ tone: "locked", text: expect.stringContaining("상신되어 출입증 정산을 수정할 수 없어요") });
    expect(passClosingNotice("APPROVED", "CONFIRMED")?.text).toContain("승인되어");
    expect(passClosingNotice("CLOSED", "OPEN")).toEqual({ tone: "closed", text: expect.stringContaining("마감됐어요") });
    // 반려: 확정 전 명세면 수정 → 확정, 이미 확정된 명세면 확정 취소부터
    expect(passClosingNotice("REJECTED", "OPEN")).toEqual({ tone: "rejected", text: "반려된 달이에요 — 수정 후 다시 확정하고 마감 › 상신하세요." });
    expect(passClosingNotice("REJECTED", "CONFIRMED")?.text).toMatch(/확정 취소 후 수정.*다시 확정.*마감 › 상신/);
    expect(passClosingNotice("DRAFT", "OPEN")).toBeNull();
    expect(passClosingNotice(undefined)).toBeNull();
  });
});
