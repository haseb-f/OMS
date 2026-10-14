import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "./api-client";
import { messages } from "@/i18n/messages";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import type { Locale } from "@/i18n/locales";

/**
 * R22 — the settlement / voucher business codes (streams P / T) reach the user
 * as an actionable sentence in the UI language, never the server's English text.
 */
const CODES = [
  "ALLOCATION_EXCEEDS_INVOICE_BALANCE",
  "FEE_EXCEEDS_AMOUNT",
  "INVOICE_ARCHIVE_SETTLEMENT",
  "TRANSFER_CROSS_CURRENCY",
  "COUNTER_ACCOUNT_NOT_ALLOWED",
  "VOUCHER_DATE_IN_FUTURE",
  "REFUND_EXCEEDS_RECEIPT_UNAPPLIED",
  "RECEIPT_REFUNDED",
] as const;

async function failWith(locale: Locale, status: number, code: string): Promise<ApiError> {
  window.localStorage.setItem(STORAGE_KEYS.locale, JSON.stringify(locale));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ code, message: "Some English detail." }), { status }),
    ),
  );
  try {
    await apiClient.post("/financial-transactions/transfers/confirmed", {});
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the request to fail");
}

describe("api-client R22 business codes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it.each(CODES)("%s has an Arabic and an English sentence", (code) => {
    expect((messages.ar.errors as unknown as Record<string, string>)[code]).toMatch(/[؀-ۿ]/);
    expect((messages.en.errors as unknown as Record<string, string>)[code]).toBeTruthy();
  });

  it("an Arabic UI shows the Arabic sentence for a refused cross-currency transfer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await failWith("ar", 422, "TRANSFER_CROSS_CURRENCY");
    expect(error.message).toBe(
      (messages.ar.errors as unknown as Record<string, string>).TRANSFER_CROSS_CURRENCY,
    );
  });
});
