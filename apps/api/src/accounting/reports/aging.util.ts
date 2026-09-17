export const AGING_BUCKETS = [
  'current',
  'days31to60',
  'days61to90',
  'over90',
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function daysOutstanding(asOf: Date, invoiceDate: Date): number {
  const ms = asOf.getTime() - invoiceDate.getTime();
  return Math.max(Math.floor(ms / 86_400_000), 0);
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
