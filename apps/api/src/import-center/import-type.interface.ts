/**
 * Import Center (TASK-056) — the plug-in contract every Import Type
 * registers with `ImportTypeRegistryService`, the same
 * "register at boot, engine never knows the business specifics" shape the
 * Posting Engine already established for Posting Providers
 * (`PostingEngineService.registerProvider`). An `ImportTypeHandler` never
 * writes to Prisma itself — `importRow` always ends in a call to the same
 * `*Service.create()`/`*Service.adjustment()` method a manual UI action
 * would call, so every imported record passes the exact same validation.
 */

export type ImportFieldType = 'string' | 'number' | 'date' | 'boolean';

export interface ImportFieldDef {
  /** The key `columnMapping` and the row object passed to `importRow` use. */
  key: string;
  labelKey: string;
  /** Plain-English column header for the generated Excel Template (Phase 2.5) — the mapping UI itself always renders `labelKey` through the active locale. */
  label: string;
  required: boolean;
  type: ImportFieldType;
  /** Shown in the mapping UI as an example of the expected value, and in the Excel Template's Field Guide sheet. */
  example?: string;
  /** Closed set of accepted values (e.g. an enum) — rendered as an Excel data-validation dropdown on the Template's Data sheet. */
  options?: string[];
  /** Detected as a "Duplicate Codes/Customers/Phones"-style error (Phase 1 upfront validation) when the same value appears on more than one row of the same file — before anything is saved. */
  uniqueWithinFile?: boolean;
}

/** Row-level pre-flight validation options (Phase 1) — see `ImportTypeHandler.importRow`'s `dryRun` note. */
export interface ImportRowOptions {
  /**
   * When true, `importRow` must perform every lookup/validation it
   * normally would (unknown references, invalid values, ...) but return
   * without calling the target service's write method — the exact same
   * checks a real run performs, just short-circuited before the `create`/
   * `adjustment` call, so pre-flight validation can never drift from what
   * actually happens on Run Import.
   */
  dryRun?: boolean;
}

export interface ImportRowResult {
  id: string;
}

/**
 * Third outcome beyond success/throw (TASK — Store Orders + Shipping
 * Operations import) — a handler throws this instead of a plain `Error`
 * when a row is neither a clean success nor a hard failure, but needs a
 * human's explicit confirm/reject before anything is written (e.g. Store
 * Orders import: "an existing Customer was found by phone — attach or
 * create new?"). `ImportJobsService` treats this distinctly from a normal
 * validation error: it never blocks the rest of the batch, is counted in
 * `ImportPreviewSummary.needsReviewCount` (not `invalidCount`), and — when
 * thrown from `run()` — is persisted as an `ImportJobError` row (reusing
 * the existing `rawRowData` storage mechanism, no new table) tagged with
 * the `NEEDS_REVIEW_PREFIX` so `ImportJobsService.confirmRow`/`rejectRow`
 * can find it again later.
 */
export class ImportRowNeedsReviewError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ImportRowNeedsReviewError';
  }
}

/** Prefix stamped on the `ImportJobError.errorMessage` of a needs-review row — see `ImportRowNeedsReviewError`. */
export const NEEDS_REVIEW_PREFIX = 'NEEDS_REVIEW: ';

/**
 * One registered Import Type. `isAvailable: false` means the type is fully
 * registered (visible in the dashboard, its field schema drives the Mapping
 * Engine) but `importRow` is not implemented yet — TASK-056 explicitly
 * scopes "architecture only" for the document-shaped types (Quotations/
 * Orders/Invoices/Receipts/Payments/Manual Journal Entries/Opening
 * Balances), which need a grouped-rows-per-document execution mode the
 * generic single-row engine doesn't run yet. Calling `importRow` on an
 * unavailable handler always throws — the import engine records that as a
 * normal per-row error, never a silent no-op.
 */
export interface ImportTypeHandler {
  readonly type: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly fields: ImportFieldDef[];
  readonly isAvailable: boolean;
  importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult>;
  /**
   * TASK-059 — "one document, many rows": set on document-shaped types
   * (Sales/Purchase Quotations/Orders/Invoices/Returns, Customer Receipts,
   * Supplier Payments, Journal Entries, Opening Balances) whose CSV rows
   * share one value for this field key (usually `documentNumber`) and must
   * become a single `create()` call with an items/lines array, instead of
   * one `create()` per row. When set, `ImportJobsService` groups mapped rows
   * by this field's value and calls `importGroup` once per group; a handler
   * without `groupKey` keeps the original one-`importRow()`-per-row engine
   * path unchanged.
   */
  readonly groupKey?: string;
  /** Required when `groupKey` is set — see `groupKey`'s doc comment. */
  importGroup?(
    rows: Record<string, string>[],
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult>;

  /**
   * Resolves a row previously flagged via `ImportRowNeedsReviewError` —
   * called only from `ImportJobsService.confirmRow` after a human has
   * explicitly clicked Confirm on that specific row, with the same mapped
   * row shape `importRow` received originally (re-derived from the
   * `ImportJobError.rawRowData` it was stored with). Never re-checks the
   * condition that triggered the review (the human's confirm IS the
   * answer) — always writes for real, exactly like `importRow` called
   * without `dryRun`. Required on any handler whose `importRow`/
   * `importGroup` can throw `ImportRowNeedsReviewError`.
   */
  resolveNeedsReview?(
    row: Record<string, string>,
    userId?: string,
  ): Promise<ImportRowResult>;
}
