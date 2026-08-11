import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import { toISODate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/**
 * The manual "New Store Order" dialog's own schema — mirrors
 * `buildCustomerQuickCreateSchema` (`sales/customer-form.ts`): no Country
 * field here either, so the phone is validated international-format-only
 * (same fallback `OMSPhoneInput` itself uses without a country). Line items
 * are NOT part of this schema — they're a separate, non-RHF array the
 * dialog validates itself (same "external state + onChange" shape
 * `ProductLineItemsGrid` already uses elsewhere), since react-hook-form has
 * no existing repeated-row precedent in this codebase to reuse.
 */
export function buildStoreOrderCreateSchema(t: (key: MessageKey) => string) {
  return z
    .object({
      externalOrderId: z.string().optional().or(z.literal("")),
      customerName: z.string().min(1),
      customerPhone: z.string().min(1),
      customerEmail: z.string().email().optional().or(z.literal("")),
      orderDate: z.string().optional().or(z.literal("")),
      currencyId: z.string().min(1),
      notes: z.string().optional().or(z.literal("")),
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
  orderDate?: string;
  currencyId: string;
  notes?: string;
};

/** A function (not a static object) so every dialog open gets "today" fresh, not the module's load-time date. */
export function storeOrderCreateDefaultValues(): StoreOrderCreateFormValues {
  return {
    externalOrderId: "",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    orderDate: toISODate(new Date()),
    currencyId: "",
    notes: "",
  };
}
