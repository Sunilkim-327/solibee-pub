import { describe, expect, it } from "vitest";
import {
  carryOver, chooseVendor, defaultVendorName, displayColumns, displayItemsOf, displayNameProblem, mergeDisplayItems, newDisplayKey, parseDisplayItems,
  mergeProfile, mergeProfileDetailed, parseProfile, parseWorkbook, profileScore, replaceWarnings, sheetSetups, splitByScope, statementStartDay, suggestColumns, vendorNameProblem, visibleExtra, isNoiseExtraLabel,
  codeOnlyColumns, detectHeader, isCodeHeader, isCodeLikeValue, lineQuantity, passLineText,
  type CarryLine, type DisplayItem, type Sheet, type SheetConfig,
} from "@/lib/pass-statement";

// 모든 값은 가상 데이터 (실제 업체 파일·이름 사용 금지)
const A_HEAD = ["사용일", "성명", "카드번호", "메뉴", "사용처", "금액"];
const B_HEAD = ["판매일자", "판매시간", "고객성명", "사원카드번호", "상품한글명", "매대명", "총금액1"];
const aSheet = (name: string, rows: (string | number)[][]): Sheet => ({ name, table: [A_HEAD, ...rows] });
const bSheet = (name: string, rows: (string | number)[][]): Sheet => ({ name, table: [B_HEAD, ...rows] });

const aConf = (sheetName: string, label?: string): SheetConfig => ({
  sheetName, headerRow: 1, nameCol: "성명", keyCols: ["카드번호"], amountCols: ["금액"], dateCol: "사용일",
  display: [{ item: "상품", col: "메뉴" }, { item: "매대", col: "사용처" }], ...(label ? { label } : {}),
});
const bConf = (sheetName: string, label?: string): SheetConfig => ({
  sheetName, headerRow: 1, nameCol: "고객성명", keyCols: ["사원카드번호"], amountCols: ["총금액1"], dateCol: "판매일자",
  display: [{ item: "매대", col: "매대명" }, { item: "시간", col: "판매시간" }, { item: "상품", col: "상품한글명" }], ...(label ? { label } : {}),
});
const vendorA = { vendorName: "가상업체A", periodStartDay: 21, sheets: [aConf("식당"), aConf("카페")] };
const vendorB = { vendorName: "가상업체B", periodStartDay: 21, sheets: [bConf("식당"), bConf("카페")] };

describe("업체 서식 자동 선택", () => {
  it("파일 머리글과 가장 잘 맞는 업체 서식을 고른다 (시트 이름이 같아도 머리글로 구분)", () => {
    const aFile = [aSheet("식당", [["2026-06-25", "홍길동", "001", "백반", "본관", 7000]])];
    const bFile = [bSheet("식당", [["2026-07-03", "12:01", "홍길동", "001", "백반", "본관", 7000]]), bSheet("카페", [])];
    expect(chooseVendor(aFile, [vendorB, vendorA])?.vendorName).toBe("가상업체A");
    expect(chooseVendor(bFile, [vendorA, vendorB])?.vendorName).toBe("가상업체B");
    // 두 시트가 모두 맞으면 한 시트보다 점수가 높다
    expect(profileScore(bFile, vendorB.sheets)).toBeGreaterThan(profileScore([bFile[0]], vendorB.sheets));
  });

  it("맞는 서식이 없으면 null (새 업체로 설정)", () => {
    const other: Sheet[] = [{ name: "내역", table: [["일자", "사용자", "결제액"], ["2026-07-01", "홍길동", 5000]] }];
    expect(chooseVendor(other, [vendorA, vendorB])).toBeNull();
    expect(chooseVendor(other, [])).toBeNull();
  });

  it("점수가 같으면 목록 앞쪽(최근 저장) 서식", () => {
    const copy = { ...vendorA, vendorName: "가상업체A2" };
    expect(chooseVendor([aSheet("식당", [])], [copy, vendorA])?.vendorName).toBe("가상업체A2");
  });
});

