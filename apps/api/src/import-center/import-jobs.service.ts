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
import { groupRowsByKey } from './import-value.util';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { SetMappingDto } from './dto/set-mapping.dto';

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
 * `LeadDuplicateDetectionService`, and isn't rolled up here yet —
 * `needsReviewCount` stays 0 until every handler exposes that signal,
 * rather than a fabricated number.
 */
export interface ImportPreviewSummary {
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  needsReviewCount: number;
}

export interface ImportValidationResult {
  totalRows: number;
  errorCount: number;
  errors: ImportRowValidationError[];
  duplicateGroups: ImportDuplicateGroup[];
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

  async findAll(importType?: string) {
    return this.prisma.importJob.findMany({
      where: importType ? { importType } : undefined,
      orderBy: { createdAt: 'desc' },
      include: JOB_INCLUDE,
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
        return !column || !table.headers.includes(column);
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
  async validate(id: string, userId?: string): Promise<ImportValidationResult> {
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
    const uniqueFields = handler.fields.filter(
      (field) => field.uniqueWithinFile,
    );

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

    if (handler.groupKey && handler.importGroup) {
      const groups = groupRowsByKey(mappedRows, handler.groupKey);
      for (const groupRows of groups.values()) {
        try {
          await handler.importGroup(
            groupRows.map((r) => r.mappedRow),
            userId,
            { dryRun: true },
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Validation failed.';
          for (const { rowNumber } of groupRows) {
            errors.push({ rowNumber, columnName: null, message });
          }
        }
      }
    } else {
      for (const { rowNumber, mappedRow } of mappedRows) {
        try {
          await handler.importRow(mappedRow, userId, { dryRun: true });
        } catch (error) {
          errors.push({
            rowNumber,
            columnName: null,
            message:
              error instanceof Error ? error.message : 'Validation failed.',
          });
        }
      }
    }

    errors.sort((a, b) => a.rowNumber - b.rowNumber);

    const invalidRowNumbers = new Set(errors.map((e) => e.rowNumber));
    const duplicateRowNumbers = new Set(
      duplicateGroups.flatMap((group) => group.rowNumbers),
    );
    // A row counted as invalid never double-counts as a duplicate too — the
    // three buckets partition every row exactly once, so they always sum to
    // `totalRows`.
    const duplicateOnlyCount = [...duplicateRowNumbers].filter(
      (rowNumber) => !invalidRowNumbers.has(rowNumber),
    ).length;
    const summary: ImportPreviewSummary = {
      totalRows: table.rows.length,
      invalidCount: invalidRowNumbers.size,
      duplicateCount: duplicateOnlyCount,
      newCount: table.rows.length - invalidRowNumbers.size - duplicateOnlyCount,
      needsReviewCount: 0,
    };

    return {
      totalRows: table.rows.length,
      errorCount: errors.length,
      errors,
      duplicateGroups,
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
  async run(id: string, userId?: string) {
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

    await this.prisma.importJob.update({
      where: { id },
      data: { status: ImportJobStatus.IMPORTING, startedAt: new Date() },
    });

    const startedAt = Date.now();
    let successCount = 0;
    const errors: Prisma.ImportJobErrorCreateManyInput[] = [];

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

    if (handler.groupKey && handler.importGroup) {
      const groups = groupRowsByKey(mappedRows, handler.groupKey);
      for (const groupRows of groups.values()) {
        try {
          await handler.importGroup(
            groupRows.map((r) => r.mappedRow),
            userId,
          );
          successCount += groupRows.length;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Import failed.';
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
        try {
          await handler.importRow(mappedRow, userId);
          successCount++;
        } catch (error) {
          errors.push({
            importJobId: id,
            rowNumber,
            columnName: null,
            errorMessage:
              error instanceof Error ? error.message : 'Import failed.',
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

    return this.prisma.importJob.update({
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
