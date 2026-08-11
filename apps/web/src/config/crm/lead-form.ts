import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessageKey } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * Manual Leads/Orders entry (TASK-061). Customer Master matching/linking,
 * duplicate-order detection, and Auto Assignment all run server-side in
 * `LeadsService.create()` — this schema only validates shape, never
 * duplicates that logic.
 *
 * A factory (not a static object) because `mobileNumber` must validate
 * against whichever `countryId` the same submission carries — that needs
 * the live Country list (id -> ISO2 code) the page already fetches, which a
 * module-level schema can't see. `t` renders the phone error in the
 * OMSPhoneInput status icon's exact wording, translated (Arabic default).
 */
export function buildLeadSchema(
  countries: { id: string; code: string }[],
  t: (key: MessageKey) => string,
) {
  return z
    .object({
      customerName: z.string().min(1),
      mobileNumber: z.string().min(1),
      countryId: z.string().min(1, { message: "Country is required." }),
      city: z.string().min(1),
      address: z.string().min(1),
      quantity: z.number().min(1),
      currencyId: z.string().min(1, { message: "Currency is required." }),
      externalOrderId: z.string().optional().or(z.literal("")),
      salesEmployeeId: z.string().optional().or(z.literal("")),
      /** Not a form field — always MANUAL for this dialog (import sets EXCEL itself, server-side). */
      source: z.literal("MANUAL"),
    })
    .superRefine((values, ctx) => {
      const countryCode = countries.find((c) => c.id === values.countryId)?.code;
      if (!isPhoneValidForCountry(values.mobileNumber, countryCode)) {
        const reason = parsePhone(values.mobileNumber, countryCode).errorReason;
        ctx.addIssue({
          code: "custom",
          path: ["mobileNumber"],
          message: t(phoneErrorMessageKey(reason)),
        });
      }
    });
}

export const leadDefaultValues = {
  customerName: "",
  mobileNumber: "",
  countryId: "",
  city: "",
  address: "",
  quantity: 1,
  currencyId: "",
  externalOrderId: "",
  salesEmployeeId: "",
  source: "MANUAL" as const,
};
