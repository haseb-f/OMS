import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api-client";
import { apiErrorMessage, reportApiError, reportSuccess, toast } from "./toast";
import { messages } from "@/i18n/messages";
import { STORAGE_KEYS } from "@/constants/storage-keys";

describe("apiErrorMessage", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the ApiError's localized server message when present", () => {
    const error = new ApiError(400, "لا يمكن إلغاء فاتورة مرحّلة.", "VALIDATION_ERROR");
    expect(apiErrorMessage(error, "errors.cancelFailed", "ar")).toBe(
      "لا يمكن إلغاء فاتورة مرحّلة.",
    );
  });

  it("translates an i18n-key fallback in the requested locale", () => {
    expect(apiErrorMessage(new Error("boom"), "errors.loadFailed", "ar")).toBe(
      messages.ar.errors.loadFailed,
    );
    expect(apiErrorMessage(new Error("boom"), "errors.loadFailed", "en")).toBe(
      messages.en.errors.loadFailed,
    );
  });

  it("never leaks a raw JS error message and defaults to the generic text", () => {
    expect(apiErrorMessage(new TypeError("Failed to fetch"), undefined, "ar")).toBe(
      messages.ar.errors.generic,
    );
  });

  it("falls back when an ApiError carries an empty message", () => {
    expect(apiErrorMessage(new ApiError(500, "  "), "errors.saveFailed", "en")).toBe(
      messages.en.errors.saveFailed,
    );
  });

  it("keeps an already-translated fallback string as-is", () => {
    expect(apiErrorMessage(null, "تعذر الحفظ", "en")).toBe("تعذر الحفظ");
  });

  it("uses the persisted UI locale by default (Arabic first)", () => {
    expect(apiErrorMessage(null, "errors.generic")).toBe(messages.ar.errors.generic);
    window.localStorage.setItem(STORAGE_KEYS.locale, JSON.stringify("en"));
    expect(apiErrorMessage(null, "errors.generic")).toBe(messages.en.errors.generic);
  });

  it("reportApiError raises exactly one error toast with the resolved text", () => {
    const spy = vi.spyOn(toast, "error").mockImplementation(() => 1);
    reportApiError(new Error("x"), "errors.printFailed");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(messages.ar.errors.printFailed);
  });
});

describe("reportSuccess", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows a plain success toast with the default duration when there is no link", () => {
    const spy = vi.spyOn(toast, "success").mockImplementation(() => 1);
    reportSuccess("Saved");
    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0][1] ?? {};
    expect(options.action).toBeUndefined();
    expect("duration" in options).toBe(false);
  });

  it('adds an "Open record" action that navigates to the resulting record', () => {
    const spy = vi.spyOn(toast, "success").mockImplementation(() => 1);
    const navigate = vi.fn();
    reportSuccess("Saved", { href: "/sales/customer-groups?edit=42", navigate });
    const action = spy.mock.calls[0][1]?.action as { label: string; onClick: () => void };
    expect(action.label).toBe(messages.ar.feedback.success.openRecord);
    action.onClick();
    expect(navigate).toHaveBeenCalledWith("/sales/customer-groups?edit=42");
    expect(spy.mock.calls[0][1]?.duration).toBe(8000);
  });
});
