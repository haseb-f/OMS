import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImportJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImportTypeRegistryService } from './import-type-registry.service';
import { parseCsv, type ParsedTable } from './csv-parser.util';
import { parseXlsx } from './xlsx-parser.util';
import { parseGoogleSheetsUrl } from './google-sheets.util';
import { GoogleSheetsService } from './google-sheets.service';
import { groupRowsByKey, extractImportErrorMessage } from './import-value.util';
import { runWithReferenceCache } from './reference-data/reference-cache';
import {
  ImportRowNeedsReviewError,
  NEEDS_REVIEW_PREFIX,
  type ImportFieldDef,
} from './import-type.interface';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { SetMappingDto } from './dto/set-mapping.dto';
import { RejectImportRowDto } from './dto/reject-import-row.dto';

const JOB_INCLUDE = {
  errors: { orderBy: { rowNumber: 'asc' as const } },
} satisfies Prisma.ImportJobInclude;

export interface ImportRowValidationError {
  rowNumber: number;
  columnName: string | null;
  message: string;
}

export interface ImportDuplicateGroup {
  field: string;
  value: string;
  rowNumbers: number[];
}

/**
 * Aggregate counts the Import preview screen shows before the user approves
 * anything (Part 4) — a projection over the same per-row `errors`/
 * `duplicateGroups` `validate()` already computes, never a second pass.
 * `duplicateCount` is rows sharing a `uniqueWithinFile` field value with
 * another row in the same file (External Order ID, SKU, ...); detecting a
 * duplicate against an *existing* database record is a per-type concern
 * only a few handlers (Leads/Orders) implement today via
 * `LeadDuplicateDetectionService`.
 * `needsReviewCount` is a real, per-row-outcome count — a row a handler
 * flags by throwing `ImportRowNeedsReviewError` (e.g. Store Orders import's
 * "existing customer found by phone") — never a fabricated number; a
 * handler that never throws it simply contributes 0.
 */
export interface ImportPreviewSummary {
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  needsReviewCount: number;
}

export interface ImportRowNeedsReview {
  rowNumber: number;
  reason: string;
}

export interface ImportValidationResult {
  totalRows: number;
  errorCount: number;
  errors: ImportRowValidationError[];
  duplicateGroups: ImportDuplicateGroup[];
  needsReview: ImportRowNeedsReview[];
  summary: ImportPreviewSummary;
}

/**
 * Import Center engine (TASK-056 Part 3/5) — the one place an
 * `ImportJob` moves through Draft -> Uploading -> Mapping -> Validating ->
 * Importing -> Completed/Failed/Cancelled. `run()` never touches Prisma for
 * the actual imported record — every row ends in
 * `ImportTypeRegistryService.get(type).importRow()`, which itself always
 * calls the same domain service a manual UI action would ("no duplicated
 * validation," TASK-056 Part 5). This phase runs synchronously (no queue/
 * worker yet) — a deliberate, explicit scope boundary, not an oversight;
 * see the module doc comment.
 */
