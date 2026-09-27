import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError, isInUiLanguage } from "./api-client";
import { messages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import type { Locale } from "@/i18n/locales";

/**
 * R2-01 — a DUPLICATE's raw server text is shown only when it is already in
 * the UI language; otherwise the localized field template / generic key.
 */
function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

function setLocale(locale: Locale) {
  window.localStorage.setItem(STORAGE_KEYS.locale, JSON.stringify(locale));
}

async function captureError(): Promise<ApiError> {
  try {
    await apiClient.post("/master-data/x", {});
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the request to fail");
}

const MASTER_DATA_EN = "Payment method with this code already exists.";
const COUNTRY_AR =
  'الدولة "EG — مصر" موجودة مسبقًا لكنها مؤرشفة. اعرض المؤرشف واستعدها بدلًا من إنشاء دولة جديدة.';

describe("api-client DUPLICATE messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("ar: an English master-data duplicate gets the localized field template", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLocale("ar");
    mockResponse(409, {
      code: "DUPLICATE",
      message: MASTER_DATA_EN,
      fields: [{ field: "code", constraints: ["unique"] }],
    });
    const error = await captureError();
    expect(error.message).toBe(
      translate(messages.ar, "errors.DUPLICATE_FIELD", {
        field: (messages.ar.errors.fields as Record<string, string>).code,
      }),
    );
  });

  it("ar: an English duplicate without fields gets the generic key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLocale("ar");
    mockResponse(409, { code: "DUPLICATE", message: "Order with this number already exists." });
    const error = await captureError();
    expect(error.message).toBe(messages.ar.errors.DUPLICATE);
  });

  it("ar: authored Arabic guidance (countries) is shown verbatim", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLocale("ar");
    mockResponse(400, {
      code: "DUPLICATE",
      message: COUNTRY_AR,
      fields: [{ field: "code", constraints: ["unique"] }],
    });
    const error = await captureError();
    expect(error.message).toBe(COUNTRY_AR);
  });

  it("en: the generic unique-constraint fallback gets the field template", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLocale("en");
    mockResponse(409, {
      code: "DUPLICATE",
      message: "A record with this code already exists.",
      fields: [{ field: "code", constraints: ["unique"] }],
    });
    const error = await captureError();
    expect(error.message).toBe(
      translate(messages.en, "errors.DUPLICATE_FIELD", {
        field: (messages.en.errors.fields as Record<string, string>).code,
      }),
    );
  });

  it("en: specific English guidance is shown verbatim", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLocale("en");
    mockResponse(409, { code: "DUPLICATE", message: MASTER_DATA_EN, fields: [] });
    const error = await captureError();
    expect(error.message).toBe(MASTER_DATA_EN);
  });

  it("classifies script per locale", () => {
    expect(isInUiLanguage(COUNTRY_AR, "ar")).toBe(true);
    expect(isInUiLanguage(MASTER_DATA_EN, "ar")).toBe(false);
    expect(isInUiLanguage(COUNTRY_AR, "en")).toBe(false);
    expect(isInUiLanguage("A record with this code already exists.", "en")).toBe(false);
    expect(isInUiLanguage(undefined, "en")).toBe(false);
  });
});
