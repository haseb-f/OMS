/**
 * TASK-047 — the one `createdAt` range filter shared by all four Sales
 * documents' `findAll`, matching the same column their list's "Date" column
 * already displays (none of Order/Invoice/Return has its own `documentDate`
 * field — only Quotation does — so `createdAt` is the one date every
 * document type actually has).
 */

import type { Prisma } from '@prisma/client';

const END_OF_DAY_MS = 24 * 60 * 60 * 1000 - 1;

export function buildDateRangeFilter(
  dateFrom?: string,
  dateTo?: string,
): Prisma.DateTimeFilter {
  const filter: Prisma.DateTimeFilter = {};
  if (dateFrom) {
    filter.gte = new Date(dateFrom);
  }
  if (dateTo) {
    filter.lte = new Date(new Date(dateTo).getTime() + END_OF_DAY_MS);
  }
  return filter;
}