@Injectable()
export class ImportJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ImportTypeRegistryService,
    private readonly googleSheets: GoogleSheetsService,
  ) {}

  async create(dto: CreateImportJobDto, userId?: string) {
    // Fails fast with a clear 404 if the type isn't registered.
    this.registry.get(dto.importType);
    return this.prisma.importJob.create({
      data: {
        importType: dto.importType,
        status: ImportJobStatus.DRAFT,
        fileName: '',
        fileContent: '',
        createdBy: userId ?? null,
      },
      include: JOB_INCLUDE,
    });
  }

  /**
   * List view — the Import Center list page only ever reads the scalar
   * `errorCount` column (never the `errors` relation itself), so unlike
   * `findOne`/`create` this doesn't pull every row-level error for every
   * job in the list.
   */
  async findAll(importType?: string) {
    return this.prisma.importJob.findMany({
      where: importType ? { importType } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: JOB_INCLUDE,
    });
    if (!job) {
      throw new NotFoundException(`Import Job ${id} not found`);
    }
    return job;
  }

  /** Parses the uploaded file (CSV or Excel — see csv-parser.util.ts / xlsx-parser.util.ts) and stores it; moves Draft -> Mapping. */
  async upload(id: string, fileName: string, content: string) {
    const job = await this.findOne(id);
    if (job.status !== ImportJobStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot upload a file to Import Job in ${job.status} status.`,
      );
    }
    return this.storeContent(id, fileName, content);
  }

  /**
   * Google Sheets URL Source (Phase 1, Part 5) — reads the sheet server-side
   * via the authenticated `GoogleSheetsService` (service-account, never a
   * public "anyone with the link" export) and stores it exactly like an
   * uploaded `.csv` file; `parseFile`/`preview`/`setMapping`/`run` below
   * never know the difference. The spreadsheet must be shared with the
   * service account's own email first — `GoogleSheetsService` surfaces that
   * exact instruction if it isn't.
   */
  async uploadFromGoogleSheets(id: string, url: string) {
    const job = await this.findOne(id);
    if (job.status !== ImportJobStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot upload a file to Import Job in ${job.status} status.`,
      );
    }
    const { spreadsheetId, gid } = parseGoogleSheetsUrl(url);
    const content = await this.googleSheets.getSheetAsCsv(spreadsheetId, gid);
    return this.storeContent(id, 'google-sheet.csv', content, {
      sourceConnector: 'google-sheets',
      sourceUrl: url,
    });
  }

  /**
   * "Manual Refresh" (Part 4) — re-fetches the same Google Sheet and
   * replaces the stored content, without disturbing the job's current
   * column mapping/status. Scheduled (automatic) refresh is explicitly out
   * of scope this phase — see `ImportJob.scheduleConfig`.
   *
   * `isSyncing` is a real server-side advisory lock, not just a disabled
   * frontend button — a second refresh request while one is already running
   * is rejected outright (Part 4's "concurrent-refresh prevention").
   * `lastAttemptedAt` is stamped regardless of outcome; `lastSyncedAt` only
   * on success, so the review screen can show "last attempt failed, still
   * showing data from <lastSyncedAt>" instead of silently going stale.
   */
  async refresh(id: string) {
    const job = await this.findOne(id);
    if (job.sourceConnector !== 'google-sheets' || !job.sourceUrl) {
      throw new BadRequestException(
        'Only a Google Sheets import can be refreshed.',
      );
    }
    if (
      job.status !== ImportJobStatus.MAPPING &&
      job.status !== ImportJobStatus.VALIDATING
    ) {
      throw new BadRequestException(
        `Cannot refresh an Import Job in ${job.status} status.`,
      );
    }
    if (job.isSyncing) {
      throw new BadRequestException(
        'A refresh is already in progress for this import job.',
      );
    }

    await this.prisma.importJob.update({
      where: { id },
      data: { isSyncing: true, lastAttemptedAt: new Date() },
    });

    try {
      const { spreadsheetId, gid } = parseGoogleSheetsUrl(job.sourceUrl);
      const content = await this.googleSheets.getSheetAsCsv(spreadsheetId, gid);
      const table = parseCsv(content);
      if (table.rows.length === 0) {
        throw new BadRequestException('The Google Sheet has no data rows.');
      }
      return await this.prisma.importJob.update({
        where: { id },
        data: {
          fileContent: content,
          totalRows: table.rows.length,
          isSyncing: false,
          lastSyncedAt: new Date(),
        },
        include: JOB_INCLUDE,
      });
    } catch (error) {
      await this.prisma.importJob.update({
        where: { id },
        data: { isSyncing: false },
      });
      throw error;
    }
  }

  private async storeContent(
    id: string,
    fileName: string,
    content: string,
    source?: { sourceConnector: string; sourceUrl: string },
  ) {
    const table = await this.parseFile(fileName, content);
    if (table.rows.length === 0) {
      throw new BadRequestException('The uploaded file has no data rows.');
    }
    return this.prisma.importJob.update({
      where: { id },
      data: {
        fileName,
        fileContent: content,
        status: ImportJobStatus.MAPPING,
        totalRows: table.rows.length,
        sourceConnector: source?.sourceConnector,
        sourceUrl: source?.sourceUrl,
        ...(source
          ? { lastSyncedAt: new Date(), lastAttemptedAt: new Date() }
          : {}),
      },
      include: JOB_INCLUDE,
    });
  }

  /** Returns the parsed headers + a preview of the first `limit` rows — read-only, for the Mapping Engine's Preview step. */
  async preview(id: string, limit = 10) {
    const job = await this.findOne(id);
    const table = await this.parseFile(job.fileName, job.fileContent);
    return { headers: table.headers, rows: table.rows.slice(0, limit) };
  }

  /** Saves the column mapping (`{ fieldKey: sourceColumnHeader }`) and confirms every required field is mapped; moves Mapping -> Validating. */
  async setMapping(id: string, dto: SetMappingDto) {
    const job = await this.findOne(id);
    if (
      job.status !== ImportJobStatus.MAPPING &&
      job.status !== ImportJobStatus.VALIDATING
    ) {
      throw new BadRequestException(
        `Cannot set column mapping on Import Job in ${job.status} status.`,
      );
    }
    const handler = this.registry.get(job.importType);
    const table = await this.parseFile(job.fileName, job.fileContent);
    const missing = handler.fields
      .filter((field) => field.required)
      .filter((field) => {
        const column = dto.columnMapping[field.key];
        if (!column) return true;
        const needle = column.trim().toLocaleLowerCase('en-US');
        return !table.headers.some(
          (header) => header.trim().toLocaleLowerCase('en-US') === needle,
        );
      });
    if (missing.length > 0) {
      throw new BadRequestException(
        `Map every required field before continuing: ${missing.map((f) => f.key).join(', ')}.`,
      );
    }
    return this.prisma.importJob.update({
      where: { id },
      data: {
        columnMapping: dto.columnMapping,
        status: ImportJobStatus.VALIDATING,
      },
      include: JOB_INCLUDE,
    });
  }

  /**
   * Pre-flight validation (Phase 1 — "Nothing is imported until validation
   * succeeds") — detects every issue `run()` would eventually hit, without
   * writing anything: required-value blanks, duplicate values within the
   * file for any field the handler marks `uniqueWithinFile` (Duplicate
   * Codes/Customers/Phones), and every unknown-reference/invalid-value
   * check a handler's `importRow()` already performs, called here with
   * `{ dryRun: true }` so it short-circuits before the actual `create()`/
   * `.adjustment()` call — the exact same validation code path `run()`
   * uses, never a parallel reimplementation. Read-only: never changes the
   * job's status, safe to call repeatedly (e.g. after fixing the mapping).
   */
  async validate(
    id: string,
    userId?: string,
    options?: { skipRowNumbers?: number[] },
  ): Promise<ImportValidationResult> {
    // Scopes one request-local Master-Data lookup cache for this entire
    // validation pass (see `reference-cache.ts`) — every row's
    // `resolveRequiredIdByField`/reference-type lookup shares one fetch per
    // referenced entity instead of one query per row.
    return runWithReferenceCache(() => this.validateInner(id, userId, options));
  }

  private async validateInner(
    id: string,
    userId?: string,
    options?: { skipRowNumbers?: number[] },
  ): Promise<ImportValidationResult> {
    const job = await this.findOne(id);
    if (
      job.status !== ImportJobStatus.MAPPING &&
      job.status !== ImportJobStatus.VALIDATING
    ) {
      throw new BadRequestException(
        `Cannot validate an Import Job in ${job.status} status.`,
      );
    }
    if (!job.columnMapping) {
      throw new BadRequestException('Map columns before validating.');
    }

    const handler = this.registry.get(job.importType);
    const table = await this.parseFile(job.fileName, job.fileContent);
    const mapping = job.columnMapping as Record<string, string>;
    const rowDefaults =
      (job.rowDefaults as Record<string, string> | null) ?? undefined;
    const uniqueFields = handler.fields.filter(
      (field) => field.uniqueWithinFile,
    );
    const skip = new Set(options?.skipRowNumbers ?? []);

    const errors: ImportRowValidationError[] = [];
    const mappedRows: {
      rowNumber: number;
      mappedRow: Record<string, string>;
    }[] = [];
    const seen = new Map<string, Map<string, number[]>>();

    for (let index = 0; index < table.rows.length; index++) {
      const sourceRow = table.rows[index];
      const rowNumber = index + 2;
      const mappedRow: Record<string, string> = {};
      for (const field of handler.fields) {
        const column = mapping[field.key];
        mappedRow[field.key] = column ? (sourceRow[column] ?? '') : '';
      }
      mappedRows.push({ rowNumber, mappedRow });
      if (skip.has(rowNumber)) continue;

      for (const field of handler.fields) {
        if (field.required && !mappedRow[field.key]?.trim()) {
          errors.push({
            rowNumber,
            columnName: field.label,
            message: `${field.label} is required.`,
          });
        }
      }

      for (const field of uniqueFields) {
        const value = mappedRow[field.key]?.trim();
        if (!value) continue;
        const valueMap = seen.get(field.key) ?? new Map<string, number[]>();
        seen.set(field.key, valueMap);
        const key = value.toLowerCase();
        const rows = valueMap.get(key) ?? [];
        valueMap.set(key, rows);
        rows.push(rowNumber);
      }
    }

    const duplicateGroups: ImportDuplicateGroup[] = [];
    for (const field of uniqueFields) {
      const valueMap = seen.get(field.key);
      if (!valueMap) continue;
      for (const [value, rowNumbers] of valueMap) {
        if (rowNumbers.length < 2) continue;
        duplicateGroups.push({ field: field.label, value, rowNumbers });
        for (const rowNumber of rowNumbers) {
          const others = rowNumbers.filter((r) => r !== rowNumber);
          errors.push({
            rowNumber,
            columnName: field.label,
            message: `Duplicate ${field.label} "${value}" also appears on row(s) ${others.join(', ')}.`,
          });
        }
      }
    }

    const needsReview: ImportRowNeedsReview[] = [];

    if (handler.preloadRows) {
      await handler.preloadRows(
        mappedRows.map((r) => r.mappedRow),
        userId,
      );
    }

    if (handler.groupKey && handler.importGroup) {
      const groups = groupRowsByKey(mappedRows, handler.groupKey);
      for (const groupRows of groups.values()) {
        if (groupRows.every((row) => skip.has(row.rowNumber))) continue;
        try {
          await handler.importGroup(
            groupRows.map((r) => r.mappedRow),
            userId,
            { dryRun: true, context: rowDefaults },
          );
        } catch (error) {
          if (error instanceof ImportRowNeedsReviewError) {
            for (const { rowNumber } of groupRows) {
              needsReview.push({ rowNumber, reason: error.message });
            }
            continue;
          }
          const message = extractImportErrorMessage(error);
          for (const { rowNumber } of groupRows) {
            errors.push({ rowNumber, columnName: null, message });
          }
        }
      }
    } else {
      for (const { rowNumber, mappedRow } of mappedRows) {
        if (skip.has(rowNumber)) continue;
        try {
          await handler.importRow(mappedRow, userId, {
            dryRun: true,
            context: rowDefaults,
          });
        } catch (error) {
          if (error instanceof ImportRowNeedsReviewError) {
            needsReview.push({ rowNumber, reason: error.message });
            continue;
          }
          errors.push({
            rowNumber,
            columnName: null,
            message: extractImportErrorMessage(error),
          });
        }
      }
    }

    errors.sort((a, b) => a.rowNumber - b.rowNumber);
    needsReview.sort((a, b) => a.rowNumber - b.rowNumber);

    const invalidRowNumbers = new Set(errors.map((e) => e.rowNumber));
    const duplicateRowNumbers = new Set(
      duplicateGroups.flatMap((group) => group.rowNumbers),
    );
    const needsReviewRowNumbers = new Set(needsReview.map((r) => r.rowNumber));
    // A row counted as invalid never double-counts as a duplicate or a
    // needs-review row too — the four buckets partition every row exactly
    // once, so they always sum to `totalRows`.
    const duplicateOnlyCount = [...duplicateRowNumbers].filter(
      (rowNumber) => !invalidRowNumbers.has(rowNumber),
    ).length;
    const summary: ImportPreviewSummary = {
      totalRows: table.rows.length,
      invalidCount: invalidRowNumbers.size,
      duplicateCount: duplicateOnlyCount,
      needsReviewCount: needsReviewRowNumbers.size,
      newCount:
        table.rows.length -
        invalidRowNumbers.size -
        duplicateOnlyCount -
        needsReviewRowNumbers.size,
    };

    return {
      totalRows: table.rows.length,
      errorCount: errors.length,
      errors,
      duplicateGroups,
      needsReview,
      summary,
    };
  }

  /**
   * Runs the import: applies the saved mapping to every row and calls the
   * registered handler's `importRow()` once per row (or, for document-shaped
   * types with a `groupKey`, `importGroup()` once per group of rows sharing
   * the same document number — see `ImportTypeHandler.groupKey`), in order.
   * A row or group that throws is recorded as an `ImportJobError` and the
   * run continues — one bad row/document never aborts the rest of the batch
   * (standard enterprise import UX: import what's valid, report what
   * isn't).
   */
  async run(
    id: string,
    userId?: string,
    options?: {
      acceptRowNumbers?: number[];
      contextOverrides?: Record<string, string>;
    },
  ) {
    // Same request-local Master-Data lookup cache `validate()` uses — a
    // `run()` immediately following a `validate()` on the same job still
    // gets its own fresh fetch (no cache is shared across calls), so
    // Master Data changed between preview and commit is always picked up.
    return runWithReferenceCache(() => this.runInner(id, userId, options));
  }

  /**
   * Mapped source rows for a sync review UI — the same projection
   * `validate()`/`run()` already build, exposed without importing.
   * Row numbers are Excel-style (header = 1, first data row = 2).
   */
  async listMappedRows(id: string): Promise<{
    groupKey: string | null;
    rows: Array<{
      rowNumber: number;
      mappedRow: Record<string, string>;
      sourceRow: Record<string, string>;
    }>;
  }> {
    const job = await this.findOne(id);
    if (!job.columnMapping) {
      throw new BadRequestException(
        'No column mapping saved for this Import Job.',
      );
    }
    const handler = this.registry.get(job.importType);
    const table = await this.parseFile(job.fileName, job.fileContent);
    const mapping = job.columnMapping as Record<string, string>;
    const rows: Array<{
      rowNumber: number;
      mappedRow: Record<string, string>;
      sourceRow: Record<string, string>;
    }> = [];
    for (let index = 0; index < table.rows.length; index++) {
      const sourceRow = table.rows[index];
      const rowNumber = index + 2;
      const mappedRow: Record<string, string> = {};
      for (const field of handler.fields) {
        const column = mapping[field.key];
        mappedRow[field.key] = column ? (sourceRow[column] ?? '') : '';
      }
      rows.push({ rowNumber, mappedRow, sourceRow });
    }
    return { groupKey: handler.groupKey ?? null, rows };
  }

  private async runInner(
    id: string,
    userId?: string,
    options?: {
      acceptRowNumbers?: number[];
      contextOverrides?: Record<string, string>;
    },
  ) {
    const job = await this.findOne(id);
    if (job.status !== ImportJobStatus.VALIDATING) {
      throw new BadRequestException(
        `Cannot run Import Job in ${job.status} status — map its columns first.`,
      );
    }
    if (!job.columnMapping) {
      throw new BadRequestException(
        'No column mapping saved for this Import Job.',
      );
    }

    const handler = this.registry.get(job.importType);
    const table = await this.parseFile(job.fileName, job.fileContent);
    const mapping = job.columnMapping as Record<string, string>;
    const rowDefaults = {
      ...((job.rowDefaults as Record<string, string> | null) ?? {}),
      ...(options?.contextOverrides ?? {}),
    };
    const accept =
      options?.acceptRowNumbers === undefined
        ? undefined
        : new Set(options.acceptRowNumbers);

    await this.prisma.importJob.update({
      where: { id },
      data: { status: ImportJobStatus.IMPORTING, startedAt: new Date() },
    });

    const startedAt = Date.now();
    let successCount = 0;
    const errors: Prisma.ImportJobErrorCreateManyInput[] = [];
    // Per-row created-record ids (Data Synchronization write-back only —
    // e.g. writing "OMS Order ID" back to the source sheet needs to know
    // exactly which row produced which Store Order, not just an aggregate
    // count). `noChange` mirrors `ImportRowResult.noChange` — a handler
    // that detected nothing needed to change for this row. Every other
    // caller ignores both fields.
    const successRows: { rowNumber: number; id: string; noChange?: boolean }[] =
      [];

    const mappedRows: {
      rowNumber: number;
      mappedRow: Record<string, string>;
      sourceRow: Record<string, string>;
    }[] = [];
    for (let index = 0; index < table.rows.length; index++) {
      const sourceRow = table.rows[index];
      const rowNumber = index + 2; // +1 for 1-indexing, +1 for the header row
      const mappedRow: Record<string, string> = {};
      for (const field of handler.fields) {
        const column = mapping[field.key];
        mappedRow[field.key] = column ? (sourceRow[column] ?? '') : '';
      }
      mappedRows.push({ rowNumber, mappedRow, sourceRow });
    }

    if (handler.preloadRows) {
      await handler.preloadRows(
        mappedRows.map((r) => r.mappedRow),
        userId,
      );
    }

    if (handler.groupKey && handler.importGroup) {
      const groups = groupRowsByKey(mappedRows, handler.groupKey);
      for (const groupRows of groups.values()) {
        if (accept && !groupRows.every((row) => accept.has(row.rowNumber))) {
          continue;
        }
        try {
          const result = await handler.importGroup(
            groupRows.map((r) => r.mappedRow),
            userId,
            { context: rowDefaults },
          );
          successCount += groupRows.length;
          for (const { rowNumber } of groupRows) {
            successRows.push({
              rowNumber,
              id: result.id,
              noChange: result.noChange,
            });
          }
        } catch (error) {
          if (error instanceof ImportRowNeedsReviewError) {
            for (const { rowNumber, sourceRow } of groupRows) {
              errors.push({
                importJobId: id,
                rowNumber,
                columnName: null,
                errorMessage: `${NEEDS_REVIEW_PREFIX}${error.message}`,
                rawRowData: sourceRow,
              });
            }
            continue;
          }
          const errorMessage = extractImportErrorMessage(error);
          const suggestedFix = this.suggestFix(error);
          for (const { rowNumber, sourceRow } of groupRows) {
            errors.push({
              importJobId: id,
              rowNumber,
              columnName: null,
              errorMessage,
              suggestedFix,
              rawRowData: sourceRow,
            });
          }
        }
      }
    } else {
      for (const { rowNumber, mappedRow, sourceRow } of mappedRows) {
        if (accept && !accept.has(rowNumber)) {
          continue;
        }
        try {
          const result = await handler.importRow(mappedRow, userId, {
            context: rowDefaults,
          });
          successCount++;
          successRows.push({
            rowNumber,
            id: result.id,
            noChange: result.noChange,
          });
        } catch (error) {
          if (error instanceof ImportRowNeedsReviewError) {
            errors.push({
              importJobId: id,
              rowNumber,
              columnName: null,
              errorMessage: `${NEEDS_REVIEW_PREFIX}${error.message}`,
              rawRowData: sourceRow,
            });
            continue;
          }
          errors.push({
            importJobId: id,
            rowNumber,
            columnName: null,
            errorMessage: extractImportErrorMessage(error),
            suggestedFix: this.suggestFix(error),
            rawRowData: sourceRow,
          });
        }
      }
    }

    if (errors.length > 0) {
      await this.prisma.importJobError.createMany({ data: errors });
    }

    const durationMs = Date.now() - startedAt;
    const finalStatus =
      successCount > 0 ? ImportJobStatus.COMPLETED : ImportJobStatus.FAILED;

    const updated = await this.prisma.importJob.update({
      where: { id },
      data: {
        status: finalStatus,
        successCount,
        errorCount: errors.length,
        completedAt: new Date(),
        durationMs,
      },
      include: JOB_INCLUDE,
    });

    return { ...updated, successRows };
  }

  /** Re-derives the mapped-field row `importRow`/`resolveNeedsReview` expect from a stored `ImportJobError.rawRowData` (original-header source row) + the job's saved `columnMapping` — the exact same projection `run()`/`validate()` build, just replayed later for one specific row. */
  private remapRow(
    sourceRow: Record<string, unknown>,
    columnMapping: Record<string, string>,
    fields: ImportFieldDef[],
  ): Record<string, string> {
    const mappedRow: Record<string, string> = {};
    for (const field of fields) {
      const column = columnMapping[field.key];
      const value = column ? sourceRow[column] : undefined;
      mappedRow[field.key] =
        typeof value === 'string'
          ? value
          : value == null
            ? ''
            : JSON.stringify(value);
    }
    return mappedRow;
  }

  private async getNeedsReviewRow(jobId: string, rowId: string) {
    const row = await this.prisma.importJobError.findFirst({
      where: { id: rowId, importJobId: jobId },
    });
    if (!row) {
      throw new NotFoundException(`Import row ${rowId} not found`);
    }
    if (!row.errorMessage.startsWith(NEEDS_REVIEW_PREFIX)) {
      throw new BadRequestException(
        'This row is not flagged as needing review.',
      );
    }
    if (row.rejectedAt) {
      throw new BadRequestException('This row has already been rejected.');
    }
    return row;
  }

  /**
   * Lists a job's needs-review rows, projected into the shape the review UI
   * renders — `NEEDS_REVIEW` (still awaiting a decision) or `REJECTED`
   * (kept, never deleted, so its reason stays visible). A Confirmed row has
   * no listing here: `confirmRow` deletes it once written for real, exactly
   * as before this change.
   */
  async rows(jobId: string, status?: 'NEEDS_REVIEW' | 'REJECTED') {
    await this.findOne(jobId);
    const candidates = await this.prisma.importJobError.findMany({
      where: {
        importJobId: jobId,
        errorMessage: { startsWith: NEEDS_REVIEW_PREFIX },
        ...(status === 'NEEDS_REVIEW'
          ? { rejectedAt: null }
          : status === 'REJECTED'
            ? { rejectedAt: { not: null } }
            : {}),
      },
      orderBy: { rowNumber: 'asc' },
    });
    return candidates.map((row) => ({
      id: row.id,
      jobId: row.importJobId,
      rowNumber: row.rowNumber,
      status: row.rejectedAt
        ? ('REJECTED' as const)
        : ('NEEDS_REVIEW' as const),
      rawRowData: row.rawRowData,
      reviewReason: row.errorMessage.slice(NEEDS_REVIEW_PREFIX.length),
      rejectionReasonCode: row.rejectionReasonCode,
      rejectionReasonNote: row.rejectionReasonNote,
      rejectedAt: row.rejectedAt,
      matchedCustomerId: null,
      matchedCustomerName: null,
      matchedCustomerPhone: null,
      createdAt: row.createdAt,
    }));
  }

  /** Business operation: Confirm a needs-review row — writes the record for real via the handler's `resolveNeedsReview`, then removes the flagged row and counts it as a success. */
  async confirmRow(jobId: string, rowId: string, userId?: string) {
    const job = await this.findOne(jobId);
    const row = await this.getNeedsReviewRow(jobId, rowId);
    const handler = this.registry.get(job.importType);
    if (!handler.resolveNeedsReview) {
      throw new BadRequestException(
        `Import type "${job.importType}" has no needs-review resolution.`,
      );
    }
    const mappedRow = this.remapRow(
      row.rawRowData as Record<string, unknown>,
      (job.columnMapping ?? {}) as Record<string, string>,
      handler.fields,
    );
    const result = await handler.resolveNeedsReview(mappedRow, userId);
    await this.prisma.$transaction([
      this.prisma.importJobError.delete({ where: { id: rowId } }),
      this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          successCount: { increment: 1 },
          errorCount: { decrement: 1 },
        },
      }),
    ]);
    return result;
  }

  /**
   * Business operation: Reject a needs-review row — never written to the
   * target service, but (unlike before) never deleted either: the row and
   * its required reason stay queryable via `rows(jobId, 'REJECTED')` so the
   * review/report UI can show why it was rejected.
   */
  async rejectRow(jobId: string, rowId: string, dto: RejectImportRowDto) {
    await this.getNeedsReviewRow(jobId, rowId);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.importJob.update({
        where: { id: jobId },
        data: { errorCount: { decrement: 1 } },
      }),
      this.prisma.importJobError.update({
        where: { id: rowId },
        data: {
          rejectedAt: new Date(),
          rejectionReasonCode: dto.reasonCode,
          rejectionReasonNote: dto.note ?? null,
        },
      }),
    ]);
    return { id: updated.id, rejected: true };
  }

  /** Bulk variants — partial success allowed, same as every other bulk endpoint in this API. */
  async confirmRows(jobId: string, rowIds: string[], userId?: string) {
    const results: { id: string; success: boolean; message?: string }[] = [];
    for (const rowId of rowIds) {
      try {
        await this.confirmRow(jobId, rowId, userId);
        results.push({ id: rowId, success: true });
      } catch (error) {
        results.push({
          id: rowId,
          success: false,
          message:
            error instanceof Error ? error.message : 'Failed to confirm.',
        });
      }
    }
    return results;
  }

  /** Bulk reject — the one reason in `dto` is required and applies to every row, same "must provide a reason before rejection completes" rule as the single-row path. */
  async rejectRows(jobId: string, rowIds: string[], dto: RejectImportRowDto) {
    const results: { id: string; success: boolean; message?: string }[] = [];
    for (const rowId of rowIds) {
      try {
        await this.rejectRow(jobId, rowId, dto);
        results.push({ id: rowId, success: true });
      } catch (error) {
        results.push({
          id: rowId,
          success: false,
          message: error instanceof Error ? error.message : 'Failed to reject.',
        });
      }
    }
    return results;
  }

  async cancel(id: string) {
    const job = await this.findOne(id);
    const cancellable: ImportJobStatus[] = [
      ImportJobStatus.DRAFT,
      ImportJobStatus.MAPPING,
      ImportJobStatus.VALIDATING,
    ];
    if (!cancellable.includes(job.status)) {
      throw new BadRequestException(
        `Cannot cancel Import Job in ${job.status} status.`,
      );
    }
    return this.prisma.importJob.update({
      where: { id },
      data: { status: ImportJobStatus.CANCELLED },
      include: JOB_INCLUDE,
    });
  }

  /** "Download Error Report" (Part 6) — one row per failure, the original source data included so a corrected file can be rebuilt. */
  async exportErrorsCsv(id: string): Promise<string> {
    const job = await this.findOne(id);
    const header = ['Row', 'Column', 'Error', 'Suggested Fix'];
    const lines = [header.join(',')];
    for (const error of job.errors) {
      lines.push(
        [
          error.rowNumber,
          error.columnName ?? '',
          `"${error.errorMessage.replace(/"/g, '""')}"`,
          `"${(error.suggestedFix ?? '').replace(/"/g, '""')}"`,
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  /** `content` is base64 for `.xlsx` (binary) and plain UTF-8 text for `.csv` — set that way by `ImportJobsController.upload()`, mirrored here. */
  private async parseFile(
    fileName: string,
    content: string,
  ): Promise<ParsedTable> {
    if (fileName.toLowerCase().endsWith('.xlsx')) {
      return parseXlsx(Buffer.from(content, 'base64'));
    }
    return parseCsv(content);
  }

  private suggestFix(error: unknown): string | undefined {
    const message = error instanceof Error ? error.message : '';
    if (/not found/i.test(message)) {
      return 'Check the referenced value matches an existing record exactly (case-insensitive).';
    }
    if (/required/i.test(message)) {
      return 'Fill in the missing required value for this row.';
    }
    if (/unique|already exists|duplicate/i.test(message)) {
      return 'Remove this row or update the existing record instead.';
    }
    return undefined;
  }
}
