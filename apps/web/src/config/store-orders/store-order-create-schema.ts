import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import { toISODate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/**
 * Manual "New Store Order" schema. Phone stays international-format (same
 * fallback OMSPhoneInput uses without a country) so existing validation is
 * unchanged. Line items stay a separate non-RHF array the dialog validates
 * itself — same shape ProductLineItemsGrid already uses.
 */
export function buildStoreOrderCreateSchema(t: (key: MessageKey) => string) {
  return z
    .object({
      externalOrderId: z.string().optional().or(z.literal("")),
      customerName: z.string().min(1, t("common.required")),
      customerPhone: z.string().min(1, t("phone.errors.EMPTY")),
      customerEmail: z.string().email(t("auth.emailRequired")).optional().or(z.literal("")),
      countryId: z.string().optional().or(z.literal("")),
      city: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      orderDate: z.string().optional().or(z.literal("")),
      currencyId: z.string().min(1, t("common.required")),
      notes: z.string().optional().or(z.literal("")),
      paymentAmount: z.number().optional(),
      senderName: z.string().optional().or(z.literal("")),
      receiptName: z.string().optional().or(z.literal("")),
      receiptUrl: z.string().optional().or(z.literal("")),
    })
    .superRefine((values, ctx) => {
      if (!isPhoneValidForCountry(values.customerPhone, undefined)) {
        const reason = parsePhone(values.customerPhone, undefined).errorReason;
        ctx.addIssue({
          code: "custom",
          path: ["customerPhone"],
          message: phoneErrorMessage(reason, undefined, t),
        });
      }
    });
}

export type StoreOrderCreateFormValues = {
  externalOrderId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  countryId?: string;
  city?: string;
  address?: string;
  orderDate?: string;
  currencyId: string;
  notes?: string;
  paymentAmount?: number;
  senderName?: string;
  receiptName?: string;
  receiptUrl?: string;
};

/** A function (not a static object) so every dialog open gets "today" fresh, not the module's load-time date. */
export function storeOrderCreateDefaultValues(): StoreOrderCreateFormValues {
  return {
    externalOrderId: "",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    countryId: "",
    city: "",
    address: "",
    orderDate: toISODate(new Date()),
    currencyId: "",
    notes: "",
    paymentAmount: undefined,
    senderName: "",
    receiptName: "",
    receiptUrl: "",
  };
}