describe("업체별 다시 올리기 범위", () => {
  const lines = [
    { id: "a1", vendor: "가상업체A", placeType: "식당", sheetName: "식당" },
    { id: "a2", vendor: "가상업체A", placeType: "카페", sheetName: "카페" },
    { id: "b1", vendor: "가상업체B", placeType: "식당", sheetName: "식당" },
    { id: "b2", vendor: "가상업체B", placeType: "카페", sheetName: "카페" },
    { id: "n1", vendor: null, placeType: "식당", sheetName: "식당" },
  ];
  it("같은 업체 + 같은 구분만 교체 — 같은 달에 A·B 식당·카페가 함께 있다", () => {
    const r = splitByScope(lines, ["식당", "카페"], "가상업체B");
    expect(r.replace.map((l) => l.id)).toEqual(["b1", "b2"]);
    expect(r.keep.map((l) => l.id)).toEqual(["a1", "a2", "n1"]);
    expect(splitByScope(lines, ["식당"], "가상업체A").replace.map((l) => l.id)).toEqual(["a1"]);
  });
  it("업체 미지정(null) 줄은 어느 업체와도 같지 않다", () => {
    expect(splitByScope(lines, ["식당"], "업체1").replace).toEqual([]);
  });
});

describe("업체 이름", () => {
  it("기본 이름: 업체1부터 비어 있는 번호 (마이그레이션도 이름 없던 서식을 업체1로)", () => {
    expect(defaultVendorName([])).toBe("업체1");
    expect(defaultVendorName(["업체1", "업체3"])).toBe("업체2");
  });
  it("필수·길이·중복(대소문자·공백 무시)", () => {
    expect(vendorNameProblem(" ", [])).toMatch(/입력/);
    expect(vendorNameProblem("x".repeat(31), [])).toMatch(/30자/);
    expect(vendorNameProblem(" abc ", ["ABC"])).toMatch(/이미/);
    expect(vendorNameProblem("가상업체C", ["가상업체A"])).toBeNull();
  });
});

describe("정산 기간 (업체별)", () => {
  const profiles = [{ vendorName: "가상업체B", periodStartDay: 1 }, { vendorName: "가상업체A", periodStartDay: 21 }];
  it("그 달에 줄이 가장 많은 업체의 서식 기준", () => {
    expect(statementStartDay([{ vendor: "가상업체A", count: 30 }, { vendor: "가상업체B", count: 5 }], profiles)).toBe(21);
    expect(statementStartDay([{ vendor: "가상업체B", count: 30 }, { vendor: null, count: 50 }], profiles)).toBe(1);
  });
  it("올린 줄이 없으면 최근 서식, 서식도 없으면 1", () => {
    expect(statementStartDay([], profiles)).toBe(1);
    expect(statementStartDay([], [])).toBe(1);
  });
  it("업로드 날짜 검사는 고른 업체 서식의 기간으로 (전월 21일 ~ 당월 20일)", () => {
    const file = [aSheet("식당", [["2026-06-25", "홍길동", "001", "백반", "본관", 7000], ["2026-07-25", "홍길동", "001", "백반", "본관", 7000]])];
    const r = parseWorkbook(file, vendorA.sheets, "2026-07", vendorA.periodStartDay, ["상품", "매대"]);
    expect(r.ok && [r.lines.length, r.errors.length]).toEqual([1, 1]);
  });
});

