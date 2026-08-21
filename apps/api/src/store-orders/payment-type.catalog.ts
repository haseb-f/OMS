import { StoreOrderPaymentType } from '@prisma/client';

/**
 * Fixed Payment Type catalog — not master data, not financial confirmation.
 *
 * PREPAID = expected to be paid before fulfillment (Finance still confirms).
 * CASH_ON_DELIVERY = expected to be collected through shipping (Finance still
 * confirms the real collection). Do not add values or an admin CRUD page.
 */
export const PAYMENT_TYPE_CATALOG = [
  {
    code: StoreOrderPaymentType.PREPAID,
    label: 'دفع مسبق',
  },
  {
    code: StoreOrderPaymentType.CASH_ON_DELIVERY,
    label: 'الدفع عند الاستلام',
  },
] as const;

export type PaymentTypeCode = (typeof PAYMENT_TYPE_CATALOG)[number]['code'];

export const PAYMENT_TYPE_SHEET_LABELS: Record<StoreOrderPaymentType, string> =
  Object.fromEntries(
    PAYMENT_TYPE_CATALOG.map((type) => [type.code, type.label]),
  ) as Record<StoreOrderPaymentType, string>;

export const PAYMENT_TYPE_CODES: StoreOrderPaymentType[] =
  PAYMENT_TYPE_CATALOG.map((type) => type.code);

/**
 * Accepts the stable code (`PREPAID`) or the List Sheet Arabic label.
 * Returns null for unknown / arbitrary values.
 */
export function resolvePaymentType(
  raw: string | undefined,
): StoreOrderPaymentType | null {
  const value = raw?.trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  for (const type of PAYMENT_TYPE_CATALOG) {
    if (type.code === upper || type.label === value) {
      return type.code;
    }
  }
  return null;
}
