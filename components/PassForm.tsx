"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dayLabel, shortDate, won } from "@/lib/format";
import { Headcount, ListRow, MetaLine } from "./list/ListRow";
import { DayGroup, RowList } from "./list/DayGroup";
import type { PassLineRow, PassUsageRow } from "@/lib/dto";
import { choiceToClaim, claimChoiceOf, claimRestorePatch, claimSnapshot, claimToggleText, companyChoice, companySplit, dayLimitMessage, dayLimitOver, isCompanyChoice, memberExpectation, memberListNotice, memberListTitle, passLineText, passLockedProblem, type ClaimPatch, type PassItem } from "@/lib/pass-statement";
import type { ClosingStatus } from "@/lib/types";
import { useLinePatch } from "./pass/useLinePatch";
import { useScrollSettleGuard } from "./hooks/useScrollSettleGuard";
import { toast } from "./Nav";
import { chip, limitBadge } from "./ui";

const FILTER_KEY = "pass-lines-filter";
type LinesFilter = "all" | "claimed";
const PLACE_ICON: Record<string, string> = { 식당: "🍚", 카페: "☕", 편의점: "🏪", 기타: "🧾" };

const normName = (v: string) => v.replace(/s+/g, "");
/** 다른 사람 사용분을 내 것으로 연결한 줄 — 누구 것인지 (외부인 대납 또는 업체 내역 이름이 내 이름과 다름) */
export function mappedFrom(l: PassLineRow): { name: string; external: boolean } | null {
  if (l.onBehalfName) return { name: l.onBehalfName, external: true };
  if (l.userName && normName(l.holderName) !== normName(l.userName)) return { name: l.holderName, external: false };
  return null;
}

/** 회사 부담으로 셈: PM이 정했거나, 팀원이 업무 사용을 표시하고 PM이 아직 정하지 않은 건 */
const isCompany = (l: PassLineRow) => l.decision === "OVERTIME" || (!l.decision && l.memberClaim === "OVERTIME");

/** 구분(식당·카페 …)별 묶음과 합계 (줄 순서 유지). 회사 부담은 하루 한도 배분(split)대로 — 초과분은 본인 부담 */
function byPlace(lines: PassLineRow[], split: Map<string, { personal: number }>) {
  const map = new Map<string, { place: string; count: number; total: number; company: number; deduct: number; lines: PassLineRow[] }>();
  for (const l of lines) {
    const k = l.placeType || "기타";
    const g = map.get(k) ?? { place: k, count: 0, total: 0, company: 0, deduct: 0, lines: [] };
    g.count++;
    g.total += l.amount;
    const over = isCompany(l) ? split.get(l.id)?.personal ?? 0 : l.amount;
    g.company += l.amount - over;
    g.deduct += over;
    g.lines.push(l);
    map.set(k, g);
  }
  return [...map.values()];
}

type LimitOver = ReturnType<typeof dayLimitOver>;

/** 날짜별 소제목 + 그 날 줄들 (공통 DayGroup). 같은 날 회사 부담이 항목 1일 한도를 넘으면 소제목에 경고 */
function DayList({ lines, over, renderLine }: { lines: PassLineRow[]; over: LimitOver; renderLine: (l: PassLineRow) => React.ReactNode }) {
  return (
    <DayGroup items={lines} dateOf={(l) => l.date} amountOf={(l) => l.amount} render={renderLine} bleed band headClassName="-mx-4 px-4"
      extra={(d) => [...new Map(d.items.flatMap((l) => (over.get(l.id) ? [over.get(l.id)!] : [])).map((w) => [w.itemName, w])).values()].map((w) => (
        <span key={w.itemName} className={limitBadge}>{dayLimitMessage(w)}</span>
      ))} />
  );
}

