import { HttpException, HttpStatus, Logger } from '@nestjs/common';

/**
 * Per-item outcome of a bulk action that runs every record through its
 * existing single-record service (one transaction per item): the batch never
 * aborts on one bad record, and every failure keeps the server's own reason.
 */
export interface BulkItemFailure {
  id: string;
  /** Stable machine code: a domain code (e.g. `ALREADY_POSTED`) or the HTTP status name (`CONFLICT`). */
  code: string;
  message: string;
}

export interface BulkItemsResult<S> {
  succeeded: S[];
  failed: BulkItemFailure[];
}

/** A per-item refusal decided by the bulk layer itself (before calling the service). */
export class BulkItemError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BulkItemError';
  }
}

const logger = new Logger('BulkItems');

/** Keeps the first occurrence of every id, in the caller's order. */
export function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function bulkFailure(id: string, error: unknown): BulkItemFailure {
  if (error instanceof BulkItemError) {
    return { id, code: error.code, message: error.message };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code =
      (HttpStatus[status] as string | undefined) ?? `HTTP_${String(status)}`;
    return { id, code, message: error.message };
  }
  // Never leak driver/ORM internals to the client; the log keeps the detail.
  logger.error(
    `Bulk item ${id} failed unexpectedly`,
    error instanceof Error ? error.stack : String(error),
  );
  return {
    id,
    code: 'INTERNAL_ERROR',
    message: 'Unexpected error — nothing was changed for this record.',
  };
}

/**
 * Runs `action` for every (de-duplicated) id, strictly one after another —
 * each call opens its own transaction and takes its own row locks, so a
 * failing record never rolls back or blocks the others.
 */
export async function runPerItem<S>(
  ids: readonly string[],
  action: (id: string) => Promise<S>,
): Promise<BulkItemsResult<S>> {
  const result: BulkItemsResult<S> = { succeeded: [], failed: [] };
  for (const id of dedupeIds(ids)) {
    try {
      result.succeeded.push(await action(id));
    } catch (error) {
      result.failed.push(bulkFailure(id, error));
    }
  }
  return result;
}
