"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { dayLabel, shortDate, won } from "@/lib/format";
import type { PassLineRow, PassStatementInfo } from "@/lib/dto";
import {
  applyClear, choiceOf, choiceToDecision, clearableLines, companyChoice, companySplit, dayLimitMessage, dayLimitOver, externalGroups, filterLines, filterPeople, holderMapKey, isCompanyChoice, passClosingNotice, passLineText, passLockedProblem, pinClaims, summarizeStatement,
  type PassItem,
} from "@/lib/pass-statement";
import type { ClosingStatus } from "@/lib/types";
import { byPositionThenName } from "@/lib/org";
import { leftLabel } from "@/lib/membership";
import { Stat, StickyAction } from "./common";
import { ListRow } from "./list/ListRow";
import { DayGroup } from "./list/DayGroup";
import { chip, limitBadge } from "./ui";
import { useLinePatch } from "./pass/useLinePatch";
import { Icon } from "./icons";
import { useConfirm } from "./ConfirmDialog";
import { RowMenu } from "./pass/RowMenu";
import { Caret, Menu } from "./Menu";
import { toast } from "./Nav";
import { cardDayKey } from "@/lib/pass-budget";

/** 회사 부담 항목의 연결 예산 항목 (예산은 하나, 쓰는 방법은 둘) — 잔액은 카드 + 출입증 확정분 기준 */
export type PassBudgetLink = { itemId: string; name: string; remaining: number | null };

/** leftAt: 이전 팀원의 철수일 (YYYY-MM-DD) — 이 달 출입증 내역 기간에 근무했던 사람만 들어온다 */
type Member = { userId: string; name: string; position?: string | null; leftAt?: string | null };
type Props = {
  /** 잘못 올린 내역 삭제 (이 프로젝트 PM만, 확정 전) */
  canDelete?: boolean;
  /** 확정 취소 (PM·재무 승인 — 재무 승인 담당은 처리는 못 해도 확정을 되돌릴 수 있다) */
  canReopen?: boolean;
  /** 진행 단계 카드 안의 '추가·다시 올리기' (PassUpload) */
  upload?: React.ReactNode;
  statement: PassStatementInfo;
  lines: PassLineRow[];
  members: Member[];
  /** 회사 부담으로 고를 수 있는 항목 (예: 야근식대) */
  items: PassItem[];
  /** 결정·팀원 지정·확정 (PM·재무 승인·시스템 관리자, 조회 전용 제외) */
  canEdit: boolean;
  /** 외부인 사용 → 내 사용분 (이 프로젝트 PM) */
  canAssume: boolean;
  /** 회사 부담 항목 id → 연결 예산 항목 (없으면 예산과 무관) */
  links?: Record<string, PassBudgetLink>;
  /** 카드 지출이 있는 날: "결제자|YYYY-MM-DD|예산 항목" (lib/pass-budget cardDayKey) — 같은 날 같은 예산 카드 지출이면 중복 의심 */
  cardDays?: string[];
  /** 이 달 마감 상태 — 상신(SUBMITTED)·승인이면 결정·확정·확정 취소·올리기·삭제 모두 잠김, 반려면 다시 확정 → 마감 › 상신 안내 (마감은 수정 가능) */
  closingStatus?: ClosingStatus;
};

/** 잠긴 달의 하단 바 짧은 문구 */
const LOCK_SHORT: Partial<Record<ClosingStatus, string>> = { SUBMITTED: "상신된 달 — 출입증 정산을 바꿀 수 없어요", APPROVED: "승인된 달 — 출입증 정산을 바꿀 수 없어요" };

/** 줄·회사 부담 항목 → 같은 사람·같은 날 연결 예산 항목 카드 지출이 있으면 그 예산 항목 */
type DupOf = (l: PassLineRow, itemId: string | null) => PassBudgetLink | null;
/** 일괄 처리 응답 — changedIds: 실제로 바뀐 줄 (되돌리기 대상) */
type BulkResult = { changed: number; changedIds?: string[] };
const remainText = (b: PassBudgetLink) => (b.remaining === null ? `${b.name} 예산 없음` : `${b.name} 잔액 ${won(b.remaining)}원`);
/** links 기본값 — 렌더마다 새 객체({})를 만들지 않도록 하나를 공유 (줄 컴포넌트 memo 비교용) */
const NO_LINKS: Record<string, PassBudgetLink> = {};

const placeIcon = (s: string | null) => (s && /카페|커피|cafe/i.test(s) ? "☕" : s && /식당|식사|구내/.test(s) ? "🍚" : "🧾");
/** 키 "사원카드번호:00123" → "사원카드번호 00123" */
const keyText = (k: string) => k.replace(":", " ");


type PlaceStat = { place: string; count: number; amount: number };
/** 사용처별 건수·금액 */
function placeStats(lines: PassLineRow[]): Map<string, PlaceStat> {
  const map = new Map<string, PlaceStat>();
  for (const l of lines) {
    const place = l.placeType ?? l.sheetName ?? "기타";
    const p = map.get(place) ?? { place, count: 0, amount: 0 };
    p.count++;
    p.amount += l.amount;
    map.set(place, p);
  }
  return map;
}

