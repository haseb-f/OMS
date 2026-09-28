/** Rows per request when paging through a list endpoint for a full-dataset job (print). */
export const FETCH_ALL_PAGE_SIZE = 200;
/** Upper bound on rows a single full-dataset job pulls — the sheet states "N / M rows" beyond it. */
export const FETCH_ALL_ROW_CAP = 5000;

export interface FetchAllPagesResult<T> {
  rows: T[];
  /** Rows the source holds in total — larger than `rows.length` when the cap was hit. */
  total: number;
}

/**
 * Pages through a server-paged list endpoint (1-based `page`) until every
 * matching row is loaded or `cap` is reached. The caller's `fetchPage` must
 * send the page's CURRENT search/filters/sort — only page/pageSize vary here.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
  { pageSize = FETCH_ALL_PAGE_SIZE, cap = FETCH_ALL_ROW_CAP } = {},
): Promise<FetchAllPagesResult<T>> {
  const rows: T[] = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(page, pageSize);
    total = result.total;
    rows.push(...result.items);
    // Stop on the last page, a short/empty page (guards a stale total), or the cap.
    if (rows.length >= total || result.items.length < pageSize || rows.length >= cap) break;
  }
  return { rows: rows.slice(0, cap), total: Math.max(total, rows.length) };
}
