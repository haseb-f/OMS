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
  /** Closed set of accepted values (e.g. an enum) — rendered as an Excel data-validation dropdown on the Template's Data sheet. Never used for live Master Data (which can change size/content) — see `referenceType` for that. */
  options?: string[];
  /** Detected as a "Duplicate Codes/Customers/Phones"-style error (Phase 1 upfront validation) when the same value appears on more than one row of the same file — before anything is saved. */
  uniqueWithinFile?: boolean;
  /**
   * Master Data awareness — set when this field's value must be an
   * existing `ReferenceDataRegistryService` record (Country, Currency,
   * Product, ...) rather than free text. Drives three things from one
   * declaration: the Excel Template's dropdown (backed by a live
   * "Reference Data" sheet, not a hardcoded list), the Google Sheets
   * reference worksheet, and `ReferenceDataRegistryService.resolveRequired`/
   * `resolveOptional`'s validation (unrecognized vs. inactive, never an
   * auto-created record). One of the type strings
   * `ReferenceDataSourcesService` registers, e.g. `'COUNTRY'`, `'CURRENCY'`,
   * `'PRODUCT'`.
   */
  referenceType?: string;
  /** Which `ReferenceRecord` field this column's values match against — defaults to the reference type's own `defaultMatchField` (e.g. Product defaults to SKU) when omitted. */
  referenceMatchField?: 'code' | 'name';
  /**
   * `referenceType` fields only — the generated dropdown shows
   * `"name (code)"` instead of the bare match-field value whenever the
   * record has a `code` (e.g. "السعودية (SA)"), so the employee never has
   * to know or type the exact official/registered name. The stable `code`
   * embedded in that suffix is what `ReferenceDataRegistryService` actually
   * resolves against (see its trailing-`(CODE)` fallback) — a display-name
   * mismatch (formal vs. common name, a future rename, ...) can never
   * cause a false rejection for a value picked from a freshly-generated
   * dropdown, even when `referenceMatchField` is `'name'`. Opt-in per
   * field (never a blanket behavior change for every existing
   * name-matched reference column) — set for Country specifically, since
   * that's the field this was built to fix.
   */
  referenceDisplayWithCode?: boolean;
  /**
   * Keep the field in mapping/import, but do not occupy a sequential
   * template column. Used so optional named columns (e.g. Payment Type)
   * cannot shift the reserved Q:R:S result block.
   */
  omitFromTemplate?: boolean;
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
  /**
   * Data Synchronization only — server-computed constants for this run,
   * mirroring `ImportJob.rowDefaults` (e.g. a Cash Flow worksheet's
   * provider label, or this job's own id for traceability). A separate
   * channel from `row` on purpose: `row` is only ever user-mapped
   * spreadsheet/file data, so a handler can tell "the sheet had no Bank
   * Name column" apart from "this is a sync run and the worksheet's
   * provider is known" without a fake column appearing in the mapping UI
   * or the generated Excel Template. Absent on a plain manual
   * upload/import.
   */
  context?: Record<string, string>;
}

export interface ImportRowResult {
  id: string;
  /**
   * Data Synchronization idempotency (spec: "running Sync twice without
   * changes must return NO_CHANGE, never create duplicate history") — set
   * by a handler that detected the requested values already match the
   * current record exactly and skipped writing/logging anything. Absent
   * (falsy) for a handler that doesn't implement this distinction, which
   * `ImportJobsService`/`SyncOrchestratorService` treat as a normal
   * success (the pre-existing behavior, unchanged).
   */
  noChange?: boolean;
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
  /**
   * Column headers reserved for the sync write-back result (e.g. Store
   * Orders' "Sync Status" / "System Order ID" / "Error Message") — never
   * user-input, never mapped by the Import Mapping UI, never validated.
   * `ImportTemplateService` appends them, unstyled-as-data, immediately
   * after `fields` on the generated "Import Data" sheet so a template
   * built from scratch already reserves the exact columns
   * `GoogleSheetsService.ensureResultColumns` will look for by name at
   * sync time — optional; a handler without this is unaffected.
   */
  readonly resultColumns?: string[];
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
   * Performance (Data Synchronization spec: "avoid N+1 queries... load
   * relevant records in batches"). Called ONCE by
   * `ImportJobsService.validate()`/`run()` with every mapped row in the
   * batch, BEFORE the per-row loop, for a handler whose per-row lookup key
   * (e.g. `externalOrderId`) differs on every row — unlike a
   * `referenceType` field (same value looked up on every row, already
   * cached generically by `ReferenceDataRegistryService`), this needs an
   * explicit batched `findMany({ where: { key: { in: [...] } } })` a
   * generic mechanism can't infer. A handler that implements this should
   * populate its own request-scoped cache (see `reference-cache.ts`) and
   * have `importRow` consult it first, falling back to a live per-row
   * query when the cache is empty (a direct `importRow` call outside the
   * engine, e.g. in a test). Optional — a handler without this hook is
   * unaffected.
   */
  preloadRows?(rows: Record<string, string>[], userId?: string): Promise<void>;

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
