import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { messages } from "@/i18n/messages";
import { createZodErrorMap } from "./zod-error-map";

function applyLocale(locale: "ar" | "en") {
  z.config({
    ...(locale === "ar" ? z.locales.ar() : z.locales.en()),
    customError: createZodErrorMap(messages[locale]),
  });
}

function firstMessage(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected a failure");
  return result.error.issues[0]!.message;
}

describe("createZodErrorMap (R2-06)", () => {
  afterEach(() => {
    z.config({ ...z.locales.en(), customError: undefined });
  });

  it("ar: required, length, range and format", () => {
    applyLocale("ar");
    expect(firstMessage(z.string().min(1), "")).toBe("هذا الحقل مطلوب");
    expect(firstMessage(z.string(), undefined)).toBe("هذا الحقل مطلوب");
    expect(firstMessage(z.string().min(3), "a")).toBe("يجب ألا يقل عن 3 أحرف");
    expect(firstMessage(z.string().max(5), "abcdefg")).toBe("يجب ألا يزيد عن 5 حرفًا");
    expect(firstMessage(z.number().min(0), -1)).toBe("يجب أن تكون القيمة ≥ 0");
    expect(firstMessage(z.number().max(10), 11)).toBe("يجب أن تكون القيمة ≤ 10");
    expect(firstMessage(z.string().email(), "x")).toBe("صيغة غير صحيحة");
  });

  it("en: required and fallback to the locale message", () => {
    applyLocale("en");
    expect(firstMessage(z.string().min(1), "")).toBe("This field is required");
    expect(firstMessage(z.number().positive(), 0)).toBe("Must be > 0");
    // Not mapped → zod's own English locale text.
    expect(firstMessage(z.string(), 5)).toMatch(/expected string/i);
  });

  it("an explicit schema message still wins", () => {
    applyLocale("ar");
    expect(firstMessage(z.string().min(1, "custom"), "")).toBe("custom");
  });
});