describe("표시 항목 (프로젝트 공통 목록 + 업체별 열 연결)", () => {
  const items: DisplayItem[] = [{ key: "시간", name: "시간" }, { key: "상품", name: "상품명" }, { key: "매대", name: "매대" }];
  const keys = items.map((i) => i.key);

  it("옛 형식(displayCols)은 '머리글 이름 = 표시 항목'으로 읽는다", () => {
    const legacy = { sheetName: "식당", headerRow: 1, nameCol: "고객성명", keyCols: [], amountCols: ["총금액1"], dateCol: null, displayCols: ["판매시간", "#5"] };
    expect(parseProfile([legacy])![0].display).toEqual([{ item: "판매시간", col: "판매시간" }, { item: "F열", col: "#5" }]);
    // 새 형식: 같은 표시 항목을 두 번 연결할 수 없음
    expect(parseProfile([{ ...bConf("식당"), display: [{ item: "상품", col: "상품한글명" }, { item: "상품", col: "매대명" }] }])).toBeNull();
  });

  it("줄의 표시 항목은 업체 시트 설정 순서와 상관없이 프로젝트 목록 순서", () => {
    const a = parseWorkbook([aSheet("식당", [["2026-07-01", "홍길동", "001", "백반", "본관", 7000]])], [aConf("식당")], "2026-07", 1, keys);
    const b = parseWorkbook([bSheet("식당", [["2026-07-01", "12:01", "홍길동", "001", "백반", "본관", 7000]])], [bConf("식당")], "2026-07", 1, keys);
    expect(a.ok && a.lines[0].extra).toEqual([{ label: "상품", value: "백반" }, { label: "매대", value: "본관" }]);
    expect(b.ok && b.lines[0].extra.map((e) => e.label)).toEqual(["시간", "상품", "매대"]);
    expect(b.ok && b.perSheet[0].columns).toEqual(["시간", "상품", "매대"]);
  });

  it("연결 안 된 항목은 그 업체 줄에 없고, 화면·엑셀 열은 목록 순서 (값 없으면 '—'로 표시)", () => {
    const cols = displayColumns(items, [{ extra: [{ label: "상품", value: "백반" }] }, { extra: [{ label: "옛항목", value: "x" }] }]);
    expect(cols.map((c) => c.name)).toEqual(["시간", "상품명", "매대", "옛항목"]);
    // 화면 줄: 목록 순서로 모든 보이는 항목, 그 업체에 없는 항목은 빈 값(화면에서 '—')
    // 시간 항목은 줄의 시간 칸이 따로 있어 화면 줄에서는 뺀다 (목록·엑셀에는 그대로)
    expect(visibleExtra([{ label: "상품", value: "백반" }], items)).toEqual([{ label: "상품명", value: "백반" }, { label: "매대", value: "" }]);
  });

  it("금액·수량·구간·시간·날짜 같은 표시 항목은 줄 금액·시간·날짜 칸이 따로 보이므로 화면 줄에서 뺀다 (목록에 있어도, 목록에 없는 옛 이름표여도)", () => {
    expect(["총금액1", "총금액", "판매수량", "단가", "합계금액", "판매구간명칭", "Total Amount", "Qty", "판매시간", "이용시각", "판매일자", "거래일시", "Date"].every(isNoiseExtraLabel)).toBe(true);
    expect(["매대명", "상품한글명", "사용처", "메뉴", "상품구분", "영업장 명칭"].some(isNoiseExtraLabel)).toBe(false);
    const list: DisplayItem[] = [{ key: "매대명", name: "매대명" }, { key: "상품한글명", name: "상품한글명" }, { key: "판매구간명칭", name: "판매구간명칭" }, { key: "판매수량", name: "판매수량" }, { key: "총금액1", name: "총금액1" }];
    const extra = [{ label: "매대명", value: "본관" }, { label: "상품한글명", value: "백반" }, { label: "판매구간명칭", value: "상설" }, { label: "판매수량", value: "1" }, { label: "총금액1", value: "1500" }, { label: "총금액", value: "1500" }, { label: "상품구분", value: "식사" }];
    expect(visibleExtra(extra, list)).toEqual([{ label: "매대명", value: "본관" }, { label: "상품한글명", value: "백반" }, { label: "상품구분", value: "식사" }]);
    // 엑셀 열(displayColumns)은 그대로
    expect(displayColumns(list, [{ extra }]).map((c) => c.key)).toEqual(["매대명", "상품한글명", "판매구간명칭", "판매수량", "총금액1", "총금액", "상품구분"]);
  });

  it("양식 설정: 표시 항목 이름과 같은 머리글은 자동 연결", () => {
    const s = suggestColumns(B_HEAD, [{ key: "시간", name: "판매시간" }, { key: "상품", name: "상품명" }])!;
    expect(s.display).toEqual({ 시간: 1 });
    const setups = sheetSetups([bSheet("식당", [])], [bConf("식당")], [...items, { key: "고객", name: "고객성명" }]);
    expect(setups[0].selection.display).toMatchObject({ 매대: 5, 시간: 1, 상품: 4, 고객: 2 });
  });

  it("목록: 저장된 목록 → 없으면 서식들에서, 이름 배열(마이그레이션)은 키 = 이름", () => {
    expect(displayItemsOf(JSON.stringify(["상품한글명", "매대명"]), [])).toEqual([{ key: "상품한글명", name: "상품한글명" }, { key: "매대명", name: "매대명" }]);
    expect(displayItemsOf(null, [vendorA, vendorB]).map((i) => i.key)).toEqual(["상품", "매대", "시간"]);
    expect(parseDisplayItems([{ key: "a", name: "가" }, { key: "b", name: "가" }])).toBeNull(); // 보이는 이름 겹침
    expect(parseDisplayItems([{ key: "a", name: "가", hidden: true }, { key: "b", name: "가" }])).toHaveLength(2);
  });

  it("이름 바꾸기는 키 유지, 삭제는 숨김으로 남김, 새 키는 겹치지 않게", () => {
    const next = mergeDisplayItems(items, [{ key: "상품", name: "메뉴" }, { key: "시간", name: "시간" }]);
    expect(next).toEqual([{ key: "상품", name: "메뉴" }, { key: "시간", name: "시간" }, { key: "매대", name: "매대", hidden: true }]);
    expect(newDisplayKey("매대", next)).toBe("매대~2");
    expect(displayNameProblem("메뉴", next)).toMatch(/이미/);
    expect(displayNameProblem("매대", next)).toBeNull(); // 숨긴 항목 이름은 다시 쓸 수 있음
  });

  it("다시 올릴 때 표시 항목 순서가 달라도 같은 줄로 보고 결정을 이어받는다", () => {
    const old: CarryLine = {
      date: "2026-07-01", holderName: "홍길동", amount: 7000, extra: JSON.stringify([{ label: "매대", value: "본관" }, { label: "상품", value: "백반" }]), userId: "u1",
      memberClaim: "OVERTIME", memberNote: null, decision: "OVERTIME", usageItemId: null, decisionSource: "PM", decidedBy: "u9", decidedAt: null,
      onBehalfName: null, collectFrom: null, collectedAt: null, collectNote: null,
    };
    const fresh = { date: "2026-07-01", holderName: "홍길동", amount: 7000, extra: JSON.stringify([{ label: "상품", value: "백반" }, { label: "매대", value: "본관" }]), userId: "u1" };
    expect(carryOver([old], [fresh]).carried).toBe(1);
  });
});

