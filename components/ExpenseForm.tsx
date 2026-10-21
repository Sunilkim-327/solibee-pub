"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DatePicker } from "./DatePicker";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/client";
import type { ExpenseRow, InputContext, MasterCategory } from "@/lib/dto";
import { addMonths, dayLabel, formatPeriod, localYmd, todayString, won, ymKo } from "@/lib/format";
import { inputDeadlineProblem, inputOpen } from "@/lib/month-phase";
import { chip } from "./ui";
import { ACCOUNT_CHECK_MESSAGE, flagLabel, accountCheck, checkPolicy, isAdvisory, limitCap, paidNote, parseFlags, koreanWon, type Flag } from "@/lib/policy";
import { allowedPayMethods, requiresAttendees } from "@/lib/rules";
import type { CardSms } from "@/lib/sms";
import { suggestItem } from "@/lib/suggest";
import { PAY_METHOD_LABEL, type PayMethod, type Role } from "@/lib/types";
import { SmsInfo, SmsPaste } from "./SmsPaste";
import { Icon } from "./icons";
import { useConfirm } from "./ConfirmDialog";
import { availableAfter } from "@/lib/input-budget";
import { Sheet } from "./Sheet";

type Props = {
  projectId: string;
  role: Role;
  /** 입력 가능한 분류/항목 (재무 승인이 등록한 예산 항목, 팀원은 PM이 노출한 항목만) */
  categories: MasterCategory[];
  lockedMonths: string[];
  /** context.deadlinePassedMonths: 팀원 입력 기한(다음 달 3일)이 지난 달 — 없으면 기간·오늘로 계산 (lib/month-phase) */
  context: InputContext;
  initial?: ExpenseRow;
  onDone?: () => void;
  /** 화면 하단 고정 저장 바 (모바일 입력 화면) */
  stickySubmit?: boolean;
  /**
   * 과업 선택 (변경계약이 있을 때): id ""는 본 과업. itemIds가 있으면 그 과업에서 고를 수 있는 항목만 보여준다
   * (담당 PM: 본 과업 = 팀원 항목, 변경 과업 = 과업 전용 항목 / 메인 PM: 제한 없음)
   */
  tasks?: { id: string; label: string; itemIds: string[] | null }[];
  /** 이 프로젝트 PM 이름 (빈 화면·마감 안내에 표시) */
  pmNames?: string[];
  /** 로그인 사용자 id — 결제방법 "마지막에 쓴 방법" 기억 키 (브라우저 저장) */
  userId?: string;
  /** PM 대신 입력: 결제자로 고를 수 있는 다른 팀원 (직급 → 성명 순). 있으면 새 입력에서 결제자를 고른다 */
  proxyPayers?: { id: string; name: string; position: string | null }[];
};

const lastMethodKey = (userId: string, projectId: string) => `opex:lastPayMethod:${userId}:${projectId}`;

/** 입력 칸 — 오류 표시·포커스 이동 순서 */
type Field = "amount" | "date" | "payMethod" | "item" | "detail" | "attendees" | "justification";
const FIELD_ORDER: Field[] = ["amount", "date", "payMethod", "item", "detail", "attendees", "justification"];
const FIELD_LABEL: Record<Field, string> = {
  amount: "금액", date: "날짜", payMethod: "결제방법", item: "항목", detail: "세부내역", attendees: "참석자", justification: "소명 사유",
};
/** 오류가 있을 때 포커스를 옮길 요소 id */
const FIELD_TARGET: Record<Field, string> = {
  amount: "amount", date: "f-date", payMethod: "f-pay", item: "f-item", detail: "detail", attendees: "f-att", justification: "justification",
};

const fmt = (v: string) => (v ? won(Number(v)) : "");
const splitNames = (s: string | null | undefined) => (s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);

/** 필드 아래 오류 문구 (아이콘 + 글자, 색만으로 전달하지 않음) */
function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1 text-sm font-medium text-status-rejected">
      <span aria-hidden className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-status-rejected text-xs leading-none font-bold text-on-primary">!</span>
      {text}
    </p>
  );
}

function FieldLabel({ htmlFor, id, children, right, optional }: { htmlFor?: string; id?: string; children: React.ReactNode; right?: React.ReactNode; optional?: boolean }) {
  const Tag = htmlFor ? "label" : "h3";
  return (
    <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
      <Tag id={id} {...(htmlFor ? { htmlFor } : {})} className="text-label font-bold text-fg">
        {children}
        {optional && <span className="ml-1 font-normal text-fg-muted">(선택)</span>}
      </Tag>
      {right}
    </div>
  );
}

