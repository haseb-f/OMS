import { FinancialTransactionType } from '@prisma/client';

/**
 * R22 (decision D4) — the voucher types beyond invoice settlement that live
 * on the SAME FinancialTransaction voucher and Posting Engine: other receipt
 * / other payment against an authorised counter-account, and an internal
 * transfer between two of the company's own cash / bank accounts. They are
 * authorised by the manual journal-entry permissions (their holders can
 * already post the same entry by hand), so only the dedicated
 * `financial-transactions/{other-receipts|other-payments|transfers}` routes
 * act on them — the generic receipt / payment / expense / refund routes
 * refuse them (`GENERIC_VOUCHER_TYPES`).
 */
export const OTHER_VOUCHER_TYPES = [
  FinancialTransactionType.OTHER_RECEIPT,
  FinancialTransactionType.OTHER_PAYMENT,
  FinancialTransactionType.INTERNAL_TRANSFER,
] as const;

export type OtherVoucherType = (typeof OTHER_VOUCHER_TYPES)[number];

/** Other receipt / other payment — the two types that carry a counter-account. */
export type CounterVoucherType = Exclude<OtherVoucherType, 'INTERNAL_TRANSFER'>;

/** Money direction of a counter-account voucher (`counter-accounts?direction=`). */
export type CounterDirection = 'IN' | 'OUT';

export function isOtherVoucherType(
  type: FinancialTransactionType,
): type is OtherVoucherType {
  return (OTHER_VOUCHER_TYPES as readonly FinancialTransactionType[]).includes(
    type,
  );
}

/** The types the generic voucher routes (receipts, payments, expenses, refunds) may act on. */
export const GENERIC_VOUCHER_TYPES: readonly FinancialTransactionType[] =
  Object.values(FinancialTransactionType).filter(
    (type) => !isOtherVoucherType(type),
  );

export function counterDirectionOf(type: CounterVoucherType): CounterDirection {
  return type === FinancialTransactionType.OTHER_RECEIPT ? 'IN' : 'OUT';
}

/** English document label (activity log, journal descriptions, errors). */
export const OTHER_VOUCHER_LABEL: Record<OtherVoucherType, string> = {
  OTHER_RECEIPT: 'Other Receipt',
  OTHER_PAYMENT: 'Other Payment',
  INTERNAL_TRANSFER: 'Internal Transfer',
};
