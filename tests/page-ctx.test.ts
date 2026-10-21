import { describe, expect, it } from "vitest";
import { backTo, ctxKeysFor, ctxOf, lastYm, lastYmCookieString, requestedYm, withCtx } from "@/lib/page-ctx";

const MONTHS = ["2026-08", "2026-09", "2026-10", "2026-11"];

describe("보던 달·범위를 링크에 붙이기 (withCtx)", () => {
  it("그 화면이 쓰는 키만 붙인다 — 현황은 ym·scope·part, 마감·출입증·내 정산·운영비는 ym만", () => {
    const ctx = { ym: "2026-09", scope: "all", part: "p1" };
    expect(withCtx("/dashboard", ctx)).toBe("/dashboard?ym=2026-09&scope=all&part=p1");
    expect(withCtx("/closing", ctx)).toBe("/closing?ym=2026-09");
    expect(withCtx("/pass", ctx)).toBe("/pass?ym=2026-09");
    expect(withCtx("/settlement", ctx)).toBe("/settlement?ym=2026-09");
    expect(withCtx("/budget", ctx)).toBe("/budget?ym=2026-09");
  });
  it("월 화면이 아니면 그대로", () => {
    const ctx = { ym: "2026-09", scope: "all" };
    for (const h of ["/expenses/new", "/projects", "/master?tab=items", "/me", "/notifications", "/settings#pass"]) expect(withCtx(h, ctx)).toBe(h);
  });
  it("링크에 이미 있는 키·쿼리·해시는 그대로 두고 뒤에 붙인다", () => {
    expect(withCtx("/dashboard?ym=2026-08#settle", { ym: "2026-09", scope: "all" })).toBe("/dashboard?ym=2026-08&scope=all#settle");
    expect(withCtx("/budget?from=closing", { ym: "2026-09" })).toBe("/budget?from=closing&ym=2026-09");
    expect(withCtx("/dashboard#ledger", { ym: "2026-09" })).toBe("/dashboard?ym=2026-09#ledger");
  });
  it("빈 값·꼴이 안 맞는 값은 붙이지 않는다", () => {
    expect(withCtx("/closing", {})).toBe("/closing");
    expect(withCtx("/closing", { ym: null, scope: undefined })).toBe("/closing");
    expect(withCtx("/dashboard", { ym: "2026-9", scope: "yes", part: "" })).toBe("/dashboard");
    expect(withCtx("/dashboard", { scope: "all" })).toBe("/dashboard?scope=all");
  });
  it("하위 경로도 그 화면 키를 쓴다", () => {
    expect(ctxKeysFor("/closing/anything?x=1")).toEqual(["ym"]);
    expect(ctxKeysFor("/closingx")).toEqual([]);
  });
  it("ctxOf: 지금 주소의 검색값에서 꼴이 맞는 맥락만", () => {
    expect(ctxOf(new URLSearchParams("ym=2026-10&scope=all&part=p1&check=flag"))).toEqual({ ym: "2026-10", scope: "all", part: "p1" });
    expect(ctxOf(new URLSearchParams("ym=bad&scope=no"))).toEqual({});
    expect(ctxOf({ ym: "2026-10", scope: ["all"] })).toEqual({ ym: "2026-10" });
    expect(ctxOf(null)).toEqual({});
  });
});

describe("마지막 본 달 쿠키", () => {
  it("꼴이 맞고 프로젝트 기간 안일 때만 쓴다", () => {
    expect(lastYm("2026-09", MONTHS)).toBe("2026-09");
    expect(lastYm("2025-12", MONTHS)).toBeNull();
    expect(lastYm("2026-9", MONTHS)).toBeNull();
    expect(lastYm(undefined, MONTHS)).toBeNull();
    expect(lastYm("", MONTHS)).toBeNull();
  });
  it("?ym= 이 먼저, 없거나 기간 밖이면 쿠키, 둘 다 아니면 없음(화면 기본값)", () => {
    expect(requestedYm("2026-10", "2026-08", MONTHS)).toBe("2026-10");
    expect(requestedYm(undefined, "2026-08", MONTHS)).toBe("2026-08");
    expect(requestedYm("2027-01", "2026-08", MONTHS)).toBe("2026-08");
    expect(requestedYm(undefined, "2027-01", MONTHS)).toBeUndefined();
    expect(requestedYm(["2026-10"], undefined, MONTHS)).toBeUndefined();
  });
  it("쿠키 문자열 — 1년, 사이트 전체, 꼴이 안 맞으면 쓰지 않음", () => {
    expect(lastYmCookieString("2026-10")).toBe("last-ym=2026-10; path=/; max-age=31536000; SameSite=Lax");
    expect(lastYmCookieString("x")).toBeNull();
  });
});

describe("돌아가기 (?from=) 표", () => {
  it("from 값마다 한 가지 문구·주소, 보던 달을 함께", () => {
    expect(backTo("closing", { ym: "2026-09" })).toEqual({ href: "/closing?ym=2026-09", label: "마감 · 상신으로 돌아가기" });
    expect(backTo("closing")).toEqual({ href: "/closing", label: "마감 · 상신으로 돌아가기" });
    // 예전 내 정산은 내 지출 내역(현황)에 합쳐졌다 — 그 화면으로 (현황 키 ym·scope)
    expect(backTo("settlement", { ym: "2026-09", scope: "all" })).toEqual({ href: "/dashboard?ym=2026-09&scope=all", label: "내 지출 내역으로 돌아가기" });
  });
  it("모르는 값·없음이면 null", () => {
    expect(backTo(undefined)).toBeNull();
    expect(backTo("toString")).toBeNull();
    expect(backTo(["closing"])).toBeNull();
  });
});