describe("같은 업체가 구분별 파일을 같은 시트 이름으로 보낼 때", () => {
  const food = { ...aConf("Sheet1"), label: "식당" };
  const cafe = { ...aConf("Sheet1"), label: "카페" };
  const file = [aSheet("Sheet1", [["2026-07-02", "홍길동", "001", "라떼", "1층", 4500]])];

  it("서식에 같은 시트 이름의 구분별 설정을 함께 둔다 (구분이 다르면 허용, 같으면 거부)", () => {
    expect(parseProfile([food, cafe])).toHaveLength(2);
    expect(parseProfile([food, { ...food }])).toBeNull();
    // 카페 파일을 설정해도 식당 설정은 남는다 / 같은 구분은 새 설정으로
    expect(mergeProfile([food], [cafe], ["Sheet1"]).map((c) => c.label)).toEqual(["식당", "카페"]);
    expect(mergeProfile([food, cafe], [{ ...cafe, headerRow: 2 }], ["Sheet1"]).map((c) => [c.label, c.headerRow])).toEqual([["식당", 1], ["카페", 2]]);
  });

  it("어느 구분인지 정할 수 없으면 자동으로 정하지 않고 고르게, 고른 구분으로 읽는다", () => {
    const r = parseWorkbook(file, [food, cafe], "2026-07");
    expect(!r.ok && r.ambiguous).toEqual([{ sheet: "Sheet1", labels: ["식당", "카페"] }]);
    const picked = parseWorkbook(file, [food, cafe], "2026-07", 1, [], { Sheet1: "카페" });
    expect(picked.ok && [picked.scope, picked.lines[0].label]).toEqual([["카페"], "카페"]);
    // 업체 자동 선택 점수는 모호해도 맞는 서식으로 계산
    expect(profileScore(file, [food, cafe])).toBeGreaterThan(100);
  });
});

describe("반영 전 경고 (기존 줄을 다른 내용으로 교체)", () => {
  const old = Array.from({ length: 10 }, (_, i) => ({ placeType: "식당", sheetName: "Sheet1", vendor: "가상업체A", date: `2026-07-${String(i + 1).padStart(2, "0")}` }));
  it("날짜 범위가 겹치지 않음·건수 차이 큼·파일 이름의 다른 구분", () => {
    const fresh = [{ label: "식당", date: "2026-06-25" }, { label: "식당", date: "2026-06-26" }];
    const w = replaceWarnings(old, fresh, ["식당"], "가상업체A", "7월_카페.xlsx", ["식당", "카페"]);
    expect(w).toHaveLength(3);
    expect(w[0]).toMatch(/겹치지 않습니다/);
    expect(w[1]).toMatch(/10건이 이번 파일 2건/);
    expect(w[2]).toMatch(/'카페'이\(가\) 있는데 '식당'/);
  });
  it("비슷한 내용으로 다시 올리면 경고 없음, 다른 업체 줄은 비교하지 않음", () => {
    const fresh = old.map((l) => ({ label: "식당", date: l.date }));
    expect(replaceWarnings(old, fresh, ["식당"], "가상업체A", "7월_식당.xlsx", ["식당", "카페"])).toEqual([]);
    expect(replaceWarnings(old, [{ label: "식당", date: "2026-01-01" }], ["식당"], "가상업체B", "x.xlsx", ["식당"])).toEqual([]);
  });
});

