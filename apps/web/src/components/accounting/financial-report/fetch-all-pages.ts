/**
 * Upper bound on the pages a paged report fetches for print / export. At the
 * report page sizes (100 accounts or entries per page) that is 10,000 rows —
 * far past anything a printout stays readable at — and it keeps a runaway
 * `total` (or a server that ignores `page`) from looping forever.
 */
export const MAX_REPORT_PAGES = 100;

/**
 * Fetches every page of a paged report with the same filters, in order,
 * until `total` rows are in hand (or a short / empty page, or the
 * `MAX_REPORT_PAGES` cap). Print and Excel/CSV use it so a paged report
 * (General Ledger, Journal Report) outputs the complete dataset, never just
 * the page on screen.
 */
export async function fetchAllReportPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total?: number | null }>,
  pageSize: number,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_REPORT_PAGES; page += 1) {
    const result = await fetchPage(page);
    all.push(...result.items);
    const total = result.total ?? all.length;
    if (result.items.length < pageSize || all.length >= total) break;
  }
  return all;
}