/** 작은 표시 — 한 가지 모양, 색만 의미별로 */
const TAG_TONE = {
  info: "bg-sky-50 text-sky-800",
  warn: "bg-amber-50 text-amber-800",
  muted: "bg-surface-muted text-fg-muted",
} as const;
function Tag({ tone, children }: { tone: keyof typeof TAG_TONE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${TAG_TONE[tone]}`}>{children}</span>;
}

/** 표의 금액 칸: 금액 + 건수 (없으면 —) */
function AmountCell({ amount, count, tone }: { amount: number; count?: number; tone?: "ok" | "danger" }) {
  if (!amount) return <span className="text-right text-sm text-fg-subtle">—</span>;
  const color = tone === "ok" ? "text-status-approved" : tone === "danger" ? "text-status-rejected" : "text-fg";
  return (
    <span className="text-right leading-tight">
      <span className={`tabular block text-sm font-semibold ${color}`}>{won(amount)}</span>
      {count !== undefined && <span className="tabular block text-xs text-fg-subtle">{count}건</span>}
    </span>
  );
}


/** 저녁(18시 이후) 식당 사용 — 야근식대 후보 표시 (팀원 화면과 같은 규칙) */
const isDinner = (place: string | null, time: string) => !!place && /식당|식사|구내/.test(place) && !!time && time.padStart(5, "0") >= "18:00";
/** 항목 이름에서 출입증 표기 빼기 (팀원 화면과 같은 규칙) */
const shortName = (name: string) => name.replace(/\(.*?\)/g, "").replace(/출입증\s*/g, "").trim() || name;

/**
 * PM 펼친 목록의 한 줄 — 팀원 화면(PassForm)과 같은 ListRow 2줄.
 * 기본(본인 부담·미정)은 쓰지 않고, 오른쪽 원형 체크 = 회사 부담 / 해제 = 미결정(= 확정 때 본인 부담). 해제는 글자를 남기지 않는다.
 * 항목이 여럿이면 체크할 때 항목 고르기를 펼친다 (팀원이 고른 항목이 있으면 그 항목으로 바로).
 * memo: 팀원 접기·펼치기, 다른 줄의 진행 중 표시 때 바뀌지 않은 줄은 다시 그리지 않는다
 * (그래서 Map 전체 대신 이 줄의 값(lim·part)만 받고, 콜백은 줄을 인자로 받는 안정적인 함수여야 한다)
 */
const PmLineRow = memo(function PmLineRow({ l, groupName, items, lim, part, editable, canAssume, busy, onPatch, links = NO_LINKS, dupOf }: {
  l: PassLineRow; groupName: string; items: PassItem[];
  /** 이 줄이 든 날의 하루 한도 초과 (dayLimitOver) */
  lim: ReturnType<typeof dayLimitOver> extends Map<string, infer V> ? V | undefined : never;
  /** 이 줄의 하루 한도 배분 (companySplit) */
  part: ReturnType<typeof companySplit> extends Map<string, infer V> ? V | undefined : never;
  editable: boolean; canAssume: boolean; busy: boolean; onPatch: (l: PassLineRow, json: Record<string, unknown>) => void;
  links?: Record<string, PassBudgetLink>; dupOf: DupOf;
}) {
  const [picking, setPicking] = useState(false);
  const send = (json: Record<string, unknown>) => onPatch(l, json);
  const v = lineView(l);
  const place = l.placeType ?? l.sheetName ?? null;
  const otherName = l.holderName.replace(/\s/g, "") !== groupName.replace(/\s/g, "") && !l.onBehalfName;
  const value = choiceOf(l);
  const company = isCompanyChoice(value);
  const missing = company && !items.some((i) => companyChoice(i.id) === value);
  const itemLabel = shortName(l.usageItemName ?? "항목 미지정") + (missing ? " (설정에서 빠진 항목)" : "");
  const pendingClaim = !l.decision && l.memberClaim === "OVERTIME";
  const canCheck = editable && !l.onBehalfName && items.length > 0;
  const date = l.date ? dayLabel(l.date) : "";
  // 회사 부담(결정·요청) 항목의 연결 예산에 같은 날 카드 지출이 있으면 경고
  const dup = (company || pendingClaim) ? dupOf(l, l.usageItemId) : null;

  function toggle() {
    // 해제 = 결정 지우기(미결정). 본인 부담(DEDUCT)으로 쓰지 않는다 — 빈 값이 곧 본인 부담이라 줄에 글자가 남을 이유가 없다
    if (company) { setPicking(false); send({ decision: null }); return; }
    // 팀원이 고른 항목 → 항목이 하나뿐이면 그 항목 → 여럿이면 고르기
    const claimed = l.memberClaim === "OVERTIME" && l.usageItemId && items.some((i) => i.id === l.usageItemId) ? l.usageItemId : null;
    const only = items.length === 1 ? items[0].id : null;
    const id = claimed ?? only;
    if (id) send(choiceToDecision(companyChoice(id)));
    else setPicking((p) => !p);
  }

  // 오른쪽 금액 아래 결과 — 본인 부담은 기본값이라 줄마다 쓰지 않는다 (PM이 정한 줄·확정 후 채운 줄·미결정 줄 모두 빈 채로, 조회 전용·확정 후에도).
  // 글자로 남기는 것: 회사 부담(초록), 팀원이 업무 사용을 요청했는데 본인 부담으로 정해진 예외(붉게) 둘뿐.
  // 하루 한도 배분으로 일부만 회사 부담인 줄: "회사 부담 3,000 · 초과 5,000" (초과분이 본인 부담이라는 설명은 날짜 소제목의 한도 배지가 한다)
  // 되돌리기는 ✓를 다시 누르는 것 하나 — 따로 '취소' 글자 버튼을 두지 않는다 ('회사 부담 취소'로 읽혀 헷갈림)
  const result = l.decision === "OVERTIME" && part && part.personal > 0
    ? <div className="ml-auto flex items-center justify-end gap-1"><div className="tabular text-right text-xs font-medium" title={`1일 한도 ${won(part.limit)}원 배분 · ${itemLabel} · 초과분은 본인 부담`}><span className="text-status-approved">회사 부담 {won(part.company)}</span> · <span className="text-status-rejected">초과 {won(part.personal)}</span></div></div>
    : l.decision === "OVERTIME" ? <div className="ml-auto flex items-center justify-end gap-1"><div className="max-w-32 truncate text-xs font-medium text-status-approved" title={`회사 부담 · ${itemLabel}`}>{items.length > 1 && !missing ? `회사 부담 · ${shortName(l.usageItemName ?? "")}` : "회사 부담"}</div></div>
    : l.decision === "DEDUCT" && l.memberClaim === "OVERTIME" ? <div className="text-xs font-medium text-status-rejected">요청 → 본인 부담</div>
    : null;

  const tags = [
    otherName && <span key="o" title={`업체 내역 이름은 '${l.holderName}', ${groupName}님 사용분으로 지정된 건`}><Tag tone="muted">업체 내역 이름 {l.holderName}</Tag></span>,
    l.onBehalfName && <Tag key="e" tone="warn">외부인 {l.onBehalfName} 대납</Tag>,
    l.memberNote && <Tag key="n" tone="muted">사유 · {l.memberNote}</Tag>,
    dup && <span key="d" title="출입증 회사 부담과 카드 지출이 겹치지 않는지 확인하세요."><Tag tone="warn">⚠ 같은 날 카드 {dup.name} 지출 있음 · 중복 의심</Tag></span>,
    l.decisionSource === "SOLIDAY" && <Tag key="s" tone="info">Soliday 자동</Tag>,
    v.more && <Tag key="m" tone="muted"><span className="max-w-56 truncate" title={v.more}>{v.more}</span></Tag>,
  ].filter(Boolean);

  return (
    <ListRow accent={lim ? "warn" : pendingClaim ? "info" : l.decision === "OVERTIME" ? "ok" : undefined}
      lead={placeIcon(place)} title={v.title} amount={l.amount}
      metaWrap
      meta={<>
        {/* 2줄째는 품목(또는 구분)만 — 시각은 툴팁·저녁 배지로 (줄에 "15:12 ·"를 붙이지 않는다) */}
        <span className="min-w-0 truncate" title={v.time ? `${date} ${v.time}` : undefined}>{v.sub ?? place}</span>
        {isDinner(place, v.time) && <span className="shrink-0 rounded bg-amber-100 px-1 text-xs font-semibold text-amber-800">저녁</span>}
        {l.memberClaim === "OVERTIME" && (
          <span className="min-w-0 truncate font-medium text-sky-800" title="팀원이 업무 사용을 표시한 건">팀원 요청 · {shortName(l.usageItemName ?? "회사 부담")}</span>
        )}
      </>}
      sub={(tags.length > 0 || (editable && canAssume && l.onBehalfName)) ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {tags}
          {editable && canAssume && l.onBehalfName && (
            <button type="button" className="min-h-8 px-1 text-xs text-fg-muted underline" disabled={busy} onClick={() => send({ external: false })}>외부인 처리 취소</button>
          )}
        </div>
      ) : undefined}
      valueSub={result}
      trail={canCheck ? (
        <button type="button" role="switch" aria-checked={company} disabled={busy} onClick={toggle} id={`pass-line-${l.id}`}
          aria-label={`${date} ${v.time} ${v.title ?? ""} ${won(l.amount)}원 회사 부담${company ? " — 다시 누르면 미결정" : ""}`}
          title={company ? "회사 부담 — 다시 누르면 미결정" : "누르면 회사 부담"}
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full disabled:cursor-wait disabled:opacity-50">
          <span className={`flex size-6 items-center justify-center rounded-full text-sm font-bold transition-colors ${company ? "bg-emerald-600 text-on-primary" : picking ? "ring-2 ring-emerald-500" : pendingClaim ? "ring-2 ring-sky-500" : "ring-1 ring-line-strong"}`}>
            {company ? "✓" : ""}
          </span>
        </button>
      ) : undefined}>
      {canCheck && (picking || missing) && (
        <div className="px-4 pb-3 pl-16">
          <select className="input min-h-10 py-1.5 text-base sm:max-w-xs sm:text-sm" value={company ? value : ""} disabled={busy} aria-label={`${date} ${won(l.amount)}원 회사 부담 항목`}
            onChange={(e) => { if (e.target.value) { send(choiceToDecision(e.target.value)); setPicking(false); } }}>
            {!company && <option value="" disabled>회사 부담 항목을 고르세요</option>}
            {items.map((i) => {
              const b = links[i.id];
              const d = dupOf(l, i.id);
              return <option key={i.id} value={companyChoice(i.id)}>{shortName(i.name)}{i.perPersonLimit ? ` (1일 ${won(i.perPersonLimit)}원)` : ""}{b ? ` · ${remainText(b)}` : ""}{d ? " · ⚠ 같은 날 카드 지출" : ""}</option>;
            })}
            {missing && <option value={value}>{l.usageItemName ?? "항목 미지정"} (설정에서 빠진 항목)</option>}
          </select>
          {items.some((i) => links[i.id]) && (
            <p className="tabular mt-1 text-xs text-fg-muted">{items.filter((i) => links[i.id]).map((i) => remainText(links[i.id])).filter((t, k, a) => a.indexOf(t) === k).join(" · ")}</p>
          )}
        </div>
      )}
    </ListRow>
  );
});

/**
 * 줄 내용 — 표시 열 순서(PM 설정 > 출입증 표시 열): 첫 항목이 제목, 둘째가 보조(없으면 구분, 수량 2 이상이면 '× 2'), 나머지는 태그로.
 * 팀원 내 지출 내역(출입증 탭)과 같은 함수(passLineText)라 두 화면의 문구가 같다. 코드 값(CATE012 등)은 안 보인다.
 * 금액·수량·구간 같은 열은 서버(visibleExtra)에서 이미 빠져 있다 — 줄 금액이 오른쪽에 따로 보이므로
 */
const lineView = (l: PassLineRow) => passLineText(l);

/** 진행 단계 이름 — 2단계는 연결 안 된 이름에 팀원을 지정하는 일(PM) */
const STEPS = ["올리기", "팀원 지정", "회사 부담 결정", "확정"] as const;

/** 출입증 한 달 진행 단계 (올리기 → 팀원 지정 → 회사 부담 결정 → 확정). step = 지금 단계(0부터), 4면 모두 끝 */
export function PassSteps({ step }: { step: number }) {
  return (
    <ol className="flex border-b border-line">
      {STEPS.map((label, i) => {
        const done = i < step;
        const now = i === step;
        return (
          <li key={label} aria-current={now ? "step" : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-center ${now ? "bg-brand-50" : ""}`}>
            <span className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-primary text-on-primary" : now ? "border-2 border-primary text-primary" : "border border-line-strong text-fg-subtle"}`}>
              {done ? "✓" : i + 1}
            </span>
            <span className={`truncate text-xs sm:text-sm ${now ? "font-semibold text-fg" : done ? "text-fg-2" : "text-fg-muted"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DownloadIcon() {
  return (
    <Icon name="download" />
  );
}

/** 출입증 월 내역 — PM 확인·결정·확정 (팀원별로 접어서 보기) */
export function PassStatementBoard({ statement, lines: initial, members, items, canEdit, canAssume, canDelete = false, canReopen = false, upload, links = NO_LINKS, cardDays, closingStatus }: Props) {
  const router = useRouter();
  const { confirm, askReason, dialog } = useConfirm();
  const [lines, setLines] = useState(initial);
  // 서버에서 새 줄 목록(router.refresh)이 오면 렌더 중에 바로 바꿔 끼운다 — useEffect로 하면 옛 줄로 한 번 그린 뒤 다시 그린다 (커밋 2번)
  const [syncedInitial, setSyncedInitial] = useState(initial);
  if (initial !== syncedInitial) { setSyncedInitial(initial); setLines(initial); }
  // 진행 중 표시: 줄 수정은 줄 id별(useLinePatch), 일괄·확정 등은 동작 이름별
  const { patch: patchLine, busy: lineBusy, err: lineErr, setErr: setLineErr } = useLinePatch(setLines);
  const [actionBusy, setActionBusy] = useState<Set<string>>(new Set());
  const [actionErr, setActionErr] = useState<string | null>(null);
  const err = actionErr ?? lineErr;
  const anyBusy = actionBusy.size > 0 || lineBusy.size > 0;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // '요청 확인할 팀원·건만': 켤 때 요청이 있던 팀원(people)과 요청 건(lines) 집합 (null = 전체).
  // 요청을 정해도 그 팀원·그 줄은 결과를 보여 주며 남고, 켠 뒤 새로 들어온 요청도 보인다 (lib filterPeople·filterLines). 껐다 켜면 그때 기준으로 다시 고정
  const [pin, setPin] = useState<{ people: Set<string>; lines: Set<string> } | null>(null);
  // 펼친 팀원 안의 줄 거르기 — 전체 / 회사 부담(요청 중 + 회사 부담으로 정함). 팀원 화면(PassForm)과 같은 두 칩. 팀원마다 따로 기억
  const [companyOnly, setCompanyOnly] = useState<Set<string>>(new Set());
  const setCompanyFilter = (userId: string, on: boolean) => setCompanyOnly((prev) => { const n = new Set(prev); if (on) n.add(userId); else n.delete(userId); return n; });
  const open = statement.status === "OPEN";
  // 월 마감 잠금 (지출과 같은 기준): 마감·상신·승인된 달은 결정·확정·확정 취소·올리기·삭제 모두 불가 (외부인 수금 기록만 가능)
  const locked = !!passLockedProblem(closingStatus);
  const notice = passClosingNotice(closingStatus, statement.status);
  const editable = canEdit && open && !locked;
  const s = useMemo(() => summarizeStatement(lines, items), [lines, items]);
  // 팀원별 내역 섹션: 확정 전에는 기본 접힘, 단 PM이 확인할 팀원 요청이 남아 있으면 처음부터 펼친다 (요청 확인이 지금 할 일).
  // 확정 후에는 정한 결과를 보는 것이 이 화면의 쓰임이라 처음부터 펼친다 (조회 전용 — 접기·펼치기는 그대로)
  const [peopleOpen, setPeopleOpen] = useState(() => !open || (canEdit && !locked && s.pendingClaims > 0));
  // 줄마다 하루 한도 배분 (회사 부담분·본인 부담분) — 집계와 같은 함수
  const split = useMemo(() => companySplit(lines, items), [lines, items]);
  const ext = useMemo(() => externalGroups(lines), [lines]);
  const over = useMemo(() => dayLimitOver(lines, items), [lines, items]);
  const cardSet = useMemo(() => new Set(cardDays ?? []), [cardDays]);
  const dupOf: DupOf = useCallback((l, itemId) => {
    const b = itemId ? links[itemId] : undefined;
    return b && l.userId && l.date && !l.onBehalfName && cardSet.has(cardDayKey(l.userId, l.date, b.itemId)) ? b : null;
  }, [links, cardSet]);
  // 연결 예산 잔액 (항목 고르는 곳 위에 한 줄로)
  const linkTexts = useMemo(() => [...new Set(items.filter((i) => links[i.id]).map((i) => `${shortName(i.name)} → ${remainText(links[i.id])}`))], [items, links]);
  // 사용처(시트) 순서와 전체 사용처별 합계
  // 구분 열 순서: 구분 이름 순 (달마다·올린 순서에 따라 바뀌지 않게)
  const placeOrder = useMemo(() => [...new Set(lines.map((l) => l.placeType ?? l.sheetName ?? "기타"))].sort((a, b) => a.localeCompare(b, "ko")), [lines]);
  const allPlaces = useMemo(() => { const m = placeStats(lines); return placeOrder.map((pl) => m.get(pl)!); }, [lines, placeOrder]);
  // 팀원별 표의 열: 팀원 | 사용처(시트)별 | 회사 부담 | 본인 부담 | 합계
  // 팀원 열은 이름·배지가 잘리지 않게 최소 너비를 두고, 사용처가 많아 넘치면 표가 가로로 스크롤된다 (sm:overflow-x-auto)
  const colsVar = { "--cols": `minmax(11rem,1fr) repeat(${placeOrder.length + 3}, 6.25rem)` } as React.CSSProperties;

  // 연결 안 된 이름 (카드번호·이름별)
  const unmatched = useMemo(() => {
    const map = new Map<string, { key: string; name: string; keys: string[]; ids: string[]; amount: number }>();
    for (const l of lines.filter((x) => !x.userId)) {
      const k = holderMapKey(l);
      const g = map.get(k) ?? { key: k, name: l.holderName, keys: l.keys, ids: [], amount: 0 };
      g.ids.push(l.id);
      g.amount += l.amount;
      map.set(k, g);
    }
    return [...map.values()];
  }, [lines]);

  // 팀원별 묶음 (미확인 제외) — 직급, 성명 순
  const positionOf = useMemo(() => new Map(members.map((m) => [m.userId, m.position ?? null])), [members]);
  // 팀원별 묶음과 팀원별 합계(요약·요청·한도 초과·본인 부담·사용처별)를 한 번에 계산
  const groups = useMemo(() => {
    const map = new Map<string, { userId: string; name: string; lines: PassLineRow[] }>();
    for (const l of lines.filter((x) => x.userId)) {
      const g = map.get(l.userId!) ?? { userId: l.userId!, name: l.userName ?? l.holderName, lines: [] };
      g.lines.push(l);
      map.set(l.userId!, g);
    }
    const personOf = new Map(s.people.map((x) => [x.userId, x]));
    return [...map.values()]
      .sort((a, b) => byPositionThenName({ position: positionOf.get(a.userId) ?? null, name: a.name }, { position: positionOf.get(b.userId) ?? null, name: b.name }))
      .map((g) => {
        g.lines.sort((a, b) => `${a.date ?? ""}${a.time ?? ""}`.localeCompare(`${b.date ?? ""}${b.time ?? ""}`));
        const p = personOf.get(g.userId);
        const rest = g.lines.filter((l) => !l.decision && l.memberClaim !== "OVERTIME");
        return {
          ...g,
          p,
          claims: g.lines.filter((l) => !l.decision && l.memberClaim === "OVERTIME").length,
          overCount: g.lines.filter((l) => over.has(l.id)).length,
          rest,
          // '정한 것 모두 지우기' 대상 — 사람이 정한 결정 (외부인 대납·Soliday 자동 제외)
          clearable: clearableLines(g.lines).length,
          deductAmount: (p?.deduct.amount ?? 0) + rest.reduce((a, l) => a + l.amount, 0),
          deductCount: (p?.deduct.count ?? 0) + rest.length,
          places: placeStats(g.lines),
        };
      });
  }, [lines, positionOf, s, over]);
  const shown = useMemo(() => filterPeople(groups, pin?.people ?? null), [groups, pin]);
  const pendingGroups = useMemo(() => groups.filter((g) => g.claims > 0), [groups]);
  /** 필터 켜기 — 지금 요청이 있는 팀원·요청 건을 고정 */
  const pinNow = () => setPin({ people: new Set(pendingGroups.map((g) => g.userId)), lines: pinClaims(lines) });
  /** 한 팀원의 보이는 줄 — 필터가 켜져 있으면 고정한 요청 건 + 새 요청 건만 (머리글 합계·정한 것 모두 지우기는 전체 줄 기준) */
  // 켠 뒤 새로 들어온 요청 건도 고정 집합에 넣는다 — 정한 뒤에도 결과를 보여 주며 남게 (처음 고정한 건과 같은 규칙)
  useEffect(() => {
    if (!pin) return;
    const fresh = [...pinClaims(lines)].filter((id) => !pin.lines.has(id));
    if (fresh.length) setPin({ people: pin.people, lines: new Set([...pin.lines, ...fresh]) });
  }, [lines, pin]);
  // 팀원별 보이는 줄 — 줄 목록·필터가 바뀔 때만 다시 거른다 (접기·펼치기, 진행 중 표시 때는 그대로)
  const visibleByUser = useMemo(() => new Map(groups.map((g) => [g.userId, filterLines(g.lines, pin?.lines ?? null)])), [groups, pin]);
  const visibleLines = (g: { userId: string; lines: PassLineRow[] }) => visibleByUser.get(g.userId) ?? g.lines;

  /** 일괄·확정 등 — 성공하면 true (확인 창에서 취소해도 false) */
  async function run(key: string, fn: () => Promise<unknown>, confirmText?: string): Promise<boolean> {
    if (confirmText && !(await confirm({ message: confirmText }))) return false;
    setActionBusy((b) => new Set(b).add(key));
    setActionErr(null);
    setLineErr(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setActionErr((e as Error).message);
      return false;
    } finally {
      setActionBusy((b) => { const n = new Set(b); n.delete(key); return n; });
    }
  }
  /** 줄 하나 수정 — 응답으로 받은 줄을 바로 화면에 반영 */
  const patch = useCallback(async (id: string, json: Record<string, unknown>): Promise<boolean> => {
    setActionErr(null);
    const r = await patchLine<{ line: PassLineRow; alsoMapped: number; autoDecided: number }>(id, json);
    if (r && (r.alsoMapped || r.autoDecided || json.userId !== undefined || json.external !== undefined)) router.refresh();
    return !!r;
  }, [patchLine, router]);
  /**
   * 일괄 처리(외부인 처리·결정 지우기·수금) — 결정 지우기는 응답 즉시 줄 목록에도 반영해 새로고침 전에도 합계·줄 표시가 같은 줄 목록에서 나오게 한다.
   * 결정 자체는 줄의 ✓(회사 부담) 하나로만 한다 — 팀원별 일괄 결정(요청대로·나머지 일괄)은 두지 않는다 (2026-10-15).
   * 성공하면 응답({ changed, changedIds }), 실패·확인 창에서 취소면 null
   */
  const bulk = async (action: string, extra: Record<string, unknown> = {}, confirmText?: string): Promise<BulkResult | null> => {
    const out: { res: BulkResult | null } = { res: null };
    const ok = await run(action, async () => {
      out.res = await api<BulkResult>(`/api/pass-statements/${statement.id}/bulk`, { method: "POST", json: { action, ...extra } });
      const ids = Array.isArray(extra.lineIds) ? (extra.lineIds as string[]) : null;
      if (action === "clear" && ids) setLines((prev) => applyClear(prev, ids));
    }, confirmText);
    return ok ? out.res : null;
  };
  /** 결정 지우기(되돌리기) — 바뀐 줄을 미결정으로. '정한 것 모두 지우기'가 쓴다 */
  const clearDecisions = async (lineIds: string[], confirmText?: string) => {
    const r = await bulk("clear", { lineIds }, confirmText);
    if (r) toast(r.changed ? `${r.changed}건을 미결정으로 되돌렸어요` : "되돌릴 결정이 없어요 (이미 바뀌었어요)");
  };

  /** 줄 수정 (줄 컴포넌트용) — ✓로 회사 부담을 정하면 '되돌리기' 토스트(= 그 줄을 미결정으로), 되돌리면 짧은 알림 */
  const onLinePatch = useCallback((l: PassLineRow, json: Record<string, unknown>) => {
    void patch(l.id, json).then((ok) => {
      if (!ok || json.decision === undefined) return;
      if (json.decision === "OVERTIME") {
        toast("회사 부담으로 정했어요", { label: "되돌리기", onClick: () => void patch(l.id, { decision: null }).then((done) => done && toast("미결정으로 되돌렸어요")) });
      } else if (json.decision === null) {
        toast("미결정으로 되돌렸어요");
      }
    });
  }, [patch]);

  /** 한 팀원의 정한 것 모두 지우기 — 사람이 정한 결정(외부인 대납·Soliday 자동 제외)을 미결정으로 */
  const clearPerson = (g: { name: string; lines: PassLineRow[] }) => {
    const ids = clearableLines(g.lines).map((l) => l.id);
    if (!ids.length) return;
    return clearDecisions(ids, `${g.name}님의 결정 ${ids.length}건을 모두 지우고 미결정으로 되돌릴까요?\n팀원 요청은 그대로 남습니다.`);
  };
  const toggle = (id: string) => setOpenIds((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // 팀원 신청 대기: 저녁 시간대 식사가 있는데 회사 부담 신청을 하지 않은 팀원 (확정은 막지 않고 알린다)
  const waiting = useMemo(() => groups.filter((g) => g.lines.some((l) => !l.decision && !l.onBehalfName && isDinner(l.placeType ?? l.sheetName ?? null, (l.time ?? "").slice(0, 5)))
    && !g.lines.some((l) => l.memberClaim === "OVERTIME")).map((g) => g.name), [groups]);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  /** 월 확정 막힘 이유 — 서버(confirmProblem)와 같은 조건: 연결 안 된 이름, PM이 아직 정하지 않은 팀원 요청 */
  const confirmBlocked = unmatched.length ? `연결 안 된 이름 ${unmatched.length}개 — 팀원을 지정해야 확정할 수 있어요`
    : s.pendingClaims ? `팀원 요청 ${s.pendingClaims}건을 먼저 정해야 확정할 수 있어요` : null;
  const confirmMonth = async () => {
    if (confirmBlocked) return;
    setConfirmErr(null);
    const msg = `이 달 출입증 내역을 확정할까요?${waiting.length ? `\n저녁 사용이 있는데 업무 사용을 표시하지 않은 팀원 ${waiting.length}명(${waiting.slice(0, 5).join(", ")}${waiting.length > 5 ? " 등" : ""})의 요청을 기다리지 않고 확정합니다.` : ""}${s.defaultDeduct.count ? `\n따로 정하지 않은 ${s.defaultDeduct.count}건(${won(s.defaultDeduct.amount)}원)은 본인 부담으로 정해집니다.` : ""}\n확정 후에는 팀원 요청·처리를 바꿀 수 없습니다.`;
    if (!(await confirm({ message: msg }))) return;
    setActionBusy((b) => new Set(b).add("confirm"));
    try {
      await api(`/api/pass-statements/${statement.id}/confirm`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setConfirmErr((e as Error).message);
    } finally {
      setActionBusy((b) => { const n = new Set(b); n.delete("confirm"); return n; });
    }
  };
  const reopen = async () => {
    const reason = await askReason({ title: "확정 취소", message: "확정 취소 사유를 입력하세요.\n이미 전달한 급여 공제 대상 엑셀은 무효가 되니 다시 확정 후 새로 전달하세요.", placeholder: "취소 사유", required: true });
    if (reason && reason.trim()) void run("reopen", () => api(`/api/pass-statements/${statement.id}/reopen`, { method: "POST", json: { reason } }));
  };
  // 진행 단계: 올리기 → 팀원 지정 → 회사 부담 결정 → 확정 (지금 단계 = 처음으로 안 끝난 단계)
  const step = !open ? 4 : unmatched.length ? 1 : s.pendingClaims || over.size || waiting.length ? 2 : 3;
  // 지금 할 일 하나 + 그다음 할 일 — 조회 전용(재무 승인·시스템 관리자·종료 프로젝트)에게는 명령형 대신 PM이 할 일로 서술
  const tasks = [
    unmatched.length > 0 && { key: "unmatched", title: `연결 안 된 이름 ${unmatched.length}개 — ${editable ? "팀원을 지정하세요" : "PM이 팀원을 지정해야 해요"}`, desc: "" },
    s.pendingClaims > 0 && { key: "claims", title: `팀원 요청(업무 사용 표시) ${s.pendingClaims}건 — ${editable ? "확인하세요" : "PM 확인 대기"}`, desc: editable ? "팀원별 내역에서 요청 건의 ✓를 눌러 회사 부담으로 정하세요. 그대로 두면 확정 때 본인 부담이 돼요." : "PM이 팀원별 내역에서 요청 건을 보고 회사 부담으로 정해요." },
    over.size > 0 && { key: "over", title: `1일 한도 초과 ${over.size}건${editable ? " — 확인하세요" : ""}`, desc: "한도까지만 회사 부담이고 초과분은 본인 부담(급여 공제)이에요." },
  ].filter(Boolean) as { key: string; title: string; desc: string }[];
  const task: { key: string; title: string; desc: string; tone?: "warn" | "ok" } = !open
    // 확정된 달: 상신·승인으로 잠겨 있어도 급여 공제 엑셀 전달 안내는 그대로 (잠긴 이유는 화면 위 안내)
    ? { key: "done", title: "이 달은 확정됐어요", desc: "급여 공제 대상 엑셀을 인사·급여 담당에게 전달하세요.", tone: "ok" }
    : locked
    // 상신·승인된 달(확정 전 내역): 할 일 대신 잠긴 이유와 푸는 방법 — 잠그는 것은 상신·승인뿐 (passLockedProblem)
    ? { key: "locked", title: `이 달은 ${closingStatus === "APPROVED" ? "승인" : "상신"}되어 바꿀 수 없어요`, desc: "", tone: "ok" }
    : tasks[0] ? { ...tasks[0], tone: "warn" }
    : waiting.length ? {
      key: "waiting", title: `팀원 요청 대기 — ${waiting.length}명`,
      desc: `저녁 사용이 있는데 업무 사용을 표시하지 않은 팀원: ${waiting.slice(0, 5).join(", ")}${waiting.length > 5 ? " 등" : ""}. ${editable ? "기다리지 않고 확정해도 돼요." : "PM이 기다리지 않고 확정할 수 있어요."}`,
    }
    : { key: "confirm", title: editable ? "모두 정했어요 — 월 확정" : "모두 정했어요 — PM 월 확정 대기", desc: `${s.defaultDeduct.count ? `따로 정하지 않은 ${s.defaultDeduct.count}건(${won(s.defaultDeduct.amount)}원)은 본인 부담으로 정해져요. ` : ""}확정하면 팀원 요청·처리를 바꿀 수 없어요.` };
  const later = open && !locked ? tasks.slice(1).map((t) => t.title.split(" — ")[0]) : [];
  /** 팀원별 내역으로 이동 — 섹션을 펼치고, 팀원을 주면 그 팀원 줄까지 */
  const goPeople = (userId?: string) => {
    setPeopleOpen(true);
    setTimeout(() => document.getElementById(userId ? `person-${userId}` : "people")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  /** 지금 할 일의 '요청 건만 보기' — 요청 팀원·요청 건만 보이게 고정(pinNow)하고 모두 펼친 뒤 첫 요청 팀원으로 */
  const showClaims = () => {
    pinNow();
    setOpenIds(new Set(pendingGroups.map((g) => g.userId)));
    goPeople(pendingGroups[0]?.userId);
  };
  // 이 달에 올린 내역: 업체 · 구분별 건수
  const files = useMemo(() => {
    type FileGroup = { key: string; vendor: string | null; group: string; label: string; title: string; count: number; amount: number; decided: number; claims: number };
    const m = new Map<string, FileGroup>();
    for (const l of lines) {
      // 삭제 단위의 구분 = 서버와 같은 기준 (구분 → 시트 이름)
      const group = l.placeType || l.sheetName || "";
      const place = group || "기타";
      const k = `${l.vendor ?? ""}|${group}`;
      const f = m.get(k) ?? { key: k, vendor: l.vendor ?? null, group, label: l.vendor ? `${l.vendor} · ${place}` : place, title: statement.fileName, count: 0, amount: 0, decided: 0, claims: 0 };
      f.count++;
      f.amount += l.amount;
      if (l.decision) f.decided++;
      if (l.memberClaim === "OVERTIME") f.claims++;
      m.set(k, f);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, "ko"));
  }, [lines, statement.fileName]);

  /** 잘못 올린 내역 삭제 — 확인 글자('삭제')를 입력해야 진행 (결정·팀원 신청도 함께 지워짐) */
  const deleteUpload = async (f: { vendor: string | null; group: string; label: string; count: number; amount: number; decided: number; claims: number } | null) => {
    const all = !f;
    const count = all ? lines.length : f.count;
    const amount = all ? s.total.amount : f.amount;
    const decided = all ? lines.filter((l) => l.decision).length : f.decided;
    const claims = all ? lines.filter((l) => l.memberClaim === "OVERTIME").length : f.claims;
    const what = all ? `${statement.yearMonth.slice(0, 4)}년 ${Number(statement.yearMonth.slice(5))}월 올린 내역 전체` : f.label;
    const typed = await askReason({
      title: all ? "이 달 올린 내역 전체 삭제" : "이 내역 삭제",
      message: `${what} ${count}건 · ${won(amount)}원을 삭제합니다.`
        + (decided || claims ? `\n결정 ${decided}건과 팀원 요청 ${claims}건도 함께 삭제됩니다.` : "")
        + (all || count === lines.length ? "\n이 달에 남는 내역이 없으면 '올리기 전' 상태가 됩니다." : "")
        + "\n되돌릴 수 없습니다. 계속하려면 '삭제'를 입력하세요.",
      placeholder: "삭제", required: true, confirmLabel: "삭제",
    });
    if (typed === null) return;
    if (typed.trim() !== "삭제") { setActionErr("확인 글자가 달라 삭제하지 않았습니다. '삭제'를 입력하세요."); return; }
    const url = all
      ? `/api/pass-statements/${statement.id}`
      : `/api/pass-statements/${statement.id}/lines?${new URLSearchParams({ label: f.group, ...(f.vendor ? { vendor: f.vendor } : {}) })}`;
    const ok = await run("delete", () => api(url, { method: "DELETE" }));
    if (ok) toast(`${what} ${count}건을 삭제했어요.`);
  };

  return (
    <div className="space-y-5">
      {dialog}
      {/* 월 마감 상태 안내: 잠긴 달(마감·상신·승인)은 이유와 푸는 방법, 반려된 달은 다시 승인까지 가는 길 */}
      {notice && (
        <p className={`alert ${notice.tone === "rejected" || notice.tone === "closed" ? "alert-warn" : "alert-info"}`} role="status">
          {notice.text}{" "}
          <a href={`/closing?ym=${statement.yearMonth}`} className="font-semibold underline underline-offset-2">마감 · 상신 보기</a>
        </p>
      )}
      {/* 1. 진행 단계 + 지금 할 일 (올린 파일·추가 올리기 포함) — 위에서부터 차례로 처리하면 끝나도록 */}
      <section id="flow" className="card scroll-mt-20 overflow-hidden" aria-label="진행 단계">
        <PassSteps step={step} />

        <div className="space-y-3 p-4">
          {/* 지금 할 일 */}
          <div data-task className={`rounded-xl border p-4 ${task.tone === "warn" ? "border-amber-200 bg-amber-50/60" : task.tone === "ok" ? "border-line bg-surface-muted/60" : "border-primary/30 bg-brand-50/60"}`}>
            <p className="text-xs font-semibold text-fg-muted">지금 할 일</p>
            <p className="mt-0.5 text-base font-bold">{task.title}</p>
            {task.desc && <p className="mt-0.5 text-sm text-fg-2">{task.desc}</p>}

            {task.key === "unmatched" && (
              <div className="mt-3 space-y-2">
                <details className="text-sm text-fg-muted">
                  <summary className="cursor-pointer list-none">{editable ? "프로젝트 팀원이면 팀원을 지정하고, 팀원이 아니면 외부인 사용으로 처리해요." : "이 프로젝트 PM이 팀원을 지정하거나, 팀원이 아니면 외부인 사용으로 처리해요."} <span className="text-primary">자세히</span></summary>
                  <p className="mt-1">지정한 팀원은 다음 달부터 자동으로 연결돼요. 외부인 사용분은 PM 본인 부담으로 처리하고, 받으면 {editable ? "'외부인 수금'에서 체크하세요." : "PM이 '외부인 수금'에서 체크해요."}</p>
                </details>
                <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                  {unmatched.map((u) => (
                    <li key={u.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      {editable && canAssume && (
                        <input type="checkbox" className="size-5" aria-label={`${u.name} 선택`} checked={picked.has(u.key)}
                          onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(u.key); else n.delete(u.key); return n; })} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{u.name}</div>
                        <div className="text-sm text-fg-muted">{u.keys.map(keyText).join(" · ")}{u.keys.length ? " · " : ""}{u.ids.length}건 {won(u.amount)}원</div>
                      </div>
                      {editable && (
                        <Menu label={`${u.name} 팀원 지정`} disabled={anyBusy} align="right" minWidth={200}
                          triggerClassName="btn-secondary btn-sm w-full gap-1 sm:w-auto"
                          items={[...members.filter((m) => !m.leftAt), ...members.filter((m) => m.leftAt)].map((m) => ({
                            key: m.userId,
                            label: m.leftAt ? `${m.name} (${leftLabel(m.leftAt)})` : m.name,
                            group: members.some((x) => x.leftAt) ? (m.leftAt ? "이전 팀원 (이 기간 근무)" : "현재 팀원") : undefined,
                            onSelect: () => void patch(u.ids[0], { userId: m.userId }),
                          }))}>
                          팀원 지정 <Caret />
                        </Menu>
                      )}
                    </li>
                  ))}
                </ul>
                {editable && canAssume && (
                  <button className="btn-secondary w-full sm:w-auto" disabled={anyBusy || picked.size === 0}
                    onClick={() => bulk("assume-external", { lineIds: unmatched.filter((u) => picked.has(u.key)).flatMap((u) => u.ids) },
                      "선택한 외부인 사용분을 내(PM) 사용분으로 처리할까요? PM 본인 부담이 되고, 받으면 '외부인 수금'에서 체크할 수 있어요.").then((ok) => { if (ok) setPicked(new Set()); })}>
                    선택한 외부인 건을 내 사용분으로{picked.size ? ` (${picked.size}명)` : ""}
                  </button>
                )}
              </div>
            )}

            {task.key === "claims" && (
              <div className="mt-3">
                {/* 보조 버튼 하나 — 요청 팀원·요청 건만 고정해 펼침 (정하는 것은 줄의 ✓) */}
                <button type="button" className="btn-secondary" onClick={showClaims}>요청 건만 보기</button>
              </div>
            )}
            {task.key === "over" && (
              <div className="mt-3">
                <button type="button" className="btn-secondary" onClick={() => { const over = groups.filter((g) => g.overCount > 0); setOpenIds(new Set(over.map((g) => g.userId))); goPeople(over[0]?.userId); }}>해당 팀원 내역 보기</button>
              </div>
            )}
            {/* 월 확정은 하단 고정 바의 [월 확정] 하나로, 내려받기는 '올린 파일·내려받기' 줄 하나로 */}
            {later.length > 0 && <p className="mt-3 text-sm text-fg-muted">그다음: {later.join(" · ")}</p>}
          </div>

          {/* 이 달에 올린 파일 (업체·구분·건수) */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-fg-muted">올린 내역</span>
            {files.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-0.5">
                <span className="badge badge-neutral" title={f.title}>{f.label} {f.count}건</span>
                {editable && canDelete && (
                  <RowMenu label={`${f.label} 메뉴`} align="left" actions={[{ label: "이 내역 삭제", danger: true, onSelect: () => void deleteUpload(f) }]} />
                )}
              </span>
            ))}
          </div>
          {upload}
          {editable && canDelete && lines.length > 0 && (
            <div className="text-right">
              <button type="button" className="text-xs text-fg-muted underline-offset-2 hover:text-status-rejected hover:underline" disabled={anyBusy} onClick={() => void deleteUpload(null)}>
                이 달 올린 내역 모두 삭제
              </button>
            </div>
          )}

        </div>
      </section>

      {err && <p className="alert alert-danger" role="alert">{err}</p>}

      {/* 2. 요약 */}
      {/* 총 사용·회사 부담 두 칸 (본인 부담은 기본값이라 칸으로 두지 않는다). 사용처별 보조 글자는 한 줄에 이어 쓰면 모바일에서 줄이 넘어가므로 사용처마다 한 줄 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="총 사용" value={`${won(s.total.amount)}원`}
          sub={allPlaces.length > 1
            ? <span className="flex flex-col gap-0.5">{allPlaces.map((p) => <span key={p.place} className="tabular truncate">{p.place} {p.count}건 · {won(p.amount)}원</span>)}</span>
            : `${s.total.count}건`} />
        <Stat label="회사 부담" value={`${won(s.overtime.amount)}원`} sub={`${s.overtime.count}건`} tone="ok" />
      </div>

      {/* 3. 팀원별 내역 (접어서 보기) — 한 장의 표처럼 열을 맞춘다 */}
      <section id="people" className="card scroll-mt-20 overflow-hidden">
        <button type="button" aria-expanded={peopleOpen} onClick={() => setPeopleOpen((v) => !v)}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted/50 sm:px-5">
          <span className="min-w-0 flex-1">
            <span className="section-title">팀원별 내역 <span className="font-normal text-fg-muted">{groups.length}명</span></span>
            <span className="tabular mt-0.5 block text-sm text-fg-muted">
              합계 {won(groups.reduce((a, g) => a + (g.p?.total.amount ?? 0), 0))}원
              {s.pendingClaims > 0 && <> · 요청 확인 {groups.filter((g) => g.claims > 0).length}명</>}
            </span>
          </span>
          <Icon name="down" sw={1.8} className={`size-4 shrink-0 text-fg-subtle transition-transform ${peopleOpen ? "rotate-180" : ""}`} />
        </button>
        {peopleOpen && (
        <>
        {items.some((i) => !links[i.id]) && (
          <p className="border-t border-line bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-5">
            {items.filter((i) => !links[i.id]).map((i) => `‘${shortName(i.name)}’`).join(", ")} 회사 부담은 예산 항목에 연결되지 않아 상신 엑셀·예산 집행에 들어가지 않아요. 프로젝트 운영비 › 출입증 회사 부담 항목에서 연결하세요.
          </p>
        )}
        {linkTexts.length > 0 && (
          <p className="tabular border-t border-line bg-sky-50/60 px-4 py-2 text-xs text-sky-900 sm:px-5" title="회사 부담 확정분은 연결 예산 항목의 집행에 합쳐집니다 (카드 + 출입증)">
            회사 부담 예산 · {linkTexts.join(" · ")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 sm:px-5">
          <label className="flex min-h-10 items-center gap-2 text-sm text-fg-muted sm:min-h-9">
            <input type="checkbox" checked={pin !== null} onChange={(e) => (e.target.checked ? pinNow() : setPin(null))} /> 요청 확인할 팀원·건만
            {pin && <span className="tabular text-xs">({shown.length}명{s.pendingClaims === 0 ? " · 요청을 모두 확인했어요" : ""})</span>}
          </label>
          <span className="ml-auto flex gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpenIds(new Set(shown.map((g) => g.userId)))}>모두 펼치기</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpenIds(new Set())}>모두 접기</button>
          </span>
        </div>

        <div className="sm:overflow-x-auto">
        {/* 열 머리글 (넓은 화면) */}
        <div className="hidden gap-4 border-y border-line bg-surface-muted/50 px-5 py-2 text-xs font-medium text-fg-muted sm:grid sm:[grid-template-columns:var(--cols)]" style={colsVar}>
          <span>팀원</span>
          {placeOrder.map((pl) => <span key={pl} className="text-right">{placeIcon(pl)} {pl}</span>)}
          <span className="text-right">회사 부담</span>
          <span className="text-right">본인 부담</span>
          <span className="text-right">합계</span>
        </div>

        <ul className="divide-y divide-line border-t border-line sm:border-t-0">
          {shown.map((g) => {
            const { p, claims, overCount, clearable, places } = g;
            const isOpen = openIds.has(g.userId);
            // 필터가 켜져 있으면 요청 건만 (머리글 합계·정한 것 모두 지우기는 전체 줄 기준 그대로)
            const visible = visibleLines(g);
            const filtered = pin !== null && visible.length < g.lines.length;
            // 전체 / 회사 부담 칩 — 회사 부담 건이 있고 전체와 다를 때만 (팀원 화면과 같은 규칙)
            const companyLines = visible.filter((l) => l.decision === "OVERTIME" || (!l.decision && l.memberClaim === "OVERTIME"));
            const companyChip = companyLines.length > 0 && companyLines.length < visible.length;
            const onlyCompany = companyChip && companyOnly.has(g.userId);
            const shownLines = onlyCompany ? companyLines : visible;
            return (
              <li key={g.userId} id={`person-${g.userId}`} className="scroll-mt-20">
                <button type="button" aria-expanded={isOpen} onClick={() => toggle(g.userId)}
                  className={`grid w-full items-center gap-x-4 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-surface-muted/50 sm:[grid-template-columns:var(--cols)] ${isOpen ? "bg-surface-muted/40" : ""}`}
                  style={colsVar}>
                  {/* 팀원 */}
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Icon name="disclose" className={`size-4 shrink-0 text-fg-subtle transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    {/* 이름은 자르지 않는다 — 배지가 많으면 다음 줄로 */}
                    <span className="whitespace-nowrap font-semibold">{g.name}</span>
                    {claims > 0 && <Tag tone="warn">요청 확인 {claims}</Tag>}
                    {overCount > 0 && <Tag tone="warn">한도 초과 {overCount}</Tag>}
                    {/* 좁은 화면: 합계만 오른쪽에 */}
                    <span className="tabular ml-auto text-sm font-semibold sm:hidden">{won(p?.total.amount ?? 0)}원</span>
                  </span>
                  <span className="hidden sm:contents">
                      {placeOrder.map((pl) => <AmountCell key={pl} amount={places.get(pl)?.amount ?? 0} count={places.get(pl)?.count} />)}
                      <AmountCell amount={p?.overtime.amount ?? 0} count={p?.overtime.count} tone="ok" />
                      <AmountCell amount={p?.total.amount ?? 0} count={g.lines.length} />
                  </span>
                  <span className="tabular pl-6 text-xs text-fg-muted sm:hidden">
                      {placeOrder.filter((pl) => places.has(pl)).map((pl) => `${pl} ${places.get(pl)!.count}건 ${won(places.get(pl)!.amount)}`).join(" · ")}
                      {(p?.overtime.amount ?? 0) > 0 && <> · <span className="text-status-approved">회사 부담 {won(p!.overtime.amount)}</span></>}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-line pb-2">
                    {/* 도구 한 줄: 왼쪽 거르기 칩(팀원 화면과 같은 칩), 오른쪽 끝 '정한 것 모두 지우기'(글자 버튼). 칩이 없어도 줄 높이는 칩 높이(40/32)로 고정 */}
                    {(companyChip || (editable && clearable > 0)) && (
                      <div className="flex min-h-10 flex-wrap items-center gap-2 px-4 pt-3 sm:min-h-8 sm:px-5">
                        {companyChip && (
                          <div role="radiogroup" aria-label={`${g.name} 내역 거르기`} className="flex flex-wrap gap-2">
                            <button type="button" role="radio" aria-checked={!onlyCompany} className={`${chip(!onlyCompany)} gap-1`} onClick={() => setCompanyFilter(g.userId, false)}>전체 <span className="tabular">{visible.length}</span></button>
                            <button type="button" role="radio" aria-checked={onlyCompany} className={`${chip(onlyCompany)} gap-1`} onClick={() => setCompanyFilter(g.userId, true)}>회사 부담 <span className="tabular">{companyLines.length}</span></button>
                          </div>
                        )}
                        {/* 정하는 수단은 줄의 ✓ 하나 — 팀원별 일괄 결정은 두지 않는다. 되돌리기 수단으로 '정한 것 모두 지우기'만 */}
                        {editable && clearable > 0 && (
                          <button type="button" className="btn-ghost btn-sm ml-auto gap-1" disabled={anyBusy}
                            title="정한 결정을 모두 지우고 미결정으로 되돌립니다 (팀원 요청은 남음)"
                            onClick={() => void clearPerson(g)}>
                            정한 것 모두 지우기 <span className="tabular">{clearable}</span>
                          </button>
                        )}
                      </div>
                    )}
                    {/* 필터가 켜져 있으면 요청 건만 보인다는 안내 — 위 머리글 합계는 이 달 전체 기준 */}
                    {filtered && (
                      <p className="flex flex-wrap items-center gap-x-2 px-4 pt-2 text-xs text-fg-muted sm:px-5">
                        <span className="tabular">요청 건 {visible.length}건만 보는 중 · 전체 {g.lines.length}건</span>
                        <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => setPin(null)}>전체 보기</button>
                      </p>
                    )}
                    {/* 하루 한도 경고는 그 날의 합에 대한 것이라 날짜 소제목 아래에 한 번만 (팀원 화면과 같은 자리) */}
                    <DayGroup items={shownLines} dateOf={(l) => l.date} amountOf={(l) => l.amount} band headClassName="px-4 sm:px-5"
                      extra={(d) => [...new Map(d.items.flatMap((l) => (over.get(l.id) ? [over.get(l.id)!] : [])).map((w) => [w.itemName, w])).values()].map((w) => (
                        <span key={w.itemName} className={limitBadge}>{dayLimitMessage({ ...w, itemName: shortName(w.itemName) })}</span>
                      ))}
                      render={(l) => (
                        <PmLineRow key={l.id} l={l} groupName={g.name} items={items} lim={over.get(l.id)} part={l.decision === "OVERTIME" ? split.get(l.id) : undefined}
                          editable={editable} canAssume={canAssume} links={links} dupOf={dupOf}
                          busy={lineBusy.has(l.id)} onPatch={onLinePatch} />
                      )} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        </div>
        {shown.length === 0 && (
          <p className="px-5 py-6 text-center text-sm text-fg-muted">
            {pin ? <>확인할 요청이 없어요. <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => setPin(null)}>전체 팀원 보기</button></> : "팀원이 지정된 내역이 없어요."}
          </p>
        )}
        </>
        )}
      </section>

      {/* 4. 회사 부담 항목별 합계 · 외부인 수금 */}
      {s.items.length > 0 && (
        <div className="card p-4 sm:p-5">
          <h2 className="section-title">회사 부담 항목별 합계</h2>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {s.items.map((it) => (
              <li key={it.name} className="rounded-xl bg-surface-muted px-3 py-2">
                <div className="flex items-baseline justify-between gap-2"><b className="text-sm">{it.name}</b><span className="tabular text-sm font-bold">{won(it.amount)}원</span></div>
                <div className="text-xs text-fg-muted">{it.count}건 · {it.places.map((p) => `${p.place} ${won(p.amount)}`).join(" · ")}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ext.length > 0 && <ExternalCollect groups={ext} canEdit={canEdit} busy={anyBusy} onCollect={(ids, collected, note) => bulk("collect", { lineIds: ids, collected, note })} />}

      {/* 5. 올린 파일 · 내려받기 (내려받기는 여기 한 곳) */}
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <span className="min-w-0 flex-1 basis-full text-xs text-fg-muted lg:basis-auto">
          {statement.fileName} · {statement.uploadedByName ?? ""} {shortDate(statement.uploadedAt)} 올림
          {!open && statement.confirmedAt && ` · ${statement.confirmedByName ?? ""} ${shortDate(statement.confirmedAt)} 확정`}
        </span>
        {/* 확정 전 파일은 임시(제목에도 '확정 전 (임시)') — 확정 후 내려받아 인사·급여 담당에게 전달 */}
        <a className="btn-ghost btn-sm" href={`/api/pass-statements/${statement.id}/export?kind=deduct`} title={open ? "확정 전 임시 파일이에요 — 확정 후 내려받아 전달하세요" : undefined}><DownloadIcon />급여 공제 대상 엑셀{open ? " (확정 전)" : ""}</a>
        <a className="btn-ghost btn-sm" href={`/api/pass-statements/${statement.id}/export?kind=full`}><DownloadIcon />업체 대조용 전체 내역</a>
      </div>

      {/* 처리 방법 안내 블록은 두지 않는다 (2026-10-15) — 규칙은 지금 할 일·확정 확인 창·버튼 툴팁이 상황마다 보여 준다. 다른 데 없는 '항목 없음' 경고만 남긴다 */}
      {items.length === 0 && <p className="alert alert-warn text-sm">회사 부담 항목이 없어 모든 사용분이 본인 부담입니다. 필요하면 재무 승인 담당에게 요청하세요 (프로젝트 운영비 › 출입증 회사 부담 항목).</p>}

      {/* 하단 고정: 상태 + 월 확정 (화면의 주요 동작 하나). 확정 취소만 할 수 있는 재무 승인 담당에게는 확정된 달에만. 잠긴 달은 상태와 이유만 */}
      {(canEdit || (canReopen && !open)) && (
        <StickyAction>
          <span className={`badge ${open ? "badge-neutral" : "badge-ok"}`}>{open ? "확정 전" : "확정"}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
            {locked ? LOCK_SHORT[closingStatus!] : open && confirmBlocked ? "" : open
              ? s.defaultDeduct.count ? `따로 정하지 않은 ${s.defaultDeduct.count}건은 확정 때 본인 부담` : "모든 건을 정했어요"
              : "확정된 달 — 팀원 요청·처리를 바꿀 수 없어요"}
          </span>
          {!open && canReopen && !locked && <button type="button" className="btn-secondary" disabled={anyBusy} onClick={reopen}>확정 취소</button>}
          {editable && (
            <span className="flex flex-wrap items-center justify-end gap-2">
              {(confirmBlocked || confirmErr) && <span className="text-xs font-medium text-status-rejected" role="status">{confirmErr ?? confirmBlocked}</span>}
              <button type="button" className={s.pendingClaims > 0 || unmatched.length > 0 ? "btn-secondary" : "btn-primary"} disabled={anyBusy || !!confirmBlocked} title={confirmBlocked ?? undefined} onClick={() => void confirmMonth()}>월 확정</button>
            </span>
          )}
        </StickyAction>
      )}
    </div>
  );
}

/** 외부인 수금 — PM이 대신 공제받은 금액을 외부인에게서 받았는지 기록 */
function ExternalCollect({ groups, canEdit, busy, onCollect }: {
  groups: ReturnType<typeof externalGroups>;
  canEdit: boolean;
  busy: boolean;
  onCollect: (ids: string[], collected: boolean, note?: string) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <h2 className="section-title">외부인 수금</h2>
        <p className="text-sm text-fg-muted">PM이 대신 공제받은 금액이에요. 외부인에게 받으면 체크하세요 (확정 후에도 가능).</p>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {groups.map((g) => (
          <li key={g.name} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={g.allCollected} disabled={!canEdit || busy}
                onChange={(e) => onCollect(g.lineIds, e.target.checked, notes[g.name])} aria-label={`${g.name} 받음`} />
              <span className="font-semibold">{g.name}</span>
            </label>
            <span className="text-sm text-fg-muted">{g.count}건 · <b className="tabular text-fg">{won(g.amount)}원</b>{g.allCollected ? " · 받음" : g.collected ? ` · ${g.collected}/${g.count}건 받음` : ""}</span>
            <input className="input min-w-0 flex-1 py-1 sm:text-sm" placeholder="메모 (예: 10/20 계좌이체)" maxLength={200} disabled={!canEdit}
              defaultValue={g.note ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [g.name]: e.target.value }))}
              onBlur={(e) => canEdit && e.target.value !== (g.note ?? "") && onCollect(g.lineIds, g.allCollected, e.target.value)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