describe("시간 열·머리글 변형", () => {
  it("서식에서 고른 시간 열로 시간을 읽는다 (저녁·야근 판단)", () => {
    const head = ["이용일", "이름", "카드No", "코너", "이용시각", "결제금액"];
    const sheet: Sheet = { name: "내역", table: [head, ["2026-07-03", "홍길동", "B-1", "한식", "19:05", 9000]] };
    const s = suggestColumns(head)!;
    expect([s.timeCol, s.keyCols, s.display]).toEqual([4, [2], { 코너: 3, 이용시각: 4 }]);
    const conf: SheetConfig = { sheetName: "내역", headerRow: 1, nameCol: "이름", keyCols: ["카드No"], amountCols: ["결제금액"], dateCol: "이용일", timeCol: "이용시각", display: [] };
    expect(parseProfile([conf])![0].timeCol).toBe("이용시각");
    const r = parseWorkbook([sheet], [conf], "2026-07");
    expect(r.ok && [r.lines[0].time, r.lines[0].keys.length]).toEqual(["19:05", 1]);
  });
});

describe("양식 수정: 구분 없던 설정을 고치면 교체하고 기존 줄 구분을 잇는다", () => {
  const csv = { ...aConf("CSV") }; // 구분 없음 (시트 이름이 구분)
  it("구분 없는 같은 시트 설정은 새 설정으로 교체 + 구분 바뀜 기록", () => {
    const r = mergeProfileDetailed([csv], [{ ...csv, label: "카페" }], ["CSV"]);
    expect(r.sheets.map((c) => [c.sheetName, c.label])).toEqual([["CSV", "카페"]]);
    expect(r.relabels).toEqual([{ sheetName: "CSV", from: "CSV", to: "카페" }]);
  });
  it("고친 기존 설정(from)을 교체 — 같은 시트의 다른 구분 설정은 그대로", () => {
    const food = { ...aConf("Sheet1"), label: "식당" }, cafe = { ...aConf("Sheet1"), label: "카페" };
    const r = mergeProfileDetailed([food, cafe], [{ ...cafe, label: "커피", from: "카페" }], ["Sheet1"]);
    expect(r.sheets.map((c) => c.label)).toEqual(["식당", "커피"]);
    expect(r.relabels).toEqual([{ sheetName: "Sheet1", from: "카페", to: "커피" }]);
    expect(r.sheets.some((c) => "from" in c)).toBe(false); // from은 저장하지 않음
  });
  it("구분이 이미 있는 설정에 새 구분을 더하면(식당·카페를 따로 받는 업체) 둘 다 남는다", () => {
    const food = { ...aConf("Sheet1"), label: "식당" };
    const r = mergeProfileDetailed([food], [{ ...aConf("Sheet1"), label: "카페" }], ["Sheet1"]);
    expect([r.sheets.map((c) => c.label), r.relabels]).toEqual([["식당", "카페"], []]);
  });
});