/** 모바일 키보드가 화면을 가리는 높이 (iOS Safari는 interactive-widget을 무시하므로 직접 계산) */
function useKeyboardInset(enabled: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(covered > 80 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return inset;
}

export function ExpenseForm({ projectId, role, categories: allCategories, lockedMonths, context, initial, onDone, stickySubmit, tasks, pmNames, userId, proxyPayers }: Props) {
  const pmText = pmNames?.length ? `PM(${pmNames.join(", ")})` : "PM";
  const [taskId, setTaskId] = useState(initial?.changeId ?? "");
  const task = tasks?.find((t) => t.id === taskId);
  const categories = useMemo(() => {
    if (!task?.itemIds) return allCategories;
    const ok = new Set(task.itemIds);
    return allCategories.map((c) => ({ ...c, items: c.items.filter((i) => ok.has(i.id)) })).filter((c) => c.items.length > 0);
  }, [allCategories, task]);
  const router = useRouter();
  const editing = !!initial;
  // 대신 입력: 다른 팀원을 결제자로 고르면 그 사람의 개인 법인카드 건으로만 (공용카드·본사는 PM 본인 결제)
  const [proxyId, setProxyId] = useState("");
  const proxy = !initial ? proxyPayers?.find((p) => p.id === proxyId) : undefined;
  const methods = proxy ? (["PERSONAL_CARD"] as PayMethod[]) : allowedPayMethods(role);
  const onlyItem = categories.length === 1 && categories[0].items.length === 1 ? categories[0].items[0].id : "";

  // 사용일 범위: 프로젝트 시작일 ~ min(종료일, 오늘) — 서버 validateExpenseFields와 같은 기준. 종료 뒤 유예 입력이면 종료일이 기본
  const today = todayString();
  const dateMin = context.period?.start;
  const dateMax = context.period && context.period.end < today ? context.period.end : today;
  const inRange = (d: string) => (!dateMin || d >= dateMin) && d <= dateMax;
  const [date, setDate] = useState(initial?.date ?? (inRange(today) ? today : dateMax));
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  // 결제방법 기본값: 개인식법인카드(재무 승인은 본사지출) → 이후에는 이 브라우저에서 마지막에 쓴 방법 (사용자·프로젝트별)
  const defaultMethod: PayMethod = methods.includes("PERSONAL_CARD") ? "PERSONAL_CARD" : methods[0];
  const [payMethod, setPayMethod] = useState<PayMethod | "">(
    initial && methods.includes(initial.payMethod) ? initial.payMethod : defaultMethod,
  );
  useEffect(() => {
    if (initial || methods.length < 2 || !userId) return;
    try {
      const saved = localStorage.getItem(lastMethodKey(userId, projectId)) as PayMethod | null;
      if (saved && methods.includes(saved)) setPayMethod(saved);
    } catch { /* 저장소를 못 쓰면 기본값 */ }
    // 처음 한 번만 (렌더 후 읽어 서버 렌더와 어긋나지 않게)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [itemId, setItemId] = useState(initial?.itemId ?? onlyItem);
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const initialNames = splitNames(initial?.attendees);
  // 칩으로 고를 수 있는 사람: 팀원 + 협력 인력 (그 외 이름은 외부 참석자 칸으로)
  const chipNames = [...context.people, ...context.partners];
  // 팀원의 새 입력은 보통 본인 혼자 쓴 지출 → 참석자 기본값은 본인 (팀원 칩에 있을 때)
  const [people, setPeople] = useState<string[]>(() =>
    initial ? initialNames.filter((n) => chipNames.includes(n)) : role === "MEMBER" && context.people.includes(context.me) ? [context.me] : [],
  );
  const [extra, setExtra] = useState(initialNames.filter((n) => !chipNames.includes(n)).join(", "));
  const [hasExternal, setHasExternal] = useState(initial?.hasExternal ?? false);
  // 공용 지출 항목(참석자 선택): 팀원 새 입력은 본인이 들어간 채로 보이고, 그 외에는 접어 둔다
  const [openAttendees, setOpenAttendees] = useState(initial ? !!initial.attendees : role === "MEMBER");
  // 참석자 상세(팀원·외부·인원) — 모바일 입력 화면은 하단 시트, 그 외(수정 시트·PC)는 펼침
  const [attOpen, setAttOpen] = useState(false);
  const [attAsSheet, setAttAsSheet] = useState(false);
  const [headcountOverride, setHeadcountOverride] = useState<number | null>(
    initial?.headcount != null && initial.headcount !== initialNames.length ? initial.headcount : null,
  );
  const [justification, setJustification] = useState(initial?.justification ?? "");
  const [pendingFlags, setPendingFlags] = useState<Flag[] | null>(null);
  const { confirm, dialog } = useConfirm();
  const [sms, setSms] = useState<CardSms | null>(null);
  const [smsQueue, setSmsQueue] = useState<CardSms[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 오류 표시 시점: 칸을 한 번 떠난 뒤(touched) 또는 등록을 눌러 본 뒤(submitted)
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const touch = (f: Field) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));
  // 등록 직후 알림 + 실행 취소
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagBox = useRef<HTMLDivElement>(null);
  const kbInset = useKeyboardInset(!!stickySubmit);

  const allItems = useMemo(
    () => categories.flatMap((c) => c.items.map((i) => ({ ...i, categoryId: c.id, categoryName: c.name }))),
    [categories],
  );
  const selected = allItems.find((i) => i.id === itemId);
  const suggestion = useMemo(() => suggestItem(`${detail} ${merchant}`, allItems), [detail, merchant, allItems]);
  const monthLocked = lockedMonths.includes(date.slice(0, 7));
  // 팀원만: 입력 기한이 지난 달(마감 대기)은 마감된 달처럼 고를 수 없다 — PM·재무는 대신 입력하므로 제한 없음
  const deadlineMonths = useMemo(() => {
    if (role !== "MEMBER") return [];
    if (context.deadlinePassedMonths) return context.deadlinePassedMonths;
    if (!context.period) return [];
    // 기간 시작 달 ~ min(기간 끝 달, 이번 달) 중 기한이 지난 달
    const out: string[] = [];
    const endYm = context.period.end.slice(0, 7);
    const last = endYm < today.slice(0, 7) ? endYm : today.slice(0, 7);
    for (let m = context.period.start.slice(0, 7); m <= last && out.length < 120; m = addMonths(m, 1)) if (!inputOpen(m, today)) out.push(m);
    return out;
  }, [role, context.deadlinePassedMonths, context.period, today]);
  const pickerLocked = useMemo(() => (deadlineMonths.length ? [...lockedMonths, ...deadlineMonths] : lockedMonths), [lockedMonths, deadlineMonths]);
  // 기한 때문에 막힌 달의 문구 (API 403과 같은 문장) — 마감된 달이면 마감 문구가 우선
  const deadlineProblem = !monthLocked && deadlineMonths.includes(date.slice(0, 7)) ? inputDeadlineProblem(date.slice(0, 7), today) : null;
  // 공용 지출 항목(참석자 필수 꺼짐)은 참석자 선택 — 접어 두고 필요할 때만 입력
  const methodForRules: PayMethod = proxy ? "PERSONAL_CARD" : payMethod || methods[0];
  const needAttendees = requiresAttendees(methodForRules, selected?.needsAttendees ?? true);
  const attendeesOptional = !needAttendees && methodForRules !== "HQ";
  const showAttendees = methodForRules !== "HQ" && (!attendeesOptional || openAttendees);
  const extraNames = splitNames(extra);
  const attendees = [...people, ...extraNames].join(", ");
  const allTeam = context.people.length > 0 && context.people.every((n) => people.includes(n));
  const headcount = headcountOverride ?? people.length + extraNames.length;
  const amountNum = Number(amount) || 0;
  const perPerson = amountNum && headcount > 0 ? Math.round(amountNum / headcount) : 0;
  const remaining = selected ? context.remaining[selected.id] : undefined;
  // 수정 중: 원래 항목과 같은 예산(같은 항목 또는 같은 묶음)이면 원래 금액은 잔액에 되돌려 더한다
  const keyOf = (id: string) => context.budgetKeyOf?.[id] ?? id;
  const sameBudget = !!initial && (initial.itemId === itemId || keyOf(initial.itemId) === keyOf(itemId));
  const remainingBefore = remaining !== undefined ? remaining + (sameBudget ? initial!.amount : 0) : undefined;
  const remainingAfter = remainingBefore !== undefined ? remainingBefore - amountNum : undefined;
  const hardOver = !!selected?.hardBudget && remainingAfter !== undefined && remainingAfter < 0;
  // 항목별 가용 예산 — 매월 항목이면 사용일이 속한 달의 "그 달 가용"(월 예산 − 그 달 사용), 그 외는 총 잔액
  // 지난달 사용일을 적어도 그 달 기준으로 보여 준다 (monthlyByYm). 없으면 이번 달 것만(monthly)
  const useYm = date.slice(0, 7);
  const monthLabel = useYm === context.ym ? "이번 달" : /^\d{4}-\d{2}$/.test(useYm) ? `${Number(useYm.slice(5))}월` : "그 달";
  const monthlyOf = (id: string) => (context.monthlyByYm?.[useYm] ?? (context.ym && useYm === context.ym ? context.monthly : undefined))?.[id];
  const budgetLine = (id: string): { label: string; value: number } | null => {
    const m = monthlyOf(id);
    if (m) return { label: `${monthLabel} 가용`, value: m.budget - m.spent };
    const r = context.remaining[id];
    return r !== undefined ? { label: "잔액", value: r } : null;
  };
  const selectedMonthly = selected ? monthlyOf(selected.id) : undefined;
  const avail = availableAfter({
    remaining,
    monthly: selectedMonthly,
    amount: amountNum,
    refundTotal: sameBudget ? initial!.amount : 0,
    refundMonth: sameBudget && initial!.date.slice(0, 7) === useYm ? initial!.amount : 0,
  });
  const mainAfter = avail.monthAfter ?? avail.totalAfter;
  // 소명이 필요한 점검만 (계정 확인은 안내만)
  const existingFlags = initial ? parseFlags(initial.flags).filter((c) => !isAdvisory(c)) : [];
  const yesterday = localYmd(new Date(Date.now() - 86400000));
  const recent = context.recent.filter((r) => allItems.some((i) => i.id === r.itemId));
  const useTiles = allItems.length <= 8;

  // 규정 점검 미리 보기 — 서버와 같은 checkPolicy (중복 건은 서버만 알 수 있어 저장 시 확인)
  const predicted = useMemo<Flag[]>(() => {
    if (!selected || amountNum <= 0) return [];
    return checkPolicy({
      amount: amountNum,
      headcount: showAttendees ? headcount || null : null,
      date: new Date(`${date}T00:00:00.000Z`),
      hasExternal: showAttendees && hasExternal,
      item: selected,
      remainingBefore: remainingBefore ?? null,
      sameEntries: 0,
    }).filter((f) => !isAdvisory(f.code) && !(f.code === "OVER_BUDGET" && selected.hardBudget));
  }, [selected, amountNum, showAttendees, headcount, date, hasExternal, remainingBefore]);
  const flags = useMemo(() => {
    const seen = new Set<string>();
    return [...(pendingFlags ?? []), ...predicted].filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)));
  }, [pendingFlags, predicted]);
  const needJustification = flags.length > 0;
  // 한도를 넘긴 결제: 한도 금액으로 등록되고 세부내역 뒤에 결제금액이 붙는다 (서버 lib/expenses.ts와 같은 limitCap)
  const cap = selected && amountNum > 0 ? limitCap(amountNum, showAttendees ? headcount || null : null, selected) : null;

  // 입력 점검 (위에서부터 순서대로) — 비어 있는 칸은 등록 버튼 위에 요약하고, 누르면 첫 칸으로 이동
  const errors: Partial<Record<Field, string>> = {};
  if (amountNum <= 0) errors.amount = "결제 금액을 입력하세요.";
  if (monthLocked) errors.date = `${ymKo(date.slice(0, 7))}은 마감된 달이라 입력·수정할 수 없어요.`;
  else if (deadlineProblem) errors.date = deadlineProblem;
  else if (!inRange(date)) {
    errors.date = date > today ? "사용일은 오늘까지만 입력할 수 있어요." : `사용일이 프로젝트 기간(${context.period ? formatPeriod(context.period.start, context.period.end) : ""}) 밖이에요.`;
  }
  if (!proxy && !payMethod) errors.payMethod = "결제방법을 고르세요.";
  if (!itemId) errors.item = "항목을 고르세요.";
  else if (hardOver) errors.item = `잔액 초과를 막는 항목이라 잔액 ${won(Math.max(0, remainingBefore ?? 0))}원을 넘을 수 없어요.`;
  if (!detail.trim()) errors.detail = "세부내역을 입력하세요.";
  if (showAttendees && needAttendees) {
    if (!attendees) errors.attendees = "참석자를 1명 이상 고르세요.";
    else if (headcount <= 0) errors.attendees = "대상인원을 1명 이상으로 정하세요.";
  }
  if (needJustification && !justification.trim()) errors.justification = "소명 사유를 입력하세요.";
  const missing = FIELD_ORDER.filter((f) => errors[f]);
  const showErr = (f: Field) => (submitted || touched[f] ? errors[f] : undefined);
  const errProps = (f: Field) => (showErr(f) ? { "aria-invalid": true as const, "aria-describedby": `${FIELD_TARGET[f]}-err` } : {});

  // 서버 규정 점검(422)으로 소명이 필요해지면 소명 칸으로 이동
  useEffect(() => {
    if (!pendingFlags?.length) return;
    flagBox.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("justification")?.focus({ preventScroll: true });
  }, [pendingFlags]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function focusField(f: Field) {
    if (f === "attendees" && !attOpen) {
      openAttendeePanel();
      return;
    }
    const el = document.getElementById(FIELD_TARGET[f]);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const target = el.matches("input, textarea, select, button") ? el : el.querySelector<HTMLElement>("input, textarea, select, button");
    target?.focus({ preventScroll: true });
  }

  function openAttendeePanel() {
    // 모바일 입력 화면만 시트, PC·수정 시트 안에서는 아래로 펼친다 (시트 안에 시트를 겹치지 않음)
    setAttAsSheet(!!stickySubmit && typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches);
    setOpenAttendees(true);
    setAttOpen(true);
  }

  function applySms(s: CardSms, rest: CardSms[]) {
    if (s.date) setDate(s.date);
    if (s.amount) setAmount(String(s.amount));
    setMerchant(s.merchant ?? "");
    // 저장 직후 다음 문자를 적용할 때도 최신 값 기준이 되도록 함수형 업데이트
    if (s.merchant) setDetail((d) => d || s.merchant!);
    // 가맹점 이름으로 항목 추천 (예: 택시 → 야근교통비)
    const sug = suggestItem(s.merchant ?? "", allItems);
    if (sug) setItemId((i) => i || sug.id);
    setSms(s);
    setSmsQueue(rest);
    setPendingFlags(null);
    setMsg(null);
  }

  function reuse(r: InputContext["recent"][number]) {
    setItemId(r.itemId);
    setDetail(r.detail);
    const names = splitNames(r.attendees);
    setPeople(names.filter((n) => chipNames.includes(n)));
    setExtra(names.filter((n) => !chipNames.includes(n)).join(", "));
    setHasExternal(r.hasExternal);
    setHeadcountOverride(null);
    setPendingFlags(null);
  }

  function resetAfterSave() {
    setAmount("");
    setDetail("");
    setMerchant("");
    setJustification("");
    setSms(null);
    setSubmitted(false);
    setTouched({});
    if (smsQueue.length) applySms(smsQueue[0], smsQueue.slice(1));
  }

  function showToast(id: string, text: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id, text });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }

  async function undo() {
    if (!toast) return;
    const { id } = toast;
    setToast(null);
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      setMsg({ ok: true, text: "방금 입력한 지출을 취소했어요." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (missing.length) {
      setSubmitted(true);
      focusField(missing[0]);
      return;
    }
    setBusy(true);
    setMsg(null);
    const body = {
      date,
      amount: amountNum,
      payMethod: methodForRules,
      itemId,
      detail,
      // 접어 둔 공용 지출은 참석자를 보내지 않는다
      headcount: showAttendees ? headcount || null : null,
      attendees: showAttendees ? attendees || null : null,
      hasExternal: showAttendees && hasExternal,
      justification: justification || null,
      merchant: merchant || null,
      changeId: taskId || null,
      ...(proxy ? { payerId: proxy.id } : {}),
    };
    try {
      if (editing) {
        await api(`/api/expenses/${initial!.id}`, { method: "PATCH", json: body });
        setMsg({ ok: true, text: "수정했어요." });
      } else {
        const created = await api<{ id: string }>(`/api/projects/${projectId}/expenses`, { method: "POST", json: body });
        if (userId && methods.length > 1 && !proxy) {
          try { localStorage.setItem(lastMethodKey(userId, projectId), methodForRules); } catch { /* 무시 */ }
        }
        const text = `${proxy ? `${proxy.name}님 대신 ` : ""}${won(amountNum)}원 ${selected?.name ?? ""} 입력됨`;
        if (created?.id) showToast(created.id, text);
        else setMsg({ ok: true, text });
      }
      setPendingFlags(null);
      if (!editing) resetAfterSave();
      router.refresh();
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && Array.isArray(err.data.flags)) {
        setSubmitted(true);
        setPendingFlags((err.data.flags as Flag[]).filter((f) => !isAdvisory(f.code)));
      } else {
        setMsg({ ok: false, text: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !(await confirm({ message: "이 지출을 삭제할까요? 되돌릴 수 없습니다.", confirmLabel: "삭제", danger: true }))) return;
    setBusy(true);
    try {
      await api(`/api/expenses/${initial.id}`, { method: "DELETE" });
      router.refresh();
      onDone?.();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
      setBusy(false);
    }
  }

  if (allItems.length === 0) {
    return (
      <div className="rounded-xl bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
        {role === "MEMBER"
          ? `입력할 수 있는 항목이 없습니다. ${pmText}에게 항목 설정을 요청하세요.`
          : "예산에 등록된 항목이 없습니다. 재무 승인 담당에게 예산 등록을 요청하세요."}
      </div>
    );
  }

  const submitLabel = busy ? "저장 중…"
    : editing ? "수정 저장"
    : `${amountNum > 0 ? `${won(cap?.cap ?? amountNum)}원 ` : ""}${needJustification ? "소명하고 입력" : "입력하기"}${cap ? ` (결제 ${won(amountNum)}원)` : ""}`;
  const blocked = missing.length > 0;

  const togglePerson = (n: string) => {
    setPeople(people.includes(n) ? people.filter((p) => p !== n) : [...people, n]);
    setHeadcountOverride(null);
  };

  /** 참석자 상세: 팀원·협력 인력·외부 참석자·대상인원·거래처 참석 */
  const attendeePanel = (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold">팀원</span>
          {context.people.length > 0 && (
            <button type="button" className="btn-ghost btn-sm text-primary"
              onClick={() => {
                // 팀 전체 = 팀원만 (협력 인력 선택은 그대로)
                setPeople(allTeam ? people.filter((p) => !context.people.includes(p)) : [...new Set([...people, ...context.people])]);
                setHeadcountOverride(null);
              }}>
              {allTeam ? "전체 해제" : "팀 전체"}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {context.people.map((n, i) => (
            <button key={`${n}-${i}`} type="button" aria-pressed={people.includes(n)} className={chip(people.includes(n))} onClick={() => togglePerson(n)}>
              {people.includes(n) && <span aria-hidden className="mr-1">✓</span>}{n}
            </button>
          ))}
          {context.people.length === 0 && <p className="text-sm text-fg-muted">등록된 팀원이 없어요.</p>}
        </div>
      </div>
      {context.partners.length > 0 && (
        <div>
          <span className="mb-2 block text-sm font-bold">협력 인력</span>
          <div className="flex flex-wrap gap-2">
            {context.partners.map((n, i) => {
              const on = people.includes(n);
              return (
                <button key={`${n}-${i}`} type="button" aria-pressed={on} className={`${chip(on)} ${on ? "" : "border-dashed"}`} onClick={() => togglePerson(n)}>
                  {on && <span aria-hidden className="mr-1">✓</span>}{n}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <label htmlFor="extra" className="mb-2 block text-sm font-bold">외부 참석자 <span className="font-normal text-fg-muted">(선택)</span></label>
        <input id="extra" className="input" placeholder="예) ○○상사 김담당, ○○상사 이담당" value={extra} maxLength={400} enterKeyHint="done"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
          onChange={(e) => {
            const v = e.target.value;
            // 외부 참석자를 처음 적으면 '거래처 참석'을 켠다 (협력사 프리랜서 등이면 끌 수 있음)
            if (!extra.trim() && v.trim()) setHasExternal(true);
            setExtra(v);
            setHeadcountOverride(null);
          }} />
        <p className="mt-1 text-xs text-fg-muted">쉼표로 구분해 이름만 적어 주세요. 연락처는 적지 마세요.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted px-3.5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">대상인원</span>
          <div className="flex items-center rounded-lg border border-line-strong bg-surface">
            <button type="button" aria-label="인원 줄이기" className="flex size-11 items-center justify-center rounded-l-lg text-lg text-fg-muted hover:bg-surface-muted"
              onClick={() => setHeadcountOverride(Math.max(0, headcount - 1))}>−</button>
            <output className="tabular w-9 text-center text-base font-bold" aria-live="polite">{headcount}</output>
            <button type="button" aria-label="인원 늘리기" className="flex size-11 items-center justify-center rounded-r-lg text-lg text-fg-muted hover:bg-surface-muted"
              onClick={() => setHeadcountOverride(headcount + 1)}>+</button>
          </div>
          <span className="text-sm text-fg-muted">명</span>
        </div>
        {perPerson > 0 && <span className="tabular text-sm text-fg-muted">1인당 <b className="text-fg">{won(perPerson)}원</b></span>}
      </div>
      {headcountOverride !== null && (
        <p className="-mt-3 text-xs text-fg-muted">
          이름보다 인원을 {headcountOverride > people.length + extraNames.length ? "많게" : "적게"} 정했어요.{" "}
          <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setHeadcountOverride(null)}>이름 수로 맞추기</button>
        </p>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
        <input type="checkbox" className="size-5" checked={hasExternal} onChange={(e) => setHasExternal(e.target.checked)} />
        거래처(외부인)가 참석했어요
      </label>
      {/* 안내만 — 협력사 프리랜서 등 거래처가 아닌 외부인도 있어 소명은 받지 않는다 */}
      {accountCheck(hasExternal, selected?.accountCode) && (
        <p className="alert alert-info -mt-3">ⓘ {ACCOUNT_CHECK_MESSAGE}</p>
      )}
      <p className="text-label leading-snug text-fg-muted">
        참석자 이름은 세무 증빙 목적으로만 수집하며 5년 보관 후 파기합니다.
      </p>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="divide-y divide-line [&>*]:py-6 lg:[&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
      {dialog}

      {/* ① 얼마·언제 */}
      <div className="space-y-5">
        {!editing && (
          <div className="space-y-2">
            <SmsPaste onPick={applySms} />
            {sms && (
              <SmsInfo sms={sms} remaining={smsQueue.length}
                onNext={() => applySms(smsQueue[0], smsQueue.slice(1))}
                onClear={() => { setSms(null); setSmsQueue([]); }} />
            )}
          </div>
        )}

        <div>
          <FieldLabel htmlFor="amount">결제 금액</FieldLabel>
          <div className={`flex items-baseline gap-1 border-b-2 pb-1 transition-colors ${showErr("amount") ? "border-status-rejected" : "border-line focus-within:border-primary"}`}>
            <input id="amount" inputMode="numeric" pattern="[0-9,]*" autoComplete="off" placeholder="0" enterKeyHint="next"
              className="tabular w-full min-w-0 bg-transparent text-amount font-extrabold tracking-tight text-fg outline-none placeholder:text-fg-subtle"
              value={fmt(amount)} {...errProps("amount")}
              onBlur={() => amount && touch("amount")}
              onKeyDown={(e) => {
                // 엔터: 폼 제출 대신 다음 빈 칸으로
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (!detail.trim()) document.getElementById("detail")?.focus();
                else e.currentTarget.blur();
              }}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 10))} />
            <span className="text-xl font-bold text-fg-muted">원</span>
          </div>
          <div className="mt-1 flex min-h-4 justify-between gap-2 text-xs text-fg-muted">
            <span className="tabular">{koreanWon(amountNum)}</span>
            {merchant && <span className="truncate">가맹점 · {merchant}</span>}
          </div>
          <FieldError id="amount-err" text={showErr("amount")} />
        </div>

        <div>
          <FieldLabel id="f-date-label" right={<span className="tabular text-sm text-fg-muted">{dayLabel(date)}</span>}>사용일</FieldLabel>
          <div id="f-date" role="group" aria-labelledby="f-date-label" className="relative flex flex-wrap items-center gap-2">
            {inRange(today) && <button type="button" aria-pressed={date === today} className={chip(date === today)} onClick={() => setDate(today)}>오늘</button>}
            {inRange(yesterday) && <button type="button" aria-pressed={date === yesterday} className={chip(date === yesterday)} onClick={() => setDate(yesterday)}>어제</button>}
            <DatePicker value={date} onChange={setDate} today={today} lockedMonths={pickerLocked} min={dateMin} max={dateMax} label="사용일 달력에서 고르기"
              className={`${chip(date !== today && date !== yesterday)} gap-1.5`}>
              <Icon name="calendar" />
              {date !== today && date !== yesterday ? dayLabel(date) : "다른 날"}
            </DatePicker>
          </div>
          {!monthLocked && !deadlineProblem && <FieldError id="f-date-err" text={showErr("date")} />}
          {monthLocked && (
            <p id="f-date-err" className="alert alert-neutral mt-2" role="alert">
              {ymKo(date.slice(0, 7))}은 마감된 달이라 입력·수정할 수 없어요.
              {role === "MEMBER" ? ` 수정이 필요하면 ${pmText}에게 요청하세요.` : role === "HQ" ? "" : " 상신 전이면 마감 · 상신 화면에서 마감을 해제하세요."}
            </p>
          )}
          {deadlineProblem && <p id="f-date-err" className="alert alert-neutral mt-2" role="alert">{deadlineProblem}</p>}
        </div>

        {/* 결제자: PM은 팀원 대신 입력할 수 있다 (새 입력만, 기본은 본인) */}
        {!editing && proxyPayers && proxyPayers.length > 0 && (
          <div>
            <FieldLabel htmlFor="f-payer">결제자</FieldLabel>
            <select id="f-payer" className="input" value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
              <option value="">나 (본인 결제)</option>
              {/* 순서는 직급 → 성명, 표기는 "성명 직급" */}
              <optgroup label="팀원 대신 입력">
                {proxyPayers.map((p) => <option key={p.id} value={p.id}>{p.position ? `${p.name} ${p.position}` : p.name}</option>)}
              </optgroup>
            </select>
            {proxy && (
              <p className="alert alert-info mt-2 text-sm" role="status">
                <b>{proxy.name}</b>님의 개인 법인카드 지출로 입력돼요. 내역에 입력한 사람 이름이 표시되고, 마감 전까지 {proxy.name}님도 고칠 수 있어요.
              </p>
            )}
          </div>
        )}

        {/* 결제방법: 여럿이면 필수 선택 (미선택 상태가 보이게) */}
        {methods.length > 1 ? (
          <div>
            <FieldLabel id="f-pay-label">결제방법</FieldLabel>
            <div id="f-pay" className={`seg grid w-full grid-flow-col ${showErr("payMethod") ? "ring-2 ring-status-rejected" : !payMethod ? "ring-1 ring-line-strong" : ""}`}
              role="radiogroup" aria-labelledby="f-pay-label" aria-required {...errProps("payMethod")}>
              {methods.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={payMethod === m} onClick={() => setPayMethod(m)}
                  className="min-h-10 px-2">
                  {payMethod === m && <span aria-hidden>✓</span>}
                  {PAY_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
            {showErr("payMethod")
              ? <FieldError id="f-pay-err" text={showErr("payMethod")} />
              : !payMethod && <p className="mt-1.5 text-xs text-fg-muted">결제한 카드·방식을 골라 주세요.</p>}
          </div>
        ) : (
          <p className="text-xs text-fg-muted">결제방법 · <b className="text-fg">{PAY_METHOD_LABEL[methods[0]]}</b></p>
        )}
      </div>

      {/* ② 무엇 */}
      <div className="space-y-5">
        {/* 과업 (변경계약) */}
        {tasks && tasks.length > 1 && (
          <div>
            <FieldLabel right={<span className="text-xs text-fg-muted">본계약과 함께 정산됩니다</span>}>과업</FieldLabel>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="과업">
              {tasks.map((t) => (
                <button key={t.id || "main"} type="button" role="radio" aria-checked={t.id === taskId} className={chip(t.id === taskId)}
                  onClick={() => {
                    setTaskId(t.id);
                    if (t.itemIds && itemId && !t.itemIds.includes(itemId)) setItemId("");
                  }}>{t.label}</button>
              ))}
            </div>
          </div>
        )}

        <div>
          <FieldLabel id="f-item-label" htmlFor={useTiles ? undefined : "f-item"}
            right={selected && <span className="text-xs text-fg-muted">분류 · {selected.categoryName}</span>}>항목</FieldLabel>
          {useTiles ? (
            <div id="f-item" role="radiogroup" aria-labelledby="f-item-label" {...errProps("item")}
              className={`grid grid-cols-2 gap-2 sm:grid-cols-3 lg:gap-1.5 ${showErr("item") && !itemId ? "rounded-xl ring-2 ring-status-rejected ring-offset-2 ring-offset-surface" : ""}`}>
              {allItems.map((i) => {
                const on = i.id === itemId;
                const b = budgetLine(i.id);
                return (
                  <button key={i.id} type="button" role="radio" aria-checked={on} onClick={() => setItemId(i.id)} title={i.categoryName}
                    className={`relative min-h-14 rounded-xl border-2 px-3.5 py-2.5 text-left transition lg:min-h-12 lg:rounded-lg lg:border lg:px-3 lg:py-2 ${
                      on ? "border-primary bg-brand-50" : "border-line bg-surface hover:border-line-strong"
                    }`}>
                    <span className={`block pr-5 text-base font-bold lg:text-sm ${on ? "text-primary" : "text-fg"}`}>{i.name}</span>
                    {b ? (
                      <span className={`tabular block truncate text-xs ${b.value <= 0 ? "font-semibold text-status-rejected" : "text-fg-muted"}`}>
                        {b.label} {won(b.value)}원
                      </span>
                    ) : <span className="block text-xs text-fg-muted">{i.categoryName}</span>}
                    {on && <span aria-hidden className="absolute top-2 right-2.5 text-sm font-bold text-primary">✓</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <select id="f-item" className="input" value={itemId} onChange={(e) => setItemId(e.target.value)} required {...errProps("item")}>
              <option value="">항목 선택</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.items.map((i) => {
                    const b = budgetLine(i.id);
                    return <option key={i.id} value={i.id}>{i.name}{b ? ` · ${b.value < 0 ? "초과" : b.value === 0 ? "없음" : won(b.value)}` : ""}</option>;
                  })}
                </optgroup>
              ))}
            </select>
          )}
          {!useTiles && allItems.some((i) => !!budgetLine(i.id)) && (
            <p className="mt-1 text-label text-fg-muted">항목 옆 숫자는 쓸 수 있는 금액 (매월 항목은 그 달 배정, 그 외는 잔액)</p>
          )}
          {selected && (avail.month !== undefined || avail.total !== undefined) && (
            <div className="mt-2 rounded-lg bg-surface-muted px-3 py-2.5 text-sm" aria-live="polite">
              {/* 주 숫자: 매월 항목은 사용일이 속한 달의 가용, 그 외는 잔액 */}
              <div className="tabular flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-fg-muted">
                  {avail.month !== undefined ? `${monthLabel} 가용` : "잔액"} <b className="text-fg">{won(avail.month ?? avail.total ?? 0)}원</b>
                </span>
                {amountNum > 0 && mainAfter !== undefined && (
                  <span className={mainAfter < 0 ? "font-semibold text-status-rejected" : "text-fg-muted"}>
                    {editing ? "저장 후" : "입력 후"} <b className={mainAfter < 0 ? "" : "text-fg"}>{mainAfter < 0 ? `−${won(-mainAfter)}` : won(mainAfter)}원</b>
                  </span>
                )}
              </div>
              <p className="tabular mt-0.5 text-xs text-fg-muted">
                {[
                  avail.month !== undefined && selectedMonthly && `월 배정 ${won(selectedMonthly.budget)}원`,
                  avail.month !== undefined && avail.total !== undefined && `총 잔액 ${won(avail.total)}원`,
                  selected.perPersonLimit && `1인당 한도 ${won(selected.perPersonLimit)}원`,
                  selected.perCaseLimit && `1건 한도 ${won(selected.perCaseLimit)}원`,
                  selected.hardBudget && "초과 입력 불가",
                ].filter(Boolean).join(" · ")}
              </p>
              {/* 초과 안내 — 총 잔액 초과는 규정 점검(소명), 이번 달만 초과는 안내 */}
              {amountNum > 0 && avail.totalAfter !== undefined && avail.totalAfter < 0 && !selected.hardBudget && (
                <p className="mt-1.5 text-xs font-semibold text-status-rejected">⚠ 예산 잔액을 {won(-avail.totalAfter)}원 넘어요 — 소명 사유를 적으면 {editing ? "저장할" : "입력할"} 수 있어요.</p>
              )}
              {amountNum > 0 && avail.monthAfter !== undefined && avail.monthAfter < 0 && !(avail.totalAfter !== undefined && avail.totalAfter < 0) && (
                <p className="mt-1.5 text-xs font-medium text-amber-800">⚠ {monthLabel} 월 배정을 {won(-avail.monthAfter)}원 넘어요. 총 잔액 안이라 {editing ? "저장은" : "입력은"} 할 수 있어요.</p>
              )}
            </div>
          )}
          {selected && avail.month === undefined && avail.total === undefined && (selected.perPersonLimit || selected.perCaseLimit) && (
            <p className="tabular mt-2 text-xs text-fg-muted">
              {[selected.perPersonLimit && `1인당 한도 ${won(selected.perPersonLimit)}원`, selected.perCaseLimit && `1건 한도 ${won(selected.perCaseLimit)}원`].filter(Boolean).join(" · ")}
            </p>
          )}
          <FieldError id="f-item-err" text={showErr("item") ?? (hardOver ? errors.item : undefined)} />
          {suggestion && suggestion.id !== itemId && (
            <button type="button" onClick={() => setItemId(suggestion.id)}
              className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-full bg-brand-50 px-3 text-sm font-semibold text-primary hover:bg-brand-100">
              추천 · {suggestion.name}(으)로 선택
            </button>
          )}
        </div>

        <div>
          <FieldLabel htmlFor="detail">세부내역</FieldLabel>
          <input id="detail" className="input" placeholder="예) 배포 작업 야근 석식" value={detail} enterKeyHint="done"
            {...errProps("detail")}
            onBlur={() => touch("detail")}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
            onChange={(e) => setDetail(e.target.value)} maxLength={300} />
          <FieldError id="detail-err" text={showErr("detail")} />
          {!editing && recent.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-xs text-fg-muted">최근 입력에서 고르기 (항목·참석자도 함께 채워져요)</p>
              <div className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-1">
                {recent.map((r, i) => (
                  <button key={i} type="button" onClick={() => reuse(r)}
                    className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-line bg-surface-muted px-3 text-base text-fg-2 hover:border-line-strong sm:min-h-9 sm:text-sm">
                    <span aria-hidden className="text-fg-muted">↺</span> {r.detail}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ③ 누구와 */}
      {methodForRules !== "HQ" && (
        <div>
          {!showAttendees ? (
            <>
              <FieldLabel optional>참석자</FieldLabel>
              <button type="button" id="f-att" className="btn-secondary btn-sm" onClick={openAttendeePanel}>+ 참석자 입력</button>
              <p className="mt-1.5 text-xs text-fg-muted">공용 지출 항목이라 참석자는 필요할 때만 적어요.</p>
            </>
          ) : (
            <>
              <FieldLabel id="f-att-label" optional={!needAttendees}
                right={headcount > 0 && <span className="tabular text-sm text-fg-muted">대상 <b className="text-fg">{headcount}</b>명{perPerson > 0 && <> · 1인당 <b className="text-fg">{won(perPerson)}</b>원</>}</span>}>
                참석자
              </FieldLabel>
              <div role="group" aria-labelledby="f-att-label" className="flex flex-wrap gap-2">
                {people.map((n, i) => (
                  <button key={`${n}-${i}`} type="button" className={chip(true)} aria-label={`${n} 참석자에서 빼기`}
                    onClick={() => { setPeople(people.filter((p) => p !== n)); setHeadcountOverride(null); }}>
                    {n}<span aria-hidden className="ml-1.5 opacity-70">✕</span>
                  </button>
                ))}
                {extraNames.length > 0 && (
                  <button type="button" className={chip(true)} onClick={openAttendeePanel}>외부 {extraNames.length}명</button>
                )}
                <button type="button" id="f-att" aria-expanded={attOpen} {...errProps("attendees")}
                  className={`${chip(false)} border-dashed ${showErr("attendees") ? "border-status-rejected text-status-rejected" : ""}`}
                  onClick={() => (attOpen && !attAsSheet ? setAttOpen(false) : openAttendeePanel())}>
                  {attOpen && !attAsSheet ? "접기 ▴" : people.length + extraNames.length ? "+ 참석자 추가·인원" : "+ 참석자 선택"}
                </button>
              </div>
              {hasExternal && <p className="mt-2"><span className="badge badge-info">거래처 참석</span></p>}
              <FieldError id="f-att-err" text={showErr("attendees")} />
              {attOpen && !attAsSheet && <div className="mt-4 rounded-xl border border-line p-4">{attendeePanel}</div>}
              {attOpen && attAsSheet && (
                <Sheet title="참석자" onClose={() => setAttOpen(false)}
                  footer={<button type="button" className="btn-primary btn-lg w-full" onClick={() => setAttOpen(false)}>완료 · {headcount}명</button>}>
                  {attendeePanel}
                </Sheet>
              )}
            </>
          )}
        </div>
      )}

      {/* 규정 점검 — 미리 알 수 있는 것은 입력 중에, 서버 점검(중복 등)은 저장 시 */}
      {(needJustification || existingFlags.length > 0) && (
        <div ref={flagBox} className="scroll-mt-24">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" role={pendingFlags?.length ? "alert" : undefined}>
            <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
              <span aria-hidden>⚠</span> 규정 점검{needJustification ? ` — 소명 사유를 적어야 ${editing ? "저장돼요" : "입력돼요"}` : ""}
            </p>
            <ul className="mt-1 list-inside list-disc text-sm text-amber-900">
              {needJustification
                ? flags.map((f) => <li key={f.code}>{f.message}</li>)
                : existingFlags.map((c) => <li key={c}>{flagLabel(c, initial?.itemName)}</li>)}
            </ul>
            {cap && (
              <p className="tabular mt-2 rounded-lg bg-white/70 px-3 py-2 text-sm font-semibold text-amber-900">
                한도 {won(cap.cap)}원으로 {editing ? "저장" : "입력"}돼요. 세부내역 뒤에 <span className="font-bold">{paidNote(cap.original)}</span>이 자동으로 붙어요.
              </p>
            )}
            <label htmlFor="justification" className="mt-3 block text-sm font-semibold text-amber-900">소명 사유</label>
            <textarea id="justification" className="input mt-1" rows={2} placeholder="예) 고객사 긴급 장애 대응으로 심야 귀가"
              value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={300}
              onBlur={() => touch("justification")} {...errProps("justification")} />
            <FieldError id="justification-err" text={showErr("justification")} />
          </div>
        </div>
      )}

      {/* 저장 */}
      <div className={stickySubmit ? "border-t-0" : ""}>
        {msg && (
          // 모바일 하단 고정 등록 바에서는 오류를 바 안에 보여 준다 (아래쪽 문구는 화면 밖이라 안 보임)
          <p role={msg.ok ? "status" : "alert"} className={`mb-3 alert ${msg.ok ? "alert-ok" : "alert-danger"} ${stickySubmit && !msg.ok ? "hidden lg:block" : ""}`}>
            {msg.ok ? "✓ " : ""}{msg.text}
          </p>
        )}
        <div data-bottom-bar={stickySubmit || undefined} style={stickySubmit && kbInset ? { bottom: kbInset } : undefined}
          className={stickySubmit
            ? "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
            : ""}>
          <div className="mx-auto max-w-xl lg:max-w-none">
            {stickySubmit && msg && !msg.ok && (
              <p role="alert" className="alert alert-danger mb-2 text-sm lg:hidden">{msg.text}</p>
            )}
            {blocked && !busy && (
              <p className="mb-2 truncate text-center text-xs text-fg-muted lg:text-left" aria-live="polite">
                입력 필요 · <b className="text-fg-2">{missing.map((f) => FIELD_LABEL[f]).join(" · ")}</b>
              </p>
            )}
            <div className="flex items-center gap-2">
              {editing && (
                <button type="button" className="btn-secondary btn-lg text-status-rejected" disabled={busy || monthLocked || !!deadlineProblem} onClick={remove}>삭제</button>
              )}
              <button className="btn-primary btn-lg tabular flex-1 aria-disabled:bg-[var(--c-primary-disabled)] aria-disabled:text-fg-subtle"
                disabled={busy} aria-disabled={blocked || undefined}>
                {submitLabel}
              </button>
            </div>
          </div>
        </div>
        {/* 모바일: 등록 바가 하단 탭 위에 떠 있으므로 그만큼 여백 */}
        {stickySubmit && <div className="h-14 lg:hidden" aria-hidden />}
      </div>

      {/* 등록 알림 + 실행 취소 */}
      {toast && (
        <div className="!border-0 !p-0">
          <div role="status" style={stickySubmit && kbInset ? { bottom: kbInset + 96 } : undefined}
            className={`fixed inset-x-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-fg px-4 py-3 text-sm text-canvas shadow-pop ${
              stickySubmit ? "bottom-[calc(10rem+env(safe-area-inset-bottom))] lg:bottom-8" : "bottom-8"
            }`}>
            <span className="min-w-0 flex-1 truncate">✓ {toast.text}</span>
            <button type="button" className="shrink-0 font-bold text-canvas underline-offset-2 hover:underline" onClick={undo}>되돌리기</button>
            <button type="button" aria-label="알림 닫기" className="shrink-0 px-1 opacity-70" onClick={() => setToast(null)}>✕</button>
          </div>
        </div>
      )}
    </form>
  );
}
