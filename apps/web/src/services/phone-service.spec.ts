import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PHONE_COUNTRY,
  defaultPhoneCountry,
  formatPhoneForDisplay,
  getPhonePlaceholder,
  normalizePhoneDigits,
  parsePhone,
  phoneCountryOrDefault,
  phoneInputDisplayValue,
  preparePhoneInput,
  resolvePastedPhone,
} from "./phone-service";

describe("phone-service normalization", () => {
  it("converts Arabic-Indic and Extended (Persian) digits to ASCII", () => {
    expect(normalizePhoneDigits("٠٥٠١٢٣٤٥٦٧")).toBe("0501234567");
    expect(normalizePhoneDigits("۰۵۰۱۲۳۴۵۶۷")).toBe("0501234567");
    expect(parsePhone("٠٥٠١٢٣٤٥٦٧", "SA").e164).toBe("+966501234567");
    expect(parsePhone("۰۵۰۱۲۳۴۵۶۷", "SA").e164).toBe("+966501234567");
    expect(parsePhone("+٢٠١٠١٢٣٤٥٦٧٨", "EG").e164).toBe("+201012345678");
  });

  it("strips spaces, hyphens, parentheses, dots and bidi marks", () => {
    expect(preparePhoneInput("(050) 123-45.67")).toBe("0501234567");
    expect(parsePhone("‎+966 50-123 4567‏", "SA").e164).toBe("+966501234567");
    expect(parsePhone("050 123 4567", "SA").e164).toBe("+966501234567");
  });

  it("treats a leading 00 as the international prefix", () => {
    expect(preparePhoneInput("00966501234567")).toBe("+966501234567");
    expect(parsePhone("00966501234567", "SA").e164).toBe("+966501234567");
    expect(parsePhone("00201012345678", "EG").e164).toBe("+201012345678");
  });

  it("never duplicates a calling code the selected country already implies", () => {
    expect(parsePhone("966501234567", "SA").e164).toBe("+966501234567");
    expect(parsePhone("+966501234567", "SA").e164).toBe("+966501234567");
    expect(parsePhone("201012345678", "EG").e164).toBe("+201012345678");
    expect(parsePhone("447400123456", "GB").e164).toBe("+447400123456");
  });

  it("handles the national trunk prefix via the library (EG 010, SA 05, GB 07)", () => {
    expect(parsePhone("01012345678", "EG").e164).toBe("+201012345678");
    expect(parsePhone("1012345678", "EG").e164).toBe("+201012345678");
    expect(parsePhone("0501234567", "SA").e164).toBe("+966501234567");
    expect(parsePhone("501234567", "SA").e164).toBe("+966501234567");
    expect(parsePhone("07400123456", "GB").e164).toBe("+447400123456");
  });

  it("reports incomplete numbers with a length reason, never an invented value", () => {
    const short = parsePhone("05012", "SA");
    expect(short.isValid).toBe(false);
    expect(short.e164).toBeNull();
    expect(short.errorReason).toBe("TOO_SHORT");
    expect(parsePhone("", "SA").errorReason).toBe("EMPTY");
    expect(parsePhone("abc", "SA").errorReason).toBe("NOT_A_NUMBER");
  });
});

