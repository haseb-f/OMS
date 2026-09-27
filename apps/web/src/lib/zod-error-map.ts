import * as z from "zod";
import type { Messages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";

/**
 * Friendly schema messages layered over zod's locale error map (R2-06): a
 * bare `.min(1)` must read «هذا الحقل مطلوب», not zod's generic
 * «أصغر من اللازم: يفترض لـ string أن يكون >= 1 حرف». Returning `undefined`
 * falls through to the locale's own message (`config.localeError`).
 */
export function createZodErrorMap(dict: Messages): z.core.$ZodErrorMap {
  const say = (key: Parameters<typeof translate>[1], n?: number | bigint) =>
    translate(dict, key, n === undefined ? undefined : { n: String(n) });

  return (issue) => {
    switch (issue.code) {
      case "invalid_type":
        return issue.input === undefined || issue.input === null
          ? say("feedback.validation.required")
          : undefined;
      case "too_small":
        if (issue.origin === "string") {
          return Number(issue.minimum) <= 1
            ? say("feedback.validation.required")
            : say("feedback.validation.minLength", issue.minimum);
        }
        if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
          return say(
            issue.inclusive === false
              ? "feedback.validation.minValueExclusive"
              : "feedback.validation.minValue",
            issue.minimum,
          );
        }
        return undefined;
      case "too_big":
        if (issue.origin === "string") {
          return say("feedback.validation.maxLength", issue.maximum);
        }
        if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
          return say(
            issue.inclusive === false
              ? "feedback.validation.maxValueExclusive"
              : "feedback.validation.maxValue",
            issue.maximum,
          );
        }
        return undefined;
      case "invalid_format":
        return say("feedback.validation.invalidFormat");
      default:
        return undefined;
    }
  };
}
