import { apiErrorMessage, toast } from "@/lib/toast";
import { currentLocale } from "@/services/api-client";
import { messages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";
import type { Locale } from "@/i18n/locales";

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

/** How many failure reasons a bulk summary lists before "…and N more". */
export const LISTED_FAILURES = 3;

/** A finished bulk action, whatever produced it (server batch endpoint or `runBulkSequential`). */
export interface BulkOutcome {
  succeeded: number;
  /** Each failed record: a human label (number / name) and the server's reason. */
  failed: { label: string; message: string }[];
}

export interface BulkOutcomeSummary {
  tone: "success" | "partial" | "failed" | "empty";
  title: string;
  /** One line per listed failure ("ORD-12: Already shipped"), then "…and N more". */
  description?: string;
}

/**
 * The shared bulk-result wording (R6 B5) — pure, unit-tested. All good →
 * the caller's success text; anything failed → "x succeeded, y failed" (or
 * "y failed — nothing was changed") with the first reasons listed, so the
 * user knows exactly which records are left and why.
 */
export function summarizeBulkOutcome(
  outcome: BulkOutcome,
  success: (count: number) => string,
  locale: Locale = currentLocale(),
): BulkOutcomeSummary {
  const failedCount = outcome.failed.length;
  const text = (key: Parameters<typeof translate>[1], params: Record<string, number> = {}) =>
    translate(messages[locale], key, params);
  // Nothing was eligible: never a green "0 done".
  if (failedCount === 0 && outcome.succeeded === 0) {
    return { tone: "empty", title: text("controls.bulk.nothingToApply") };
  }
  if (failedCount === 0) return { tone: "success", title: success(outcome.succeeded) };
  const lines = outcome.failed
    .slice(0, LISTED_FAILURES)
    .map(({ label, message }) => (label ? `${label}: ${message}` : message));
  if (failedCount > LISTED_FAILURES) {
    lines.push(text("controls.bulk.more", { count: failedCount - LISTED_FAILURES }));
  }
  return outcome.succeeded === 0
    ? {
        tone: "failed",
        title: text("controls.bulk.allFailed", { failed: failedCount }),
        description: lines.join("\n"),
      }
    : {
        tone: "partial",
        title: text("controls.bulk.partial", {
          succeeded: outcome.succeeded,
          failed: failedCount,
        }),
        description: lines.join("\n"),
      };
}

/** Shows `summarizeBulkOutcome` as a toast: success → success; partial or failed → error with reasons. */
export function reportBulkOutcome(outcome: BulkOutcome, success: (count: number) => string) {
  const summary = summarizeBulkOutcome(outcome, success);
  if (summary.tone === "success") {
    toast.success(summary.title);
    return summary;
  }
  if (summary.tone === "empty") {
    toast.info(summary.title);
    return summary;
  }
  toast.error(summary.title, { description: summary.description });
  return summary;
}

/**
 * Adapts a server batch result (`{ succeeded: id[], failed: {id, message}[] }`)
 * to a `BulkOutcome`, labelling each failed id with the record's own number
 * when the caller knows it.
 */
export function bulkOutcomeFromIds(
  result: { succeeded: readonly unknown[]; failed: readonly { id: string; message: string }[] },
  labelFor: (id: string) => string | null | undefined = () => null,
): BulkOutcome {
  return {
    succeeded: result.succeeded.length,
    failed: result.failed.map(({ id, message }) => ({ label: labelFor(id) || id, message })),
  };
}

/**
 * Success / partial-failure feedback for `runBulkSequential` — the shared
 * summary with the caller's own success text and record labels.
 */
export function reportBulkResult<T>(
  result: BulkRunResult<T>,
  copy: {
    success: (count: number) => string;
    label: (item: T) => string;
  },
) {
  return reportBulkOutcome(
    {
      succeeded: result.succeeded.length,
      failed: result.failed.map(({ item, message }) => ({ label: copy.label(item), message })),
    },
    copy.success,
  );
}