describe("phone-service country conflicts", () => {
  it("flags a pasted foreign number (+20 while Saudi Arabia is selected) without rewriting it", () => {
    const result = parsePhone("+201012345678", "SA");
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe("+201012345678");
    expect(result.detectedRegion).toBe("EG");
    expect(result.regionMismatch).toBe(true);
  });

  it("never reinterprets a bare national digit string as a foreign number", () => {
    // "5012345678" is a mistyped Saudi number, not Belize "+501 2345678".
    const result = parsePhone("5012345678", "SA");
    expect(result.isValid).toBe(false);
    expect(result.e164).toBeNull();
    expect(result.regionMismatch).toBe(false);
  });

  it("accepts a number of another region sharing the calling code (library determination)", () => {
    const us = parsePhone("2025550123", "CA");
    expect(us.isValid).toBe(true);
    expect(us.e164).toBe("+12025550123");
    expect(us.detectedRegion).toBe("US");
    expect(us.regionMismatch).toBe(false);
    expect(us.sharedCallingCode).toBe(true);

    const kz = parsePhone("+77012345678", "RU");
    expect(kz.e164).toBe("+77012345678");
    expect(kz.detectedRegion).toBe("KZ");
    expect(kz.regionMismatch).toBe(false);

    const gg = parsePhone("07781123456", "GB");
    expect(gg.e164).toBe("+447781123456");
    expect(gg.regionMismatch).toBe(false);
  });

  it("country changed after a number was committed: the stored E.164 keeps its meaning and the conflict is reported", () => {
    const committed = parsePhone("0501234567", "SA").e164;
    expect(committed).toBe("+966501234567");
    const afterChange = parsePhone(committed, "EG");
    expect(afterChange.e164).toBe("+966501234567");
    expect(afterChange.detectedRegion).toBe("SA");
    expect(afterChange.regionMismatch).toBe(true);
    // Shown in full international form next to the "+20" addon, never as "501234567".
    expect(phoneInputDisplayValue(committed, "EG")).toBe("+966 50 123 4567");
  });
});

describe("phone-service paste handling", () => {
  it("strips a pasted number of the selected country to its national part", () => {
    expect(resolvePastedPhone("+966 50 123 4567", "SA")).toEqual({
      kind: "national",
      display: "50 123 4567",
      e164: "+966501234567",
    });
    expect(resolvePastedPhone("00966501234567", "SA")).toMatchObject({ e164: "+966501234567" });
    expect(resolvePastedPhone("966501234567", "SA")).toMatchObject({
      kind: "national",
      e164: "+966501234567",
    });
  });

  it("keeps a pasted foreign number as-is and reports its country", () => {
    expect(resolvePastedPhone("+20 10 1234 5678", "SA")).toEqual({
      kind: "foreign",
      display: "+20 10 12345678",
      e164: "+201012345678",
      detectedRegion: "EG",
    });
  });

  it("lets partial pastes through untouched", () => {
    expect(resolvePastedPhone("0501", "SA")).toEqual({ kind: "raw" });
  });
});

describe("phone-service display", () => {
  it("builds a grouped national placeholder from library metadata", () => {
    expect(getPhonePlaceholder("SA")).toBe("51 234 5678");
    expect(getPhonePlaceholder("GB")).toBe("7400 123456");
    expect(getPhonePlaceholder(null)).toBeNull();
  });

  it("formats stored values for read-only display and leaves legacy text untouched", () => {
    expect(formatPhoneForDisplay("+966501234567")).toBe("+966 50 123 4567");
    expect(formatPhoneForDisplay("0501234567", "SA")).toBe("+966 50 123 4567");
    expect(formatPhoneForDisplay("call after 5pm")).toBe("call after 5pm");
    expect(formatPhoneForDisplay(null)).toBe("");
  });
});

describe("phone-service default country (owner decision O2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("defaults a new entry to Saudi Arabia, ignoring the browser region and the last-used country", () => {
    vi.stubGlobal("navigator", { ...navigator, languages: ["ar-EG", "en-GB"], language: "ar-EG" });
    window.localStorage.setItem("oms.lastPhoneCountry", "EG");
    expect(DEFAULT_PHONE_COUNTRY).toBe("SA");
    expect(defaultPhoneCountry(["EG", "GB", "SA"])).toBe("SA");
    expect(defaultPhoneCountry()).toBe("SA");
  });

  it("returns null when the form does not offer Saudi Arabia", () => {
    expect(defaultPhoneCountry(["EG", "AE"])).toBeNull();
  });

  it("keeps the country the user picked and falls back to SA otherwise", () => {
    expect(phoneCountryOrDefault("EG")).toBe("EG");
    expect(phoneCountryOrDefault(null)).toBe("SA");
    expect(phoneCountryOrDefault("")).toBe("SA");
    // A national Saudi mobile typed with no country selected parses as +966.
    expect(parsePhone("0501234567", phoneCountryOrDefault(null)).e164).toBe("+966501234567");
  });
});
