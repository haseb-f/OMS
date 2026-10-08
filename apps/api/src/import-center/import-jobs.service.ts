import {
  BadRequestException,
  ConflictException,
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
  NOTICE_PREFIX,
  SKIPPED_PREFIX,
  type ImportActor,
  type ImportFieldDef,
  type ImportRowResult,
} from './import-type.interface';
import { ImportSheetConnectionsService } from './sheet-connections/import-sheet-connections.service';
import { restrictedColumnWarnings } from './sales-import/restricted-columns';
import {
  describeJobRow,
  summarizeJobRows,
} from './sales-import/import-job-summary';
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
  /** R15 — rows already in OMS (same row key / external id); never imported again. */
  skippedCount: number;
}

export interface ImportRowNeedsReview {
  rowNumber: number;
  reason: string;
}

/** R15 — a non-blocking preview finding: a row's (`rowNumber`) or the file's (`null`). */
export interface ImportPreviewWarning {
  rowNumber: number | null;
  message: string;
}

/** `run()` options — `actor` (R15) marks a one-time import by a user (see `ImportActor`). */
export interface ImportRunOptions {
  acceptRowNumbers?: number[];
  contextOverrides?: Record<string, string>;
  actor?: ImportActor;
}

export interface ImportValidationResult {
  totalRows: number;
  errorCount: number;
  errors: ImportRowValidationError[];
  duplicateGroups: ImportDuplicateGroup[];
  needsReview: ImportRowNeedsReview[];
  /** R15 — rows that would be skipped as already imported, with the existing record named. */
  skipped: ImportRowNeedsReview[];
  warnings: ImportPreviewWarning[];
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
    private readonly sheetConnections: ImportSheetConnectionsService,
  ) {}

  /** `agentId` (R15) — an agent user's import, from the verified token only. */
  async create(dto: CreateImportJobDto, userId?: string, agentId?: string) {
    // Fails fast with a clear 404 if the type isn't registered.
    this.registry.get(dto.importType);
    const job = await this.prisma.importJob.create({
      data: {
        importType: dto.importType,
        status: ImportJobStatus.DRAFT,
        fileName: '',
        fileContent: '',
        createdBy: userId ?? null,
        agentId: agentId ?? null,
      },
      include: JOB_INCLUDE,
    });
    return { ...job, summary: summarizeJobRows(job.errors, job.successCount) };
  }

  /**
   * List view — the scalar counters only (never the `errors` relation or the
   * uploaded file), filtered by the caller's visibility
   * (`ImportAccessService.jobsWhere`); `skippedCount` is the number of rows
   * skipped as already imported (R15).
   */
  async findAll(where: Prisma.ImportJobWhereInput) {
    const jobs = await this.prisma.importJob.findMany({
      where,
      omit: { fileContent: true },
      include: {
        _count: {
          select: {
            errors: { where: { errorMessage: { startsWith: SKIPPED_PREFIX } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map(({ _count, ...job }) => ({
      ...job,
      skippedCount: _count.errors,
    }));
  }

  async findOne(id: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: JOB_INCLUDE,
    });
    if (!job) {
      throw new NotFoundException(`Import Job ${id} not found`);
    }
    return { ...job, summary: summarizeJobRows(job.errors, job.successCount) };
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
  async uploadFromGoogleSheets(id: string, url: string, actor?: ImportActor) {
    const job = await this.findOne(id);
    if (job.status !== ImportJobStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot upload a file to Import Job in ${job.status} status.`,
      );
    }
    const { spreadsheetId, gid } = parseGoogleSheetsUrl(url);
    // R15 (D15-17) — a one-time import connects the sheet to its importer
    // (refused when another user/agent owns it or a sync source reads it).
    if (actor) await this.sheetConnections.connect(spreadsheetId, actor);
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
  async refresh(id: string, actor?: ImportActor) {
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
      if (actor) await this.sheetConnections.assertUsable(spreadsheetId, actor);
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
        // Rows read from a Google Sheet are tagged as such (e.g. a lead's
        // source) — the continuous sync then sets its own run defaults.
        ...(source
          ? {
              lastSyncedAt: new Date(),
              lastAttemptedAt: new Date(),
              rowDefaults: { source: 'GOOGLE_SHEETS' },
            }
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
    options?: { skipRowNumbers?: number[]; actor?: ImportActor },
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
    options?: { skipRowNumbers?: number[]; actor?: ImportActor },
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
    const skipped: ImportRowNeedsReview[] = [];
    // R15 — a one-time import lists the file's columns OMS never imports.
    const warnings: ImportPreviewWarning[] = options?.actor
      ? restrictedColumnWarnings(table.headers, mapping).map((message) => ({
          rowNumber: null,
          message,
        }))
      : [];
    const collect = (rowNumbers: number[], result: ImportRowResult) => {
      for (const rowNumber of rowNumbers) {
        if (result.skipped) skipped.push({ rowNumber, reason: result.skipped });
        for (const message of result.warnings ?? []) {
          warnings.push({ rowNumber, message });
        }
      }
    };

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
          const result = await handler.importGroup(
            groupRows.map((r) => r.mappedRow),
            userId,
            { dryRun: true, context: rowDefaults, actor: options?.actor },
          );
          collect(
            groupRows.map((row) => row.rowNumber),
            result,
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
          const result = await handler.importRow(mappedRow, userId, {
            dryRun: true,
            context: rowDefaults,
            actor: options?.actor,
          });
          collect([rowNumber], result);
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
    // A row counted as invalid never double-counts as a duplicate, a
    // needs-review or a skipped row too — the buckets partition every row
    // exactly once, so they always sum to `totalRows`.
    const duplicateOnlyCount = [...duplicateRowNumbers].filter(
      (rowNumber) => !invalidRowNumbers.has(rowNumber),
    ).length;
    const skippedOnly = skipped.filter(
      (row) =>
        !invalidRowNumbers.has(row.rowNumber) &&
        !duplicateRowNumbers.has(row.rowNumber),
    );
    const summary: ImportPreviewSummary = {
      totalRows: table.rows.length,
      invalidCount: invalidRowNumbers.size,
      duplicateCount: duplicateOnlyCount,
      needsReviewCount: needsReviewRowNumbers.size,
      skippedCount: skippedOnly.length,
      newCount:
        table.rows.length -
        invalidRowNumbers.size -
        duplicateOnlyCount -
        needsReviewRowNumbers.size -
        skippedOnly.length,
    };

    return {
      totalRows: table.rows.length,
      errorCount: errors.length,
      errors,
      duplicateGroups,
      needsReview,
      skipped: skippedOnly,
      warnings,
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
  async run(id: string, userId?: string, options?: ImportRunOptions) {
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
    options?: ImportRunOptions,
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
    // R15 — the run is claimed atomically: a double click (or a second tab)
    // finds the job already IMPORTING and is refused, never run twice.
    const claimed = await this.prisma.importJob.updateMany({
      where: { id, status: ImportJobStatus.VALIDATING },
      data: { status: ImportJobStatus.IMPORTING, startedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'IMPORT_ALREADY_RUNNING',
        message:
          'هذا الاستيراد قيد التشغيل أو انتهى بالفعل — This import is already running or has finished.',
      });
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
    const actor = options?.actor;

    const startedAt = Date.now();
    let successCount = 0;
    const errors: Prisma.ImportJobErrorCreateManyInput[] = [];
    // R15 — skipped (already imported) rows and created rows' notices: kept
    // with their reason for the summary and the report, never counted as
    // created or as errors.
    const outcomes: Prisma.ImportJobErrorCreateManyInput[] = [];
    // Per-row created-record ids (Data Synchronization write-back only —
    // e.g. writing "OMS Order ID" back to the source sheet needs to know
    // exactly which row produced which Store Order, not just an aggregate
    // count). `noChange` mirrors `ImportRowResult.noChange` — a handler
    // that detected nothing needed to change for this row. Every other
    // caller ignores both fields.
    const successRows: {
      rowNumber: number;
      id: string;
      noChange?: boolean;
      skippedFinal?: boolean;
    }[] = [];
    const recordSuccess = (
      rows: { rowNumber: number; sourceRow: Record<string, string> }[],
      result: ImportRowResult,
    ) => {
      for (const { rowNumber, sourceRow } of rows) {
        // A skipped row is "no change" for the sync's write-back.
        successRows.push({
          rowNumber,
          id: result.id,
          noChange: result.noChange || Boolean(result.skipped),
          skippedFinal: result.skippedFinal,
        });
        const outcome = result.skipped
          ? `${SKIPPED_PREFIX}${result.skipped}`
          : result.notice
            ? `${NOTICE_PREFIX}${result.notice}`
            : null;
        if (outcome) {
          outcomes.push({
            importJobId: id,
            rowNumber,
            columnName: null,
            errorMessage: outcome,
            rawRowData: sourceRow,
          });
        }
      }
      if (!result.skipped) successCount += rows.length;
    };

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
            { context: rowDefaults, actor },
          );
          recordSuccess(groupRows, result);
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
            actor,
          });
          recordSuccess([{ rowNumber, sourceRow }], result);
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

    if (errors.length > 0 || outcomes.length > 0) {
      await this.prisma.importJobError.createMany({
        data: [...errors, ...outcomes],
      });
    }

    const durationMs = Date.now() - startedAt;
    // Rows skipped as already imported are a clean outcome, not a failure.
    const skippedCount = outcomes.filter((row) =>
      row.errorMessage.startsWith(SKIPPED_PREFIX),
    ).length;
    const finalStatus =
      successCount + skippedCount > 0
        ? ImportJobStatus.COMPLETED
        : ImportJobStatus.FAILED;

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

    return {
      ...updated,
      summary: summarizeJobRows(updated.errors, updated.successCount),
      successRows,
    };
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

  /**
   * Business operation: Confirm a needs-review row — writes the record for
   * real, then removes the flagged row and counts it as a success. The sync
   * (no actor) goes through the handler's `resolveNeedsReview`; a one-time
   * import (R15) re-runs the row — with every row of its document for a
   * grouped type, so a multi-line order is never written line by line —
   * with `confirmed: true`, every other rule applying again.
   */
  async confirmRow(
    jobId: string,
    rowId: string,
    userId?: string,
    actor?: ImportActor,
  ) {
    return (await this.confirmRowInner(jobId, rowId, userId, actor)).result;
  }

  private async confirmRowInner(
    jobId: string,
    rowId: string,
    userId?: string,
    actor?: ImportActor,
  ): Promise<{ result: ImportRowResult; rowIds: string[] }> {
    const job = await this.findOne(jobId);
    const row = await this.getNeedsReviewRow(jobId, rowId);
    const handler = this.registry.get(job.importType);
    const columnMapping = (job.columnMapping ?? {}) as Record<string, string>;
    const remap = (raw: unknown) =>
      this.remapRow(
        raw as Record<string, unknown>,
        columnMapping,
        handler.fields,
      );

    if (!actor) {
      if (!handler.resolveNeedsReview) {
        throw new BadRequestException(
          `Import type "${job.importType}" has no needs-review resolution.`,
        );
      }
      const result = await handler.resolveNeedsReview(
        remap(row.rawRowData),
        userId,
      );
      await this.settleConfirmedRows(jobId, [row.id], result);
      return { result, rowIds: [row.id] };
    }

    const rows = await this.reviewGroupOf(jobId, row, handler.groupKey, remap);
    const options = {
      actor,
      confirmed: true,
      context: (job.rowDefaults as Record<string, string> | null) ?? undefined,
    };
    const mapped = rows.map((candidate) => remap(candidate.rawRowData));
    const result =
      handler.groupKey && handler.importGroup
        ? await handler.importGroup(mapped, userId, options)
        : await handler.importRow(mapped[0], userId, options);
    const rowIds = rows.map((candidate) => candidate.id);
    await this.settleConfirmedRows(jobId, rowIds, result);
    return { result, rowIds };
  }

  /** The open needs-review rows of the same document (same group key value) as `row`. */
  private async reviewGroupOf(
    jobId: string,
    row: { id: string; rawRowData: unknown },
    groupKey: string | undefined,
    remap: (raw: unknown) => Record<string, string>,
  ) {
    const key = groupKey
      ? remap(row.rawRowData)[groupKey]?.trim().toLocaleLowerCase('en-US')
      : '';
    if (!groupKey || !key) return [row];
    const open = await this.prisma.importJobError.findMany({
      where: {
        importJobId: jobId,
        errorMessage: { startsWith: NEEDS_REVIEW_PREFIX },
        rejectedAt: null,
      },
      orderBy: { rowNumber: 'asc' },
    });
    return open.filter(
      (candidate) =>
        remap(candidate.rawRowData)
          [groupKey]?.trim()
          .toLocaleLowerCase('en-US') === key,
    );
  }

  /** Confirmed rows leave the review list: created (success) or, when already in OMS, kept as skipped. */
  private async settleConfirmedRows(
    jobId: string,
    rowIds: string[],
    result: ImportRowResult,
  ) {
    await this.prisma.$transaction([
      result.skipped
        ? this.prisma.importJobError.updateMany({
            where: { id: { in: rowIds } },
            data: { errorMessage: `${SKIPPED_PREFIX}${result.skipped}` },
          })
        : this.prisma.importJobError.deleteMany({
            where: { id: { in: rowIds } },
          }),
      this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          successCount: { increment: result.skipped ? 0 : rowIds.length },
          errorCount: { decrement: rowIds.length },
        },
      }),
    ]);
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
  async confirmRows(
    jobId: string,
    rowIds: string[],
    userId?: string,
    actor?: ImportActor,
  ) {
    const results: { id: string; success: boolean; message?: string }[] = [];
    // A grouped document confirms all of its rows at once.
    const settled = new Set<string>();
    for (const rowId of rowIds) {
      if (settled.has(rowId)) {
        results.push({ id: rowId, success: true });
        continue;
      }
      try {
        const confirmed = await this.confirmRowInner(
          jobId,
          rowId,
          userId,
          actor,
        );
        confirmed.rowIds.forEach((id) => settled.add(id));
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

  /**
   * "Download Error Report" (Part 6) — one line per reported row with its
   * outcome (R15: rejected / needs review / skipped as already imported /
   * created with a notice) and reason, so a corrected file can be rebuilt.
   */
  async exportErrorsCsv(id: string): Promise<string> {
    const job = await this.findOne(id);
    const header = ['Row', 'Result', 'Column', 'Reason', 'Suggested Fix'];
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    for (const error of job.errors) {
      const { outcome, reason } = describeJobRow(error);
      lines.push(
        [
          error.rowNumber,
          outcome,
          error.columnName ?? '',
          quote(reason),
          quote(error.suggestedFix ?? ''),
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
