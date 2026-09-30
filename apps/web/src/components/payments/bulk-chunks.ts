import type { BulkItemFailure, BulkItemsResult } from "@/services/payments-review-service";

/**
 * Sends a large payment bulk action as several small requests (the server
 * takes a bounded batch and processes it item by item inside one function
 * call) and merges the per-item results in order. A request that fails as a
 * whole marks each of its ids failed with that reason, so nothing is ever
 * silently counted as done; the remaining chunks still run.
 */
export async function runInChunks<T, S>(
  items: readonly T[],
  chunkSize: number,
  send: (chunk: T[]) => Promise<BulkItemsResult<S>>,
  options: {
    idOf: (item: T) => string;
    onProgress?: (done: number, total: number) => void;
    requestFailed: (message: string) => string;
    errorMessage: (error: unknown) => string;
  },
): Promise<BulkItemsResult<S>> {
  const size = Math.max(1, Math.floor(chunkSize));
  const merged: BulkItemsResult<S> = { succeeded: [], failed: [] };
  options.onProgress?.(0, items.length);
  for (let start = 0; start < items.length; start += size) {
    const chunk = items.slice(start, start + size);
    try {
      const result = await send(chunk);
      merged.succeeded.push(...result.succeeded);
      merged.failed.push(...result.failed);
    } catch (error) {
      const message = options.requestFailed(options.errorMessage(error));
      merged.failed.push(
        ...chunk.map<BulkItemFailure>((item) => ({
          id: options.idOf(item),
          code: "REQUEST_FAILED",
          message,
        })),
      );
    }
    options.onProgress?.(Math.min(start + size, items.length), items.length);
  }
  return merged;
}
