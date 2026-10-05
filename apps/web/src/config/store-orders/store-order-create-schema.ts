import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import { toISODate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/**
 * Manual "New Store Order" schema. The phone is validated against the
 * PHONE country (`getPhoneCountryCode` — the dialog's own phone-country
 * picker, which follows the shipping country until chosen explicitly), not
 * the shipping destination; without one it falls back to international
 * format. Line items stay a separate non-RHF array the dialog validates
 * itself — same shape ProductLineItemsGrid already uses.
 */
export function buildStoreOrderCreateSchema(
  t: (key: MessageKey) => string,
  getPhoneCountryCode: () => string | null | undefined = () => undefined,
) {
  return z
    .object({
      externalOrderId: z.string().optional().or(z.literal("")),
      customerName: z.string().min(1, t("common.required")),
      customerPhone: z.string().min(1, t("phone.errors.EMPTY")),
      customerEmail: z.string().email(t("auth.emailRequired")).optional().or(z.literal("")),
      countryId: z.string().optional().or(z.literal("")),
      deliveryCountryId: z.string().optional().or(z.literal("")),
      city: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      orderDate: z.string().optional().or(z.literal("")),
      currencyId: z.string().min(1, t("common.required")),
      paymentType: z.enum(["PREPAID", "CASH_ON_DELIVERY"]),
      fulfillmentMethod: z.enum(["SHIPPING", "PICKUP"]),
      notes: z.string().optional().or(z.literal("")),
      receiptName: z.string().optional().or(z.literal("")),
      receiptUrl: z.string().optional().or(z.literal("")),
    })
    .superRefine((values, ctx) => {
      const phoneCountryCode = getPhoneCountryCode();
      if (!isPhoneValidForCountry(values.customerPhone, phoneCountryCode)) {
        const reason = parsePhone(values.customerPhone, phoneCountryCode).errorReason;
        ctx.addIssue({
          code: "custom",
          path: ["customerPhone"],
          message: phoneErrorMessage(reason, phoneCountryCode, t),
        });
      }
    });
}

export type StoreOrderCreateFormValues = {
  externalOrderId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  /** The customer's country — proposes the calling code and the order currency. */
  countryId?: string;
  /** Only when the order is delivered to another country than the customer's. */
  deliveryCountryId?: string;
  city?: string;
  address?: string;
  orderDate?: string;
  currencyId: string;
  paymentType: "PREPAID" | "CASH_ON_DELIVERY";
  fulfillmentMethod: "SHIPPING" | "PICKUP";
  notes?: string;
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
    deliveryCountryId: "",
    city: "",
    address: "",
    orderDate: toISODate(new Date()),
    currencyId: "",
    paymentType: "PREPAID",
    fulfillmentMethod: "SHIPPING",
    notes: "",
    receiptName: "",
    receiptUrl: "",
  };
}
