import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * The dual-mode Lead/Order create dialog's own schema — deliberately
 * separate from `buildLeadSchema` (`lead-form.ts`), which is now edit-only.
 * Lead mode validates only name/phone/country (TASK-061 follow-up, Part 1);
 * Order mode additionally requires address/product/paid amount, enforced via
 * `.superRefine()` keyed on `recordType` so an untouched Order-only field
 * never raises a validation error while creating a plain Lead.
 */
export function buildLeadOrderCreateSchema(
  countries: { id: string; code: string }[],
  t: (key: MessageKey) => string,
) {
  return z
    .object({
      recordType: z.enum(["LEAD", "ORDER"]),
      customerName: z.string().min(1),
      mobileNumber: z.string().min(1),
      countryId: z.string().min(1, { message: "Country is required." }),
      city: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      productId: z.string().optional().or(z.literal("")),
      quantity: z.number().min(1).optional(),
      paidAmount: z.number().min(0).optional(),
      currencyId: z.string().optional().or(z.literal("")),
      externalOrderId: z.string().optional().or(z.literal("")),
      salesEmployeeId: z.string().optional().or(z.literal("")),
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

      if (values.recordType !== "ORDER") return;

      if (!values.address) {
        ctx.addIssue({ code: "custom", path: ["address"], message: "Address is required." });
      }
      if (!values.productId) {
        ctx.addIssue({ code: "custom", path: ["productId"], message: "Product is required." });
      }
      if (values.paidAmount === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["paidAmount"],
          message: "Paid amount is required.",
        });
      }
    });
}

export type LeadOrderCreateFormValues = {
  recordType: "LEAD" | "ORDER";
  customerName: string;
  mobileNumber: string;
  countryId: string;
  city?: string;
  address?: string;
  productId?: string;
  quantity?: number;
  paidAmount?: number;
  currencyId?: string;
  externalOrderId?: string;
  salesEmployeeId?: string;
  source: "MANUAL";
};

export const leadOrderCreateDefaultValues: LeadOrderCreateFormValues = {
  recordType: "LEAD",
  customerName: "",
  mobileNumber: "",
  countryId: "",
  city: "",
  address: "",
  productId: "",
  quantity: undefined,
  paidAmount: undefined,
  currencyId: "",
  externalOrderId: "",
  salesEmployeeId: "",
  source: "MANUAL",
};
