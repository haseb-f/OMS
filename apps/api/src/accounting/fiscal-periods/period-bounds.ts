const DAY_MS = 86_400_000;

/**
 * Accounting Periods and Fiscal Years store `endDate` as the START of their
 * last day (midnight — server-local for generated monthly periods, UTC for
 * DTO dates). Comparing a posting instant with `endDate: { gte: instant }`
 * therefore missed every posting made during the last day (e.g. 30 Sep
 * 10:00 > 30 Sep 00:00), so a Closed period/year silently accepted it.
 *
 * An instant belongs to the latest-starting range with `startDate <= instant`
 * as long as it falls before that range's last day ends
 * (`instant < endDate + 24h`). Picking the latest start keeps adjacent ranges
 * unambiguous even when an `endDate` was stored as end-of-day.
 */
export function coversInstant(
  range: { endDate: Date },
  instant: Date,
): boolean {
  return instant.getTime() < range.endDate.getTime() + DAY_MS;
}

/** Prisma `where`/`orderBy` pair for "the range that may contain this instant"; confirm with `coversInstant`. */
export function candidateRangeQuery(instant: Date) {
  return {
    where: { startDate: { lte: instant } },
    orderBy: { startDate: 'desc' as const },
  };
}

/** Exclusive upper bound for "dated within this range" queries. */
export function exclusiveEnd(range: { endDate: Date }): Date {
  return new Date(range.endDate.getTime() + DAY_MS);
}
