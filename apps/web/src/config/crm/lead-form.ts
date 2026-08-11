import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * Manual Leads/Orders **editing** (TASK-061). Creation now goes through the
 * dedicated `LeadOrderCreateDialog` (`lead-order-create-schema.ts`), whose
 * validation is recordType-aware (Lead vs Order need different minimum
 * fields) — this schema only governs the generic `MasterDataPage` edit
 * modal, reached after a record already exists, so every field it touches
 * is optional-completable rather than mandatory-at-creation. Customer
 * Master matching/linking, duplicate-order detection, and Auto Assignment
 * all run server-side in `LeadsService` — this schema only validates shape,
 * never duplicates that logic.
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
      city: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      productId: z.string().optional().or(z.literal("")),
      quantity: z.number().min(1).optional(),
      currencyId: z.string().optional().or(z.literal("")),
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
          message: phoneErrorMessage(reason, countryCode, t),
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
  productId: "",
  quantity: 1,
  currencyId: "",
  externalOrderId: "",
  salesEmployeeId: "",
  source: "MANUAL" as const,
};
