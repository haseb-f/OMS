import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * Enterprise-grade validation — mirrors `config/sales/customer-form.ts`
 * (same factory pattern for country-aware phone validation). `code` stays
 * optional at the field level: `SuppliersService.create` defaults it to the
 * minted `supplierNumber` when omitted (TASK-048), so Quick Create never
 * has to ask for one (UX Policy: never require a manually-typed code).
 */
export function buildSupplierSchema(
  countries: { id: string; code: string }[],
  t: (key: MessageKey) => string,
) {
  return z
    .object({
      code: z.string().optional().or(z.literal("")),
      name: z.string().min(1),
      commercialName: z.string().optional().or(z.literal("")),
      phone: z.string().optional().or(z.literal("")),
      mobile: z.string().optional().or(z.literal("")),
      email: z.string().email().optional().or(z.literal("")),
      website: z.string().optional().or(z.literal("")),
      taxNumber: z.string().optional().or(z.literal("")),
      commercialRegistration: z.string().optional().or(z.literal("")),
      currencyId: z.string().optional().or(z.literal("")),
      paymentTerm: z.string().optional().or(z.literal("")),
      creditLimit: z.number().min(0).optional().nullable(),
      countryId: z.string().optional().or(z.literal("")),
      city: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      notes: z.string().optional().or(z.literal("")),
      isPreferred: z.boolean().optional(),
    })
    .superRefine((values, ctx) => {
      const countryCode = countries.find((c) => c.id === values.countryId)?.code;
      for (const field of ["phone", "mobile"] as const) {
        const value = values[field];
        if (!value) continue;
        if (!isPhoneValidForCountry(value, countryCode)) {
          const reason = parsePhone(value, countryCode).errorReason;
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: phoneErrorMessage(reason, countryCode, t),
          });
        }
      }
    });
}

export const supplierDefaultValues = {
  code: "",
  name: "",
  commercialName: "",
  phone: "",
  mobile: "",
  email: "",
  website: "",
  taxNumber: "",
  commercialRegistration: "",
  currencyId: "",
  paymentTerm: "",
  creditLimit: null,
  countryId: "",
  city: "",
  address: "",
  notes: "",
  isPreferred: false,
};

/** Quick Create keeps only what a buyer needs to not lose the purchase mid-document — no Country field, so phone validation stays international-format-only. */
export function buildSupplierQuickCreateSchema(t: (key: MessageKey) => string) {
  return z
    .object({
      name: z.string().min(1),
      phone: z.string().optional().or(z.literal("")),
      email: z.string().email().optional().or(z.literal("")),
    })
    .superRefine((values, ctx) => {
      if (values.phone && !isPhoneValidForCountry(values.phone, undefined)) {
        const reason = parsePhone(values.phone, undefined).errorReason;
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: phoneErrorMessage(reason, undefined, t),
        });
      }
    });
}

export const supplierQuickCreateDefaultValues = {
  name: "",
  phone: "",
  email: "",
};
