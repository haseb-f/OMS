import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessageKey } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * Enterprise-grade validation: name required; phone/mobile stay optional at
 * the field level (the "prevent duplicate by phone/email" rule is enforced
 * server-side), but when supplied are validated against `countryId`'s real
 * numbering-plan rules via `libphonenumber-js` — not a generic character
 * regex. A factory (not a static object), like `buildLeadSchema`, because
 * that check needs the live Country id -> ISO2 list the page fetches.
 */
export function buildCustomerSchema(
  countries: { id: string; code: string }[],
  t: (key: MessageKey) => string,
) {
  return z
    .object({
      name: z.string().min(1),
      commercialName: z.string().optional().or(z.literal("")),
      phone: z.string().optional().or(z.literal("")),
      mobile: z.string().optional().or(z.literal("")),
      email: z.string().email().optional().or(z.literal("")),
      website: z.string().optional().or(z.literal("")),
      taxNumber: z.string().optional().or(z.literal("")),
      commercialRegistration: z.string().optional().or(z.literal("")),
      customerGroupId: z.string().optional().or(z.literal("")),
      currencyId: z.string().optional().or(z.literal("")),
      paymentTermId: z.string().optional().or(z.literal("")),
      creditLimit: z.number().min(0).optional().nullable(),
      countryId: z.string().optional().or(z.literal("")),
      city: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      notes: z.string().optional().or(z.literal("")),
    })
    .superRefine((values, ctx) => {
      const countryCode = countries.find((c) => c.id === values.countryId)?.code;
      for (const field of ["phone", "mobile"] as const) {
        const value = values[field];
        if (!value) continue;
        if (!isPhoneValidForCountry(value, countryCode)) {
          const reason = parsePhone(value, countryCode).errorReason;
          ctx.addIssue({ code: "custom", path: [field], message: t(phoneErrorMessageKey(reason)) });
        }
      }
    });
}

export const customerDefaultValues = {
  name: "",
  commercialName: "",
  phone: "",
  mobile: "",
  email: "",
  website: "",
  taxNumber: "",
  commercialRegistration: "",
  customerGroupId: "",
  currencyId: "",
  paymentTermId: "",
  creditLimit: null,
  countryId: "",
  city: "",
  address: "",
  notes: "",
};

/** Quick Create keeps only what a sales rep needs to not lose the sale mid-document — no Country field, so phone validation stays international-format-only (same rule `OMSPhoneInput` falls back to without a country). */
export function buildCustomerQuickCreateSchema(t: (key: MessageKey) => string) {
  return z
    .object({
      name: z.string().min(1),
      phone: z.string().optional().or(z.literal("")),
      email: z.string().email().optional().or(z.literal("")),
    })
    .superRefine((values, ctx) => {
      if (values.phone && !isPhoneValidForCountry(values.phone, undefined)) {
        const reason = parsePhone(values.phone, undefined).errorReason;
        ctx.addIssue({ code: "custom", path: ["phone"], message: t(phoneErrorMessageKey(reason)) });
      }
    });
}

export const customerQuickCreateDefaultValues = {
  name: "",
  phone: "",
  email: "",
};
