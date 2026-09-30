import { apiErrorMessage, toast } from "@/lib/toast";

export interface BulkRunResult<T> {
  succeeded: T[];
  failed: { item: T; message: string }[];
}

/**
 * Runs a per-record server action over a bulk selection, one request at a
 * time (the server validates permission and status for each record and
 * rejects repeats, so a double click or retry can never apply one twice).
 * Never throws: every failure is collected with the server's own reason.
 */
export async function runBulkSequential<T>(
  items: readonly T[],
  action: (item: T) => Promise<unknown>,
): Promise<BulkRunResult<T>> {
  const result: BulkRunResult<T> = { succeeded: [], failed: [] };
  for (const item of items) {
    try {
      await action(item);
      result.succeeded.push(item);
    } catch (error) {
      result.failed.push({ item, message: apiErrorMessage(error) });
    }
  }
  return result;
}

/** How many failure reasons a partial-failure toast lists before "…". */
const LISTED_FAILURES = 3;

/**
 * Success / partial-failure feedback for `runBulkSequential`: all good → a
 * success toast; any failure → an error toast naming the first few records
 * and the server's reason for each, so the user knows exactly what is left.
 */
export function reportBulkResult<T>(
  result: BulkRunResult<T>,
  copy: {
    success: (count: number) => string;
    partial: (succeeded: number, failed: number) => string;
    label: (item: T) => string;
  },
) {
  if (result.failed.length === 0) {
    toast.success(copy.success(result.succeeded.length));
    return;
  }
  const listed = result.failed
    .slice(0, LISTED_FAILURES)
    .map(({ item, message }) => `${copy.label(item)}: ${message}`);
  if (result.failed.length > LISTED_FAILURES) listed.push("…");
  toast.error(copy.partial(result.succeeded.length, result.failed.length), {
    description: listed.join("\n"),
  });
}