/** 사유 자동 저장: 입력이 멈추면(0.8초) 저장, 칸을 벗어나거나 화면을 떠날 때는 바로 저장 */
function NoteInput({ initial, disabled, onSave }: { initial: string; disabled: boolean; onSave: (note: string) => Promise<boolean> }) {
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const saved = useRef(initial);
  const value = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useRef(async () => {});
  save.current = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const v = value.current.trim();
    if (v === saved.current.trim()) { setState((s) => (s === "dirty" ? "idle" : s)); return; }
    setState("saving");
    const ok = await onSave(v);
    if (ok) saved.current = v;
    setState(ok ? "saved" : "error");
  };
  // 화면을 떠날 때 저장하지 못한 입력이 있으면 저장
  useEffect(() => () => { if (value.current.trim() !== saved.current.trim()) void save.current(); }, []);
  const label = { idle: "", dirty: "입력 중…", saving: "저장 중…", saved: "저장됨 ✓", error: "저장하지 못했어요" }[state];
  return (
    <div>
      <input className="input min-h-11 py-2 text-base" placeholder="사유 (선택) 예) 배포 작업 야근" maxLength={200} disabled={disabled}
        defaultValue={initial} aria-label="업무 사용 사유" aria-describedby={undefined}
        onChange={(ev) => {
          value.current = ev.target.value;
          setState("dirty");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save.current(), 800);
        }}
        onBlur={() => void save.current()} />
      <p className={`mt-1 h-4 text-right text-xs ${state === "error" ? "text-rose-700" : state === "saved" ? "text-status-approved" : "text-fg-subtle"}`} aria-live="polite">{label}</p>
    </div>
  );
}

/** 항목 이름에서 출입증 표기 빼기: "야근식대(출입증)" · "출입증 야근식대" → "야근식대" */
const shortName = (name: string) => name.replace(/\(.*?\)/g, "").replace(/출입증\s*/g, "").trim() || name;

/** 줄 제목: 표시 열 첫 값, 없으면 구분 — PM 팀원별 내역과 같은 문구(passLineText). 수량(× n)은 품목(둘째 값) 뒤에 */
const lineTitle = (l: PassLineRow) => passLineText(l).title;

/** 저녁(18시 이후) 식당 사용 — 야근식대 후보로 살짝 강조 (시간 열이 없는 양식이면 표시 안 함) */
const isDinner = (l: PassLineRow) => (l.placeType ?? "") === "식당" && !!l.time && l.time.slice(0, 5) >= "18:00";

/**
 * 출입증 사용 한 줄 (토스 ListRow형 2줄 컴팩트) — 확인할 줄·결정 완료 줄 공통.
 * 1줄째 품목, 2줄째 시간·사용처, 오른쪽 금액. 기본값(본인 부담 — 급여 공제)은 줄에 쓰지 않고 바뀐 것만 표시한다.
 * editable: 오른쪽 체크로 '업무 사용' 표시/취소 (회사 부담 항목이 둘 이상이면 고르기), 표시한 줄만 '사유 추가'(자동 저장).
 * 팀원이 하는 일은 업무 사용 표시 하나뿐 — 표시 없음 = 본인 부담(기본값)이라 글자도 버튼도 없다.
 * 상태: 표시 전(빈 원) → 업무 사용 · PM 확인 중(초록 체크 + 'PM 확인 중') → 회사 부담 배지(PM이 회사 부담으로 정함) / 그 외(본인 부담·PM이 본인 부담으로 정함)는 글자 없음
 * (야근 신청 승인 + 일과 종료 후 1시간 30분 이상 근무한 날은 Soliday 연동 후 자동 인정 예정 — lib/overtime.ts)
 * memo: 다른 줄의 진행 중 표시·필터 전환 때 바뀌지 않은 줄은 다시 그리지 않는다 — 콜백은 줄(id)을 인자로 받는 안정적인 함수
 */
