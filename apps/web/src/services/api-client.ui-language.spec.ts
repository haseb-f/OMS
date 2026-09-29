import { describe, expect, it } from "vitest";
import { uiLanguagePart } from "./api-client";

describe("uiLanguagePart — bilingual server messages", () => {
  const msg = "حسابات الوكلاء غير مُعدّة في إعدادات المحاسبة — Agent accounts are not configured.";

  it("shows the Arabic half in the Arabic UI and the English half in the English UI", () => {
    expect(uiLanguagePart(msg, "ar")).toBe("حسابات الوكلاء غير مُعدّة في إعدادات المحاسبة");
    expect(uiLanguagePart(msg, "en")).toBe("Agent accounts are not configured.");
  });

  it("handles a dash inside the Arabic half", () => {
    const m =
      "المبلغ — يتجاوز المحصل غير المسترد (0.00) — Amount exceeds the unrefunded collected amount (0.00).";
    expect(uiLanguagePart(m, "en")).toBe("Amount exceeds the unrefunded collected amount (0.00).");
    expect(uiLanguagePart(m, "ar")).toBe("المبلغ — يتجاوز المحصل غير المسترد (0.00)");
  });

  it("never shows an English-only message in the Arabic UI", () => {
    expect(uiLanguagePart("Agent accounts are not configured.", "ar")).toBeUndefined();
    expect(uiLanguagePart("Agent accounts are not configured.", "en")).toBe(
      "Agent accounts are not configured.",
    );
    expect(uiLanguagePart(undefined, "ar")).toBeUndefined();
  });
});
