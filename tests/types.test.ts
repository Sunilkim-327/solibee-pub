import { describe, expect, it } from "vitest";
import { parseClosingStatus, parsePayMethod, parseRole } from "@/lib/types";

describe("DB 문자열 → 열거형", () => {
  it("역할", () => {
    expect(parseRole("MANAGER")).toBe("MANAGER");
    expect(parseRole("BOSS")).toBeNull();
    expect(parseRole(null)).toBeNull();
  });
  it("결제방법", () => {
    expect(parsePayMethod("SHARED_CARD")).toBe("SHARED_CARD");
    expect(parsePayMethod("CASH")).toBeNull();
  });
  it("마감 상태: 없거나 알 수 없으면 작성중", () => {
    expect(parseClosingStatus("APPROVED")).toBe("APPROVED");
    expect(parseClosingStatus(undefined)).toBe("DRAFT");
    expect(parseClosingStatus("??")).toBe("DRAFT");
  });
});
