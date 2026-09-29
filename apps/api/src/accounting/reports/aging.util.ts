import {
  businessDateOf,
  calendarDaysBetween,
} from '../../common/time/business-date';

export const AGING_BUCKETS = [
  'current',
  'days31to60',
  'days61to90',
  'over90',
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

/**
 * Whole business days (Africa/Cairo calendar days) from the invoice date to
 * the as-of date — an invoice confirmed at 00:30 Cairo on 1 Oct is 0 days
 * old on 1 Oct and 30 days old on 31 Oct, whatever the UTC clock says.
 */
export function daysOutstanding(asOf: Date, invoiceDate: Date): number {
  return Math.max(
    calendarDaysBetween(businessDateOf(invoiceDate), businessDateOf(asOf)),
    0,
  );
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 30) return 'current';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  return 'over90';
}

export function emptyAgingBuckets(): Record<AgingBucket, number> {
  return { current: 0, days31to60: 0, days61to90: 0, over90: 0 };
}