describe("코드 값·수량·화면 줄 글자 (팀원 내 지출 내역 = PM 팀원별 내역)", () => {
  // 모든 값은 가상 데이터
  it("코드 값: 영문 대문자 2자 이상 + 숫자 (CATE012·PRD-0001). 상품명·한글·숫자만은 아님", () => {
    expect(["CATE012", "PRD-0001", "AB_12", " XY9 "].every(isCodeLikeValue)).toBe(true);
    expect(["백반", "A세트", "1500", "SET", "a12", "", null, undefined].some(isCodeLikeValue)).toBe(false);
  });

  it("코드 머리글: 상품구분·상품코드·분류코드·Category — 상품명·매대명은 아님", () => {
    expect(["상품구분", "상품코드", "분류코드", "Product Code", "category"].every(isCodeHeader)).toBe(true);
    expect(["상품한글명", "매대명", "판매시간", "메뉴"].some(isCodeHeader)).toBe(false);
  });

  it("처음 추천: 코드 머리글(상품구분)과 값이 코드뿐인 열은 표시 열로 추천하지 않는다 (목록이 있으면 PM이 고른 대로)", () => {
    const head = ["판매일자", "판매시간", "고객성명", "사원카드번호", "상품구분", "매대명", "총금액1"];
    expect(suggestColumns(head)!.display).toEqual({ 판매시간: 1, 매대명: 5 }); // 상품구분은 item 동의어가 아니라도 머리글 가드로 한 번 더
    const table: Sheet["table"] = [
      ["판매일자", "판매시간", "고객성명", "사원카드번호", "상품명", "매대명", "총금액1"],
      ["2026-07-01", "12:01", "홍길동", "001", "CATE012", "본관", 7000],
      ["2026-07-02", "12:03", "홍길동", "001", "CATE034", "본관", 7000],
    ];
    expect(codeOnlyColumns(table, 1)).toEqual(new Set([4]));
    expect(detectHeader(table)!.selection.display).toEqual({ 판매시간: 1, 매대명: 5 });
    // 값이 섞여 있으면(코드 + 글자) 코드 열이 아니다
    expect(codeOnlyColumns([...table, ["2026-07-03", "12:05", "홍길동", "001", "백반", "본관", 7000]], 1).size).toBe(0);
    // 프로젝트 목록이 있으면 이름이 같은 머리글은 그대로 연결 (PM이 고른 것)
    expect(detectHeader(table, [{ key: "상품명", name: "상품명" }])!.selection.display).toEqual({ 상품명: 4 });
  });

  it("수량: 수량 이름표가 2 이상의 정수일 때만 (1·빈 값·없음은 null)", () => {
    expect(lineQuantity([{ label: "판매수량", value: "2" }])).toBe(2);
    expect(lineQuantity([{ label: "Qty", value: " 3 " }])).toBe(3);
    expect(lineQuantity([{ label: "판매수량", value: "1" }])).toBeNull();
    expect(lineQuantity([{ label: "판매수량", value: "" }])).toBeNull();
    expect(lineQuantity([{ label: "판매수량", value: "1.5" }])).toBeNull();
    expect(lineQuantity([{ label: "상품명", value: "2" }])).toBeNull();
  });

  it("화면 줄 글자: 첫 값 제목, 둘째 보조(없으면 구분), 셋째부터 '이름표 값'. 수량 2 이상은 품목(보조, 없으면 제목) 뒤에 '× n'. 코드 값은 어느 자리든 빈 것으로", () => {
    const line = { extra: [{ label: "매대명", value: "본관" }, { label: "상품한글명", value: "백반" }, { label: "상품구분", value: "CATE012" }], time: "12:01:33", placeType: "식당", qty: null };
    expect(passLineText(line)).toEqual({ title: "본관", sub: "백반", time: "12:01", more: "", meta: "백반" });
    // 셋째 값이 글자면 보인다
    expect(passLineText({ ...line, extra: [...line.extra.slice(0, 2), { label: "상품구분", value: "식사" }] }).meta).toBe("백반 · 상품구분 식사");
    // 수량 2: 둘째 값(품목)이 있으면 그 뒤에 '× 2' — 매대 이름(제목)에는 붙지 않는다
    expect(passLineText({ extra: [{ label: "매대명", value: "본사 1층 카페" }, { label: "상품한글명", value: "ICE아메리카노(히스토리)" }], time: "15:10", placeType: "카페", qty: 2 }))
      .toEqual({ title: "본사 1층 카페", sub: "ICE아메리카노(히스토리) × 2", time: "15:10", more: "", meta: "ICE아메리카노(히스토리) × 2" });
    // 수량 2, 둘째 값이 비면 제목에 붙고 보조는 구분으로
    expect(passLineText({ extra: [{ label: "상품한글명", value: "김밥" }, { label: "매대명", value: "" }], time: "9:05", placeType: "카페", qty: 2 })).toEqual({ title: "김밥 × 2", sub: null, time: "9:05", more: "", meta: "카페" });
    // 첫 값이 코드면 제목은 구분, 아무것도 없으면 '기타'
    expect(passLineText({ extra: [{ label: "상품코드", value: "PRD001" }], placeType: "식당" }).title).toBe("식당");
    expect(passLineText({ extra: [] }).title).toBe("기타");
    expect(passLineText({ extra: [], sheetName: "Sheet1" }).meta).toBe("Sheet1");
  });
});