const PassRow = memo(function PassRow({ line: l, editable, items, disabled, onPatch, onClaim, part }: {
  line: PassLineRow; editable: boolean; items: PassItem[]; disabled: boolean; onPatch: (id: string, json: Record<string, unknown>) => Promise<boolean>;
  /** 업무 사용 표시·해제·항목 선택 — 되돌리기 토스트가 따라온다 */
  onClaim: (l: PassLineRow, json: ClaimPatch) => Promise<boolean>;
  /** 하루 한도 배분 (회사 부담 줄 중 한도가 있는 항목) */
  part?: { company: number; personal: number; limit: number };
}) {
  const [picking, setPicking] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const value = claimChoiceOf(l);
  const claimed = isCompanyChoice(value);
  const single = items.length === 1 ? items[0] : null;
  const missing = claimed && !items.some((i) => companyChoice(i.id) === value);
  const itemName = shortName((single && !missing ? single.name : l.usageItemName) ?? "업무 사용");
  const place = l.placeType || "기타";
  // 줄 글자: 표시 열 첫 값이 제목, 둘째가 보조(없으면 구분), 셋째부터는 '이름표 값' — PM 팀원별 내역과 같은 함수(passLineText). 코드 값(CATE012 등)은 안 보인다
  const v = passLineText(l);
  const title = v.title;
  const meta = v.meta;
  const on = editable && claimed;
  const from = mappedFrom(l);

  // 금액 아래 결과: 회사 부담은 초록 배지(+왼쪽 띠)로 눈에 띄게, 업무 사용을 표시해 PM이 아직 안 정한 줄은 'PM 확인 중'.
  // 본인 부담(표시 안 함·PM이 본인 부담으로 정함·옛 PERSONAL)은 기본값이라 글자를 쓰지 않는다 — 목록 위 안내 한 줄로 충분.
  // 글자로 남기는 예외는 업무 사용을 표시했는데 본인 부담으로 정해진 줄("요청 → 본인 부담")뿐 (PM 보드와 같은 문구).
  // 하루 한도 배분 줄은 "회사 부담 3,000 · 초과 5,000" — 초과분이 본인 부담이라는 설명은 날짜 소제목의 한도 배지가 한다
  const company = l.decision === "OVERTIME";
  const result = company && part && part.personal > 0 ? { text: <><span className="badge badge-ok">회사 부담 {won(part.company)}</span> · 초과 {won(part.personal)}</>, cls: "text-fg-muted" }
    : company ? { text: <span className="badge badge-ok">회사 부담</span>, cls: "" }
    : !l.decision && l.memberClaim === "OVERTIME" ? { text: "PM 확인 중", cls: "text-amber-700" }
    : l.decision === "DEDUCT" && l.memberClaim === "OVERTIME" ? { text: "요청 → 본인 부담", cls: "text-status-rejected" }
    : null;
  // 품목 아래 근거: 회사 부담 항목 이름, PM 확인 중이면 '업무 사용 · 항목'
  const resultNote = l.decision === "OVERTIME" ? shortName(l.usageItemName ?? "회사 부담")
    : !l.decision && l.memberClaim === "OVERTIME" ? `업무 사용 · ${shortName(l.usageItemName ?? "회사 부담")}` : null;

  function toggle() {
    if (claimed) { setPicking(false); setNoteOpen(false); void onClaim(l, choiceToClaim("")); }
    else if (single) void onClaim(l, choiceToClaim(companyChoice(single.id)));
    else setPicking((p) => !p);
  }
  // 스크롤 직후·살짝 끈 탭은 무시 (스크롤하다 실수로 누르는 것 방지) — 키보드는 그대로
  const guard = useScrollSettleGuard(toggle);
  // 접근성 이름: 날짜 시간 품목 금액 (겹치는 말은 한 번만)
  const rowLabel = [...new Set([l.date ? dayLabel(l.date) : "", l.time?.slice(0, 5) ?? "", title.startsWith(l.time?.slice(0, 5) ?? "\u0000") ? "" : title])].filter(Boolean).join(" ") + ` ${won(l.amount)}원`;

  return (
    <ListRow accent={on || company ? "ok" : undefined} lead={PLACE_ICON[place] ?? "🧾"} title={title} amount={l.amount}
      metaWrap
      meta={<>
        {from && <span className="shrink-0 rounded bg-sky-100 px-1.5 text-xs font-semibold text-sky-800">{from.external ? "외부인 " : ""}{from.name} 사용분</span>}
        {/* 2줄째는 품목(또는 구분)만 — 시각은 툴팁·저녁 배지로 */}
        <span className="min-w-0 truncate" title={v.time ? `${l.date ?? ""} ${v.time}`.trim() : undefined}>{meta}</span>
        {editable && !claimed && isDinner(l) && <span className="shrink-0 rounded bg-amber-100 px-1 text-xs font-semibold text-amber-800">저녁</span>}
        {on && (
          <button type="button" className="min-w-0 truncate text-left font-medium text-emerald-700 hover:underline dark:text-emerald-300" onClick={() => setNoteOpen((v) => !v)}>
            {/* 회사 부담 항목이 하나뿐이면 항목 이름은 생략 (좁은 화면에서 금액 칸과 겹치지 않게) */}
            업무 사용{items.length > 1 ? ` · ${itemName}` : ""} · {l.memberNote ? `사유: ${l.memberNote}` : "사유 추가"} ›
          </button>
        )}
      </>}
      sub={!editable && (resultNote || l.memberNote) ? <div className="mt-0.5 truncate text-xs text-fg-subtle">{[resultNote, l.memberNote ? `사유: ${l.memberNote}` : null].filter(Boolean).join(" · ")}</div> : undefined}
      valueSub={<>
        {!editable && result && <div className={`text-xs font-medium ${result.cls}`}>{result.text}</div>}
        {on && <div className="text-xs font-medium text-amber-700">PM 확인 중</div>}
      </>}
      trail={editable && (
        <div className="flex shrink-0 items-center">
          {/* ○ 하나뿐: 업무 사용 표시/해제. 표시 안 함 = 본인 부담(기본값) */}
          <button type="button" role="switch" aria-checked={claimed} disabled={disabled} {...guard}
            aria-label={`${rowLabel} 업무 사용`}
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full disabled:cursor-wait disabled:opacity-50">
            <span className={`flex size-6 items-center justify-center rounded-full text-sm font-bold transition-colors ${claimed ? "bg-emerald-600 text-on-primary" : picking ? "ring-2 ring-emerald-500" : "ring-1 ring-line-strong"}`}>
              {claimed ? "✓" : ""}
            </span>
          </button>
        </div>
      )}>
      {editable && (picking || missing) && (!single || missing) && (
        <div className="px-4 pb-3 pl-16">
          <select className="input min-h-10 py-1.5 text-base" value={claimed ? value : ""} disabled={disabled} aria-label="업무 사용 항목"
            onChange={(ev) => ev.target.value && void onClaim(l, choiceToClaim(ev.target.value)).then((ok) => ok && setPicking(false))}>
            {!claimed && <option value="" disabled>업무 사용 항목을 고르세요</option>}
            {items.map((i) => <option key={i.id} value={companyChoice(i.id)}>{shortName(i.name)}{i.perPersonLimit ? ` (1일 ${won(i.perPersonLimit)}원)` : ""}</option>)}
            {missing && <option value={value}>{l.usageItemName ?? "항목 미지정"} (지금은 고를 수 없는 항목)</option>}
          </select>
        </div>
      )}
      {on && noteOpen && (
        <div className="px-4 pb-3 pl-16">
          <NoteInput initial={l.memberNote ?? ""} disabled={false} onSave={(note) => onPatch(l.id, { memberNote: note })} />
        </div>
      )}
    </ListRow>
  );
});

/**
 * 팀원: 그 달 내 출입증 사용 내역 (업체 내역에서 본인 줄만 — 서버에서 거른 데이터). 내 지출 내역의 출입증 탭.
 * 요약(전체·구분별) → 한 목록(날짜순): 표시 전 줄(스위치)·요청 중(PM 확인 중)·PM이 정한 줄(회사 부담 배지만) 모두 제자리에.
 * PM이 정한 줄이 다른 곳으로 옮겨가 "사라진 것처럼" 보이지 않게 한 목록에 두고, 칩으로 "표시 전"·"회사 부담"만 거를 수 있다.
 * 팀원이 하는 일은 업무로 쓴 줄에 '업무 사용'을 표시하는 것 하나뿐(PM이 정하기 전 줄만) — 표시 안 한 줄은 본인 부담(기본값)이라 따로 확인하지 않는다.
 * PM이 확인해 회사 부담 / 본인 부담으로 정한다.
 */
export function MyPassLines({ lines: initial, confirmed, passName, items, closingStatus }: {
  lines: PassLineRow[]; confirmed: boolean; passName: string; items: PassItem[];
  /** 이 달 마감 상태 — 상신·승인이면 확정 전이어도 업무 사용 표시를 바꿀 수 없다 (마감은 가능) */
  closingStatus?: ClosingStatus | null;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initial);
  // 서버에서 새 줄 목록(router.refresh)이 오면 렌더 중에 바로 바꿔 끼운다 — useEffect로 하면 옛 줄로 한 번 그린 뒤 다시 그린다 (커밋 2번)
  const [syncedInitial, setSyncedInitial] = useState(initial);
  if (initial !== syncedInitial) { setSyncedInitial(initial); setLines(initial); }
  const { patch: patchLine, busy, err } = useLinePatch(setLines);
  // 줄 목록·항목이 바뀔 때만 다시 계산 (필터 전환·진행 중 표시·사유 입력 때는 그대로) — 하루 한도 배분(companySplit)은 한 번만 하고 돌려 쓴다
  const { e, split, pendingClaim, company, sorted, groups, undecided, over, pmPending, claimedNow, mapped } = useMemo(() => {
    const sorted = [...lines].sort((a, b) => `${a.date ?? ""}${a.time ?? ""}`.localeCompare(`${b.date ?? ""}${b.time ?? ""}`));
    const claimedNow = lines.filter((l) => !l.decision && l.memberClaim === "OVERTIME");
    const split = companySplit(lines, items);
    // 요약 합계는 줄의 "회사 부담 12,000 · 초과 5,000" 표시와 같은 배분(memberExpectation): 회사 부담 = 전체 − 본인 부담 예정(한도 초과분 포함)
    const e = memberExpectation(lines, items, split);
    // 다른 사람 사용분 (누구 것인지) — 업체 내역 이름순
    const mapped = [...lines.reduce((m, l) => {
      const f = mappedFrom(l);
      if (!f) return m;
      const g = m.get(f.name) ?? { ...f, count: 0, amount: 0 };
      g.count++;
      g.amount += l.amount;
      return m.set(f.name, g);
    }, new Map<string, { name: string; external: boolean; count: number; amount: number }>()).values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return {
      e,
      split,
      pendingClaim: claimedNow.length > 0,
      company: e.total - e.expected,
      sorted,
      groups: byPlace(sorted, split),
      undecided: lines.filter((l) => !l.decision && !l.onBehalfName).length,
      over: dayLimitOver(lines, items, split),
      pmPending: claimedNow.length,
      claimedNow,
      mapped,
    };
  }, [lines, items]);
  // 월 마감으로 잠긴 달 (지출과 같은 기준) — 서버도 같은 규칙으로 403
  const monthLocked = !confirmed && !!passLockedProblem(closingStatus);
  const frozen = confirmed || monthLocked;

  // PM이 정한 줄·확정된 달·마감된 달·외부인 처리 건은 결과만 보인다
  const hasItems = items.length > 0;
  const editableOf = (l: PassLineRow) => !frozen && !l.onBehalfName && !l.decision && hasItems;
  // 표시 전(안내문 기준): 업무 사용을 표시하지 않은 미결정 건 (= 본인 부담 기본값. 옛 PERSONAL도 표시 없음과 같다) — 칩으로는 두지 않는다(기본값이라 거를 의미가 없음)
  // 회사 부담: 업무 사용을 표시한 건(PM 확인 중) + 회사 부담으로 정해진 건. PM이 본인 부담으로 정한 줄·외부인 대납 줄은 줄 글자로만 구분한다
  const { toCheck, claimedAll } = useMemo(() => ({
    toCheck: sorted.filter((l) => !frozen && !l.onBehalfName && !l.decision && hasItems && l.memberClaim !== "OVERTIME"),
    claimedAll: sorted.filter((l) => !l.onBehalfName && ((!l.decision && l.memberClaim === "OVERTIME") || l.decision === "OVERTIME")),
  }), [sorted, frozen, hasItems]);
  // 목록 필터: 전체(기본) / 회사 부담 — 세션 동안 기억 (처음 열 때는 항상 전체)
  const [filter, setFilter] = useState<LinesFilter>("all");
  useEffect(() => { try { if (sessionStorage.getItem(FILTER_KEY) === "claimed") setFilter("claimed"); } catch {} }, []);
  const pickFilter = (f: LinesFilter) => { setFilter(f); try { sessionStorage.setItem(FILTER_KEY, f); } catch {} };
  // 칩은 걸러지는 게 있을 때만 (전체와 같거나 비어 있으면 숨김). 고른 칩이 사라지면 전체로
  const claimedChip = claimedAll.length > 0 && claimedAll.length < sorted.length;
  const canFilter = claimedChip;
  const active: LinesFilter = filter === "claimed" && claimedChip ? "claimed" : "all";
  const view = active === "claimed" ? claimedAll : sorted;
  const notice = memberListNotice({ confirmed, closingStatus, monthLocked, noItems: items.length === 0, toCheck: toCheck.length, undecided, pending: pmPending });

  // 사유 blur 직후 선택을 바꾸는 등 요청이 겹치면 마지막 응답만 반영 (useLinePatch)
  // 줄 컴포넌트(memo)에 그대로 넘기므로 렌더 사이에 같은 함수(useCallback)
  const patch = useCallback(async (id: string, json: Record<string, unknown>): Promise<boolean> => {
    const ok = !!(await patchLine(id, json));
    // 사유 자동 저장은 줄만 바뀌므로 화면 전체를 다시 읽지 않는다 (입력 중 깜빡임 방지)
    if (ok && !("memberNote" in json && Object.keys(json).length === 1)) router.refresh();
    return ok;
  }, [patchLine, router]);

  /**
   * 업무 사용 표시·해제 (스위치·항목 선택): 저장되면 되돌리기 토스트 (5초, 새로 누르면 바뀜).
   * 되돌리기는 바꾸기 전 표시·항목·사유를 같은 PATCH 경로로 다시 보내 목록도 같이 돌아온다.
   */
  const claim = useCallback(async (l: PassLineRow, json: ClaimPatch): Promise<boolean> => {
    const prev = claimSnapshot(l);
    const ok = await patch(l.id, json);
    if (ok) {
      toast(claimToggleText(lineTitle(l), json.memberClaim), {
        label: "되돌리기",
        onClick: () => void patch(l.id, claimRestorePatch(prev)).then((done) => done && toast(`'${lineTitle(l)}' 되돌렸어요`)),
      }, { duration: 5000 });
    }
    return ok;
  }, [patch]);

  const deduct = e.expected;
  // 아직 정해지지 않은 건이 있으면 '예정' — 요약 카드와 하단 바가 같은 숫자에 같은 이름
  const deductLabel = `본인 부담${e.likely ? " 예정" : ""}`;
  const companyPct = e.total > 0 ? Math.round((company / e.total) * 100) : 0;

  const row = (editable: boolean) => (l: PassLineRow) => (
    <PassRow key={l.id} line={l} editable={editable} items={items} disabled={busy.has(l.id)} onPatch={patch} onClaim={claim} part={split.get(l.id)} />
  );

  return (
    <div className="space-y-6">
      {/* 요약 (테두리 없이): 공제 예정 · 신청 두 숫자 + 비율 막대 + 구분별 사용 한 줄 */}
      <section aria-label="이번 달 요약">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-fg-muted">{deductLabel}</div>
            <div className="tabular mt-0.5 text-kpi font-bold text-rose-700 dark:text-rose-400">{won(deduct)}<span className="ml-0.5 text-sm font-semibold">원</span></div>
          </div>
          <div className="text-right">
            <div className="text-xs font-medium text-fg-muted">회사 부담{pendingClaim ? " (PM 확인 중 포함)" : ""}</div>
            <div className="tabular mt-0.5 text-kpi font-bold text-status-approved">{won(company)}<span className="ml-0.5 text-sm font-semibold">원</span></div>
          </div>
        </div>
        {e.total > 0 && (
          <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`본인 부담 ${100 - companyPct}%, 회사 부담 ${companyPct}%`}>
            {/* 왼쪽 공제(분홍) · 오른쪽 회사 부담(초록) — 위 숫자 배치와 같은 순서 */}
            {companyPct < 100 && <div className="h-full rounded-full bg-rose-400 dark:bg-rose-500" style={{ width: `${100 - companyPct}%` }} />}
            {companyPct > 0 && <div className="h-full flex-1 rounded-full bg-status-approved" />}
          </div>
        )}
        <div className="tabular mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-fg-muted">
          <span>사용 <b className="font-semibold text-fg">{won(e.total)}원</b> · {lines.length}건</span>
          {groups.map((g) => (
            <span key={g.place} title={`회사 부담 ${won(g.company)}원 · 본인 부담 ${won(g.deduct)}원`}>
              <span aria-hidden>{PLACE_ICON[g.place] ?? "🧾"}</span> {g.place} <b className="font-semibold text-fg">{won(g.total)}</b>
            </span>
          ))}
        </div>
      </section>

      {mapped.length > 0 && (
        <section aria-label="다른 사람 사용분" className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <p className="font-semibold">다른 사람 사용분 {mapped.reduce((a, g) => a + g.count, 0)}건 · {won(mapped.reduce((a, g) => a + g.amount, 0))}원이 내 내역에 포함돼 있어요</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {mapped.map((g) => (
              <li key={g.name} className="tabular">{g.external ? "외부인 " : ""}<b>{g.name}</b> {g.count}건 {won(g.amount)}원</li>
            ))}
          </ul>
          <p className="mt-1 text-xs opacity-80">PM이 내 사용분으로 지정한 건이에요. 잘못 연결됐으면 PM에게 알려 주세요.</p>
        </section>
      )}

      {err && <p className="alert alert-danger" role="alert">{err}</p>}

      {sorted.length > 0 && (
        <section aria-label={memberListTitle({ confirmed })}>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="section-title">{memberListTitle({ confirmed })} <span className="tabular text-fg-muted">{sorted.length}</span></h3>
            {pmPending > 0 && <span className="tabular text-xs font-medium text-amber-700">PM 확인 중 {pmPending}건</span>}
          </div>
          {/* 본인 부담은 기본값이라 줄마다 쓰지 않는다 — "표시 없음 = 본인 부담" 규칙은 상태별 안내(memberListNotice) 한 문장에만 (범례 줄을 따로 두면 같은 말이 두 번) */}
          <p className="mb-2 text-sm text-fg-muted">{notice}</p>
          {canFilter && (
            <div role="radiogroup" aria-label="내역 거르기" className="mb-3 flex flex-wrap gap-2">
              <button type="button" role="radio" aria-checked={active === "all"} className={`${chip(active === "all")} gap-1`} onClick={() => pickFilter("all")}>전체 <span className="tabular">{sorted.length}</span></button>
              {claimedChip && <button type="button" role="radio" aria-checked={active === "claimed"} className={`${chip(active === "claimed")} gap-1`} onClick={() => pickFilter("claimed")}>회사 부담 <span className="tabular">{claimedAll.length}</span></button>}
            </div>
          )}
          {/* 한 목록: PM이 정한 줄도 날짜 자리에 그대로 (스위치 대신 결과) */}
          <DayList lines={view} over={over} renderLine={(l) => row(editableOf(l))(l)} />
        </section>
      )}

      {!frozen && hasItems && undecided > 0 && (
        <div data-bottom-bar className="sticky bottom-[4.5rem] z-10 lg:bottom-4">
          <div className="tabular flex items-center justify-between gap-3 rounded-full border border-line bg-surface/95 px-4 py-2.5 text-sm shadow-pop backdrop-blur">
            <span className="text-fg-muted">{deductLabel} <b className="text-rose-700 dark:text-rose-400">{won(deduct)}원</b></span>
            {/* 사용자 관점은 '회사 부담'(PM이 정한 건 + 내가 표시해 PM 확인 중인 건) — 확인 중인 건수는 작게 */}
            <span className="text-fg-muted">회사 부담 <b className="text-status-approved">{claimedAll.length}건 {won(company)}원</b>{claimedNow.length > 0 && <span className="ml-1 text-xs text-amber-700">(PM 확인 중 {claimedNow.length}건)</span>}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 이전 방식(팀원 직접 입력)의 출입증 사용 목록 — 조회 전용 */
export function PassList({ rows, showUser }: { rows: PassUsageRow[]; showUser?: boolean }) {
  if (rows.length === 0) return <p className="border-t border-line px-5 py-10 text-center text-sm text-fg-subtle">출입증 사용 내역이 없어요.</p>;
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <RowList className="border-t border-line">
      {sorted.map((r) => (
        <ListRow key={r.id} lead={PLACE_ICON[r.placeType] ?? "🧾"} amount={r.amount}
          title={`${r.itemName} · ${r.placeType}${r.place ? ` (${r.place})` : ""}`}
          meta={<MetaLine parts={[shortDate(r.date), showUser ? r.userName : null, r.headcount && r.headcount > 1 ? <Headcount n={r.headcount} /> : null, r.memo]} />} />
      ))}
    </RowList>
  );
}
