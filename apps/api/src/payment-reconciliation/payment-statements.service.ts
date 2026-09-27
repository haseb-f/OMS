import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  PaymentStatementLineStatus,
  PaymentStatementSourceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import { GoogleSheetsService } from '../import-center/google-sheets.service';
import { parseGoogleSheetsUrl } from '../import-center/google-sheets.util';
import { parseCsv } from '../import-center/csv-parser.util';
import {
  XlsxLimitError,
  assertXlsxArchiveWithinLimits,
  parseXlsxWorkbook,
} from '../import-center/xlsx-parser.util';
import { isAfterCairoToday } from '../accounting/fx/fx-dates';
import {
  EXCEPTION_REASON,
  STATEMENT_FIELDS,
  decideStatementUpsert,
  normalizeStatementRow,
  statementDedupeKey,
  statementRowHash,
  suggestStatementMapping,
  validateStatementMapping,
  type NormalizedStatementRow,
  type StatementMappingConfig,
  type StatementUpsertDecision,
} from './statement-row.util';
import type {
  ConnectSheetDto,
  ManualStatementLineDto,
  StatementMappingDto,
} from './dto/payment-reconciliation.dto';

export interface SourceRow {
  rowNumber: number;
  raw: Record<string, string>;
}

export interface SourceTable {
  headers: string[];
  rows: SourceRow[];
  sheetName: string | null;
}

export type RowOutcome = StatementUpsertDecision | 'ERROR';

export interface PlannedRow {
  rowNumber: number;
  outcome: RowOutcome;
  errors?: string[];
  dedupeKey?: string;
  rowHash?: string;
  row?: NormalizedStatementRow;
  raw: Record<string, string>;
  existingLineId?: string;
}

export interface StatementRunSummary {
  importId: string | null;
  totalRows: number;
  createdRows: number;
  duplicateRows: number;
  updatedRows: number;
  reopenedRows: number;
  exceptionRows: number;
  deletedAtSourceRows: number;
  errorRows: number;
  errors: { rowNumber: number; messages: string[] }[];
}

const SHEET_CONNECTION_KIND = 'SHEET_CONNECTION';

/** Upload cap (multer `limits.fileSize` in the controller, re-checked here). */
export const STATEMENT_MAX_BYTES = 5 * 1024 * 1024;
/** Data rows per file / sheet read — larger statements are split by the user. */
export const STATEMENT_MAX_ROWS = 5000;
export const STATEMENT_MAX_COLUMNS = 100;
/** Zip-bomb guard: declared uncompressed size of all .xlsx parts. */
export const STATEMENT_XLSX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
/** Rows per createMany / per `IN (...)` dedupe lookup. */
const WRITE_CHUNK = 500;
const LOOKUP_CHUNK = 1000;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Row/column caps shared by every statement channel (file, sheet). */
export function assertStatementTableWithinLimits(table: {
  headers: string[];
  rows: unknown[];
}) {
  if (table.headers.length > STATEMENT_MAX_COLUMNS) {
    throw new BadRequestException(
      `The statement has ${table.headers.length} columns — the limit is ${STATEMENT_MAX_COLUMNS}.`,
    );
  }
  if (table.rows.length > STATEMENT_MAX_ROWS) {
    throw new BadRequestException(
      `The statement has ${table.rows.length} data rows — the limit is ${STATEMENT_MAX_ROWS} per import. Split it into smaller files (or sheet tabs).`,
    );
  }
}

const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;
const SHEET_GID_PATTERN = /^\d{1,12}$/;

function canonicalSheetUrl(spreadsheetId: string, gid: string | null) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${gid ? `#gid=${gid}` : ''}`;
}

/**
 * The only sheet URL ever stored or rendered is rebuilt from the validated
 * spreadsheet id (and numeric gid) — never the user-supplied string.
 */
export function canonicalSheetSource(input: string): {
  spreadsheetId: string;
  gid: string | null;
  url: string;
} {
  const { spreadsheetId, gid } = parseGoogleSheetsUrl(input ?? '');
  if (!SHEET_ID_PATTERN.test(spreadsheetId)) {
    throw new BadRequestException(
      "That Google Sheets link has an invalid spreadsheet id — copy the link from the sheet's address bar (https://docs.google.com/spreadsheets/d/<id>/edit).",
    );
  }
  const cleanGid = gid && SHEET_GID_PATTERN.test(gid) ? gid : null;
  return {
    spreadsheetId,
    gid: cleanGid,
    url: canonicalSheetUrl(spreadsheetId, cleanGid),
  };
}
const SYNC_LOCK_STALE_MINUTES = 15;
const PREVIEW_ROW_LIMIT = 100;
const SUMMARY_ROW_LIMIT = 2000;

interface SheetConnectionSummary {
  kind: typeof SHEET_CONNECTION_KIND;
  url: string;
  spreadsheetId: string;
  gid: string | null;
  isSyncing?: boolean;
  syncingSince?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: 'SUCCESS' | 'FAILED' | null;
  lastSyncError?: string | null;
  lastSyncResult?: StatementRunSummary | null;
  connectedBy?: string | null;
}

function toMappingConfig(
  dto: StatementMappingDto | StatementMappingConfig | null | undefined,
): StatementMappingConfig {
  const columns: StatementMappingConfig['columns'] = {};
  const source = (dto?.columns ?? {}) as Record<string, unknown>;
  for (const field of STATEMENT_FIELDS) {
    const header = source[field];
    if (typeof header === 'string' && header.trim()) columns[field] = header;
  }
  return {
    columns,
    defaultCurrencyCode: dto?.defaultCurrencyCode?.trim().toUpperCase() || null,
    phoneRegion: dto?.phoneRegion?.trim().toUpperCase() || null,
    dateFormat: dto?.dateFormat ?? 'DMY',
  };
}

/** Parses the multipart `mapping` text field (JSON) — a malformed value is a 400, never a silent default. */
export function parseMappingField(
  value: string | undefined,
): StatementMappingConfig | null {
  if (!value?.trim()) return null;
  try {
    return toMappingConfig(JSON.parse(value) as StatementMappingDto);
  } catch {
    throw new BadRequestException('mapping must be valid JSON.');
  }
}

/** The service-account email users must share their sheet with — read from the same key GoogleSheetsService uses; never the key itself. */
export function googleServiceAccountEmail(): string | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text) as { client_email?: unknown };
    return typeof parsed.client_email === 'string' ? parsed.client_email : null;
  } catch {
    return null;
  }
}

/**
 * Provider statements (spec §4): file import (CSV/XLSX) with mapping,
 * preview and row validation; Google Sheets connect + repeatable sync; manual
 * entry. Every channel produces `PaymentStatementLine` rows with provenance
 * through ONE planning function, and statements never create accounting
 * entries. Writes for one payment method are serialized by a transaction
 * advisory lock, and the (method, dedupeKey) unique index is the last line of
 * defense against a duplicate line.
 */
@Injectable()
export class PaymentStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phone: PhoneNumberService,
    private readonly sheets: GoogleSheetsService,
  ) {}

  // ---------------------------------------------------------------- helpers

  async requireReconciledMethod(methodId: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, deletedAt: null },
      select: {
        id: true,
        name: true,
        requiresReconciliation: true,
        isActive: true,
      },
    });
    if (!method) throw new NotFoundException('Payment method not found.');
    if (!method.requiresReconciliation) {
      throw new BadRequestException(
        `Payment method "${method.name}" does not require reconciliation — enable "Requires reconciliation" on the method first.`,
      );
    }
    return method;
  }

  private async currencyCatalog() {
    const currencies = await this.prisma.currency.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true },
    });
    return new Map(currencies.map((c) => [c.code.toUpperCase(), c.id]));
  }

  /** Parses an uploaded statement ONCE, enforcing the size, zip-expansion, row and column caps. */
  async readUploadedFile(file: {
    originalname: string;
    buffer: Buffer;
  }): Promise<SourceTable> {
    if (file.buffer.length > STATEMENT_MAX_BYTES) {
      throw new PayloadTooLargeException(
        `The file is larger than ${STATEMENT_MAX_BYTES / 1024 / 1024} MB — split the statement into smaller files.`,
      );
    }
    const name = file.originalname.toLowerCase();
    let table: { headers: string[]; rows: Record<string, string>[] };
    let sheetName: string | null = null;
    if (name.endsWith('.xlsx')) {
      try {
        assertXlsxArchiveWithinLimits(
          file.buffer,
          STATEMENT_XLSX_MAX_UNCOMPRESSED_BYTES,
        );
        const parsed = await parseXlsxWorkbook(file.buffer, {
          maxRows: STATEMENT_MAX_ROWS,
          maxColumns: STATEMENT_MAX_COLUMNS,
        });
        table = parsed;
        sheetName = parsed.sheetName;
      } catch (error) {
        if (error instanceof XlsxLimitError) {
          throw new BadRequestException(error.message);
        }
        throw new BadRequestException(
          'The .xlsx file could not be read — save it again from Excel or upload a .csv.',
        );
      }
    } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = file.buffer.toString('utf-8');
      table = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } else {
      throw new BadRequestException(
        'Unsupported file type — upload a .csv or .xlsx statement.',
      );
    }
    assertStatementTableWithinLimits(table);
    return {
      headers: table.headers,
      rows: table.rows.map((raw, index) => ({ rowNumber: index + 2, raw })),
      sheetName,
    };
  }

  /** Header row + non-blank data rows, keeping the sheet's real row numbers. */
  async readSheet(spreadsheetId: string, gid: string | null) {
    const grid = await this.sheets.getSheetData(
      spreadsheetId,
      gid ?? undefined,
    );
    const [headerRow = [], ...dataRows] = grid;
    const headers = headerRow.map((h) => `${h ?? ''}`.trim());
    assertStatementTableWithinLimits({ headers, rows: dataRows });
    const rows: SourceRow[] = [];
    dataRows.forEach((cells, index) => {
      if (!cells.some((value) => `${value ?? ''}`.trim() !== '')) return;
      const raw: Record<string, string> = {};
      headers.forEach((header, column) => {
        if (header) raw[header] = `${cells[column] ?? ''}`.trim();
      });
      rows.push({ rowNumber: index + 2, raw });
    });
    return { headers, rows };
  }

  /**
   * Validates and classifies every row against the method's existing lines
   * WITHOUT writing — used verbatim by preview and by commit, so what the
   * user previews is exactly what commit does.
   */
  async planRows(
    client: Prisma.TransactionClient | PrismaService,
    methodId: string,
    rows: SourceRow[],
    config: StatementMappingConfig,
  ): Promise<PlannedRow[]> {
    const catalog = await this.currencyCatalog();
    const codes = new Set(catalog.keys());
    const normalized = rows.map((source) => {
      const result = normalizeStatementRow(source.raw, config, codes);
      if (!result.ok) {
        return {
          rowNumber: source.rowNumber,
          raw: source.raw,
          outcome: 'ERROR' as const,
          errors: result.errors,
        };
      }
      const rowHash = statementRowHash(result.row);
      return {
        rowNumber: source.rowNumber,
        raw: source.raw,
        row: result.row,
        rowHash,
        dedupeKey: statementDedupeKey(result.row, rowHash),
      };
    });

    const keys = [
      ...new Set(
        normalized.flatMap((entry) =>
          entry.dedupeKey ? [entry.dedupeKey] : [],
        ),
      ),
    ];
    const existing: {
      id: string;
      dedupeKey: string;
      status: PaymentStatementLineStatus;
      rowHash: string | null;
      matchedAmount: Prisma.Decimal;
      exceptionReason: string | null;
    }[] = [];
    for (const keyChunk of chunks(keys, LOOKUP_CHUNK)) {
      existing.push(
        ...(await client.paymentStatementLine.findMany({
          where: { paymentMethodId: methodId, dedupeKey: { in: keyChunk } },
          select: {
            id: true,
            dedupeKey: true,
            status: true,
            rowHash: true,
            matchedAmount: true,
            exceptionReason: true,
          },
        })),
      );
    }
    const byKey = new Map(existing.map((line) => [line.dedupeKey, line]));

    const seenInBatch = new Map<string, string>();
    return normalized.map((entry): PlannedRow => {
      if (!('dedupeKey' in entry) || !entry.dedupeKey || !entry.rowHash) {
        return entry as PlannedRow;
      }
      const priorHash = seenInBatch.get(entry.dedupeKey);
      if (priorHash !== undefined) {
        if (priorHash === entry.rowHash) {
          return { ...entry, outcome: 'DUPLICATE' };
        }
        return {
          rowNumber: entry.rowNumber,
          raw: entry.raw,
          outcome: 'ERROR',
          errors: [
            `Provider reference "${entry.row?.providerReference}" appears more than once in this source with different values.`,
          ],
        };
      }
      seenInBatch.set(entry.dedupeKey, entry.rowHash);
      const line = byKey.get(entry.dedupeKey);
      const outcome = decideStatementUpsert(
        line
          ? {
              status: line.status,
              rowHash: line.rowHash,
              matchedAmount: Number(line.matchedAmount),
              exceptionReason: line.exceptionReason,
            }
          : null,
        entry.rowHash,
      );
      return { ...entry, outcome, existingLineId: line?.id };
    });
  }

  private lineData(
    planned: PlannedRow,
    currencyId: string,
    phoneRegion: string | null | undefined,
  ) {
    const row = planned.row as NormalizedStatementRow;
    const parsedPhone = row.customerPhone
      ? this.phone.parse(row.customerPhone, phoneRegion ?? undefined)
      : null;
    return {
      providerReference: row.providerReference,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      customerPhoneE164: parsedPhone?.isValid ? parsedPhone.e164 : null,
      orderReference: row.orderReference,
      amount: new Prisma.Decimal(row.amount.toFixed(2)),
      currencyId,
      transactionDate: new Date(`${row.transactionDate}T00:00:00.000Z`),
      providerStatus: row.providerStatus,
      feeAmount:
        row.feeAmount === null
          ? null
          : new Prisma.Decimal(row.feeAmount.toFixed(2)),
      netAmount:
        row.netAmount === null
          ? null
          : new Prisma.Decimal(row.netAmount.toFixed(2)),
      rawRow: planned.raw as Prisma.InputJsonValue,
      rowHash: planned.rowHash ?? null,
      rowNumber: planned.rowNumber,
    };
  }

  private static summarize(planned: PlannedRow[]) {
    const count = (outcome: RowOutcome) =>
      planned.filter((entry) => entry.outcome === outcome).length;
    return {
      totalRows: planned.length,
      createdRows: count('CREATE'),
      duplicateRows: count('DUPLICATE'),
      updatedRows: count('UPDATE'),
      reopenedRows: count('REAPPEARED'),
      exceptionRows: count('EXCEPTION_CHANGED_AFTER_MATCH'),
      errorRows: count('ERROR'),
      errors: planned
        .filter((entry) => entry.outcome === 'ERROR')
        .slice(0, SUMMARY_ROW_LIMIT)
        .map((entry) => ({
          rowNumber: entry.rowNumber,
          messages: entry.errors ?? [],
        })),
    };
  }

  private async lockMethod(tx: Prisma.TransactionClient, methodId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-statement:${methodId}`}))`;
  }

  /**
   * Applies a planned batch inside ONE transaction: creates the import row,
   * then every line create/update/flag. When `syncSourceId` is set, lines
   * previously delivered by that source but absent now are flagged
   * "Deleted at source" (never deleted).
   */
  async commitRows(args: {
    methodId: string;
    sourceType: PaymentStatementSourceType;
    rows: SourceRow[];
    config: StatementMappingConfig;
    userId: string;
    fileName?: string | null;
    sheetName?: string | null;
    syncSourceId?: string | null;
  }): Promise<StatementRunSummary> {
    const { methodId, config, userId } = args;
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockMethod(tx, methodId);
        const planned = await this.planRows(tx, methodId, args.rows, config);
        const catalog = await this.currencyCatalog();
        const base = PaymentStatementsService.summarize(planned);

        const statementImport = await tx.paymentStatementImport.create({
          data: {
            paymentMethodId: methodId,
            sourceType: args.sourceType,
            fileName: args.fileName ?? null,
            sheetName: args.sheetName ?? null,
            syncSourceId: args.syncSourceId ?? null,
            mapping: config as unknown as Prisma.InputJsonValue,
            createdBy: userId,
          },
        });

        const outcomes: {
          rowNumber: number;
          outcome: string;
          lineId: string | null;
          message?: string;
        }[] = [];
        const changes: {
          lineId: string;
          rowNumber: number;
          before: unknown;
          after: unknown;
        }[] = [];

        const lineDataOf = (entry: PlannedRow) =>
          this.lineData(
            entry,
            catalog.get(
              (entry.row as NormalizedStatementRow).currencyCode,
            ) as string,
            config.phoneRegion,
          );

        // New lines: chunked createMany — one round trip per WRITE_CHUNK rows.
        const creates = planned.filter((entry) => entry.outcome === 'CREATE');
        for (const batch of chunks(creates, WRITE_CHUNK)) {
          const created = await tx.paymentStatementLine.createManyAndReturn({
            data: batch.map((entry) => ({
              ...lineDataOf(entry),
              paymentMethodId: methodId,
              importId: statementImport.id,
              sourceType: args.sourceType,
              dedupeKey: entry.dedupeKey as string,
              sheetName: args.sheetName ?? null,
              createdBy: userId,
            })),
            select: { id: true, dedupeKey: true },
          });
          const idByKey = new Map(created.map((l) => [l.dedupeKey, l.id]));
          for (const entry of batch) {
            outcomes.push({
              rowNumber: entry.rowNumber,
              outcome: 'CREATED',
              lineId: idByKey.get(entry.dedupeKey as string) ?? null,
            });
          }
        }

        for (const entry of planned) {
          if (
            entry.outcome === 'ERROR' ||
            entry.outcome === 'DUPLICATE' ||
            entry.outcome === 'CREATE'
          ) {
            continue;
          }
          const data = lineDataOf(entry);

          const lineId = entry.existingLineId as string;
          const current = await tx.paymentStatementLine.findUniqueOrThrow({
            where: { id: lineId },
          });

          if (entry.outcome === 'EXCEPTION_CHANGED_AFTER_MATCH') {
            const reason = `${EXCEPTION_REASON.CHANGED_AFTER_MATCH} (import ${statementImport.id}, row ${entry.rowNumber})`;
            await tx.paymentStatementLine.update({
              where: { id: lineId },
              data: {
                status: PaymentStatementLineStatus.EXCEPTION,
                exceptionReason: reason,
                updatedBy: userId,
              },
            });
            changes.push({
              lineId,
              rowNumber: entry.rowNumber,
              before: current.rawRow,
              after: entry.raw,
            });
            outcomes.push({
              rowNumber: entry.rowNumber,
              outcome: 'EXCEPTION',
              lineId,
              message: reason,
            });
            continue;
          }

          if (entry.outcome === 'REAPPEARED') {
            await tx.paymentStatementLine.update({
              where: { id: lineId },
              data: {
                status: PaymentStatementLineStatus.UNMATCHED,
                exceptionReason: null,
                updatedBy: userId,
              },
            });
            outcomes.push({
              rowNumber: entry.rowNumber,
              outcome: 'REOPENED',
              lineId,
              message: 'Row reappeared at source',
            });
            continue;
          }

          // UPDATE — content changed on a line with no allocation.
          const reopen =
            current.status === PaymentStatementLineStatus.EXCEPTION &&
            !!current.exceptionReason?.startsWith(
              EXCEPTION_REASON.DELETED_AT_SOURCE,
            );
          await tx.paymentStatementLine.update({
            where: { id: lineId },
            data: {
              ...data,
              ...(reopen
                ? {
                    status: PaymentStatementLineStatus.UNMATCHED,
                    exceptionReason: null,
                  }
                : {}),
              updatedBy: userId,
            },
          });
          changes.push({
            lineId,
            rowNumber: entry.rowNumber,
            before: current.rawRow,
            after: entry.raw,
          });
          outcomes.push({
            rowNumber: entry.rowNumber,
            outcome: 'UPDATED',
            lineId,
            message: 'Source row changed before any match — line updated',
          });
        }

        let deletedAtSourceRows = 0;
        if (args.syncSourceId) {
          const presentKeys = planned.flatMap((entry) =>
            entry.dedupeKey ? [entry.dedupeKey] : [],
          );
          const missing = await tx.paymentStatementLine.findMany({
            where: {
              paymentMethodId: methodId,
              statementImport: { syncSourceId: args.syncSourceId },
              dedupeKey: {
                notIn: presentKeys.length ? presentKeys : ['\u0000'],
              },
              status: { not: PaymentStatementLineStatus.IGNORED },
              // Explicit NULL branch: SQL `NOT (reason LIKE ...)` is NULL (not
              // true) for a line without a reason.
              OR: [
                { exceptionReason: null },
                {
                  NOT: {
                    exceptionReason: {
                      startsWith: EXCEPTION_REASON.DELETED_AT_SOURCE,
                    },
                  },
                },
              ],
            },
            select: { id: true, rowNumber: true },
          });
          for (const batch of chunks(missing, WRITE_CHUNK)) {
            await tx.paymentStatementLine.updateMany({
              where: { id: { in: batch.map((line) => line.id) } },
              data: {
                status: PaymentStatementLineStatus.EXCEPTION,
                exceptionReason: `${EXCEPTION_REASON.DELETED_AT_SOURCE} (sync ${statementImport.id})`,
                updatedBy: userId,
              },
            });
          }
          for (const line of missing) {
            outcomes.push({
              rowNumber: line.rowNumber ?? 0,
              outcome: 'DELETED_AT_SOURCE',
              lineId: line.id,
              message: EXCEPTION_REASON.DELETED_AT_SOURCE,
            });
          }
          deletedAtSourceRows = missing.length;
        }

        const summary: StatementRunSummary = {
          importId: statementImport.id,
          ...base,
          exceptionRows: base.exceptionRows + deletedAtSourceRows,
          deletedAtSourceRows,
        };
        await tx.paymentStatementImport.update({
          where: { id: statementImport.id },
          data: {
            totalRows: summary.totalRows,
            createdRows: summary.createdRows,
            duplicateRows: summary.duplicateRows,
            exceptionRows: summary.exceptionRows,
            errorRows: summary.errorRows,
            summary: {
              ...summary,
              outcomes: outcomes.slice(0, SUMMARY_ROW_LIMIT),
              changes: changes.slice(0, SUMMARY_ROW_LIMIT),
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return summary;
      },
      { maxWait: 15_000, timeout: 120_000 },
    );
  }

  private assertMapping(config: StatementMappingConfig, headers: string[]) {
    const errors = validateStatementMapping(config, headers);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: errors.join(' '),
        errors,
      });
    }
  }

  private previewPayload(
    table: { headers: string[]; sheetName?: string | null },
    config: StatementMappingConfig,
    planned: PlannedRow[] | null,
    mappingErrors: string[],
  ) {
    return {
      headers: table.headers,
      sheetName: table.sheetName ?? null,
      mapping: config,
      mappingErrors,
      summary: planned ? PaymentStatementsService.summarize(planned) : null,
      rows: (planned ?? []).slice(0, PREVIEW_ROW_LIMIT).map((entry) => ({
        rowNumber: entry.rowNumber,
        outcome: entry.outcome,
        errors: entry.errors ?? [],
        row: entry.row ?? null,
        raw: entry.raw,
      })),
    };
  }

  // ------------------------------------------------------------ file import

  async previewFile(
    methodId: string,
    file: { originalname: string; buffer: Buffer },
    mapping: StatementMappingConfig | null,
  ) {
    await this.requireReconciledMethod(methodId);
    const table = await this.readUploadedFile(file);
    const config =
      mapping ??
      toMappingConfig({ columns: suggestStatementMapping(table.headers) });
    const mappingErrors = validateStatementMapping(config, table.headers);
    const planned =
      mappingErrors.length === 0
        ? await this.planRows(this.prisma, methodId, table.rows, config)
        : null;
    return this.previewPayload(table, config, planned, mappingErrors);
  }

  async commitFile(
    methodId: string,
    file: { originalname: string; buffer: Buffer },
    mapping: StatementMappingConfig | null,
    userId: string,
  ) {
    await this.requireReconciledMethod(methodId);
    if (!mapping) {
      throw new BadRequestException(
        'Confirm the column mapping before importing.',
      );
    }
    const table = await this.readUploadedFile(file);
    this.assertMapping(mapping, table.headers);
    if (table.rows.length === 0) {
      throw new BadRequestException('The file has no data rows.');
    }
    return this.commitRows({
      methodId,
      sourceType: PaymentStatementSourceType.FILE,
      rows: table.rows,
      config: mapping,
      userId,
      fileName: file.originalname,
      sheetName: table.sheetName,
    });
  }

  // ----------------------------------------------------------- manual entry

  async createManualLine(
    methodId: string,
    dto: ManualStatementLineDto,
    userId: string,
  ) {
    await this.requireReconciledMethod(methodId);
    const currency = await this.prisma.currency.findFirst({
      where: { id: dto.currencyId, deletedAt: null },
      select: { code: true },
    });
    if (!currency) throw new BadRequestException('Currency not found.');
    const txDate = new Date(`${dto.transactionDate}T00:00:00.000Z`);
    if (!Number.isNaN(txDate.getTime()) && isAfterCairoToday(txDate)) {
      throw new BadRequestException(
        `Transaction date ${dto.transactionDate} is in the future — enter the date the provider recorded the payment.`,
      );
    }

    const raw: Record<string, string> = {
      providerReference: dto.providerReference ?? '',
      customerName: dto.customerName ?? '',
      customerPhone: dto.customerPhone ?? '',
      orderReference: dto.orderReference ?? '',
      amount: String(dto.amount),
      currency: currency.code,
      transactionDate: dto.transactionDate,
      providerStatus: dto.providerStatus ?? '',
      fee: dto.feeAmount === undefined ? '' : String(dto.feeAmount),
      net: dto.netAmount === undefined ? '' : String(dto.netAmount),
    };
    const config: StatementMappingConfig = {
      columns: Object.fromEntries(STATEMENT_FIELDS.map((f) => [f, f])),
      phoneRegion: dto.phoneRegion ?? null,
      dateFormat: 'YMD',
    };
    const [planned] = await this.planRows(
      this.prisma,
      methodId,
      [{ rowNumber: 1, raw }],
      config,
    );
    if (planned.outcome === 'ERROR') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: (planned.errors ?? []).join(' '),
        errors: planned.errors,
      });
    }
    if (planned.outcome !== 'CREATE') {
      throw new ConflictException({
        code: 'DUPLICATE',
        message:
          'A statement line with this provider reference (or identical content) already exists for this method — nothing was added.',
        lineId: planned.existingLineId,
      });
    }
    return this.commitRows({
      methodId,
      sourceType: PaymentStatementSourceType.MANUAL,
      rows: [{ rowNumber: 1, raw }],
      config,
      userId,
    });
  }

  // ---------------------------------------------------------- Google Sheets

  private async findConnection(methodId: string) {
    const rows = await this.prisma.paymentStatementImport.findMany({
      where: {
        paymentMethodId: methodId,
        sourceType: PaymentStatementSourceType.GOOGLE_SHEET,
        syncSourceId: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    return (
      rows.find(
        (row) =>
          (row.summary as { kind?: string } | null)?.kind ===
          SHEET_CONNECTION_KIND,
      ) ?? null
    );
  }

  private describeConnection(
    connection: Awaited<ReturnType<PaymentStatementsService['findConnection']>>,
  ) {
    if (!connection) return null;
    const summary = connection.summary as unknown as SheetConnectionSummary;
    // Rebuilt from the stored id (never the stored string), so a connection
    // saved before canonicalisation is rendered safely too.
    const gid =
      summary.gid && SHEET_GID_PATTERN.test(summary.gid) ? summary.gid : null;
    const url = SHEET_ID_PATTERN.test(summary.spreadsheetId ?? '')
      ? canonicalSheetUrl(summary.spreadsheetId, gid)
      : null;
    return {
      id: connection.id,
      url,
      spreadsheetId: summary.spreadsheetId,
      gid: summary.gid,
      sheetName: connection.sheetName,
      mapping: connection.mapping as unknown as StatementMappingConfig,
      isSyncing: !!summary.isSyncing,
      lastSyncAt: summary.lastSyncAt ?? null,
      lastSyncStatus: summary.lastSyncStatus ?? null,
      lastSyncError: summary.lastSyncError ?? null,
      lastSyncResult: summary.lastSyncResult ?? null,
      connectedAt: connection.createdAt,
    };
  }

  async getSheetSource(methodId: string) {
    await this.requireReconciledMethod(methodId);
    return {
      serviceAccountEmail: googleServiceAccountEmail(),
      configured: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
      connection: this.describeConnection(await this.findConnection(methodId)),
    };
  }

  /** Reads the sheet header so the user can build the mapping before saving the connection. */
  async previewSheet(methodId: string, dto: ConnectSheetDto) {
    await this.requireReconciledMethod(methodId);
    const { spreadsheetId, gid } = canonicalSheetSource(dto.url);
    const sheetName = await this.sheets.resolveSheetTitle(
      spreadsheetId,
      gid ?? undefined,
    );
    const table = await this.readSheet(spreadsheetId, gid);
    const config = dto.mapping
      ? toMappingConfig(dto.mapping)
      : toMappingConfig({ columns: suggestStatementMapping(table.headers) });
    const mappingErrors = validateStatementMapping(config, table.headers);
    const planned =
      mappingErrors.length === 0
        ? await this.planRows(this.prisma, methodId, table.rows, config)
        : null;
    return this.previewPayload(
      { headers: table.headers, sheetName },
      config,
      planned,
      mappingErrors,
    );
  }

  async connectSheet(methodId: string, dto: ConnectSheetDto, userId: string) {
    await this.requireReconciledMethod(methodId);
    if (!dto.mapping) {
      throw new BadRequestException(
        'Confirm the column mapping before connecting.',
      );
    }
    const { spreadsheetId, gid, url } = canonicalSheetSource(dto.url);
    const sheetName = await this.sheets.resolveSheetTitle(
      spreadsheetId,
      gid ?? undefined,
    );
    const table = await this.readSheet(spreadsheetId, gid);
    const config = toMappingConfig(dto.mapping);
    this.assertMapping(config, table.headers);

    const existing = await this.findConnection(methodId);
    const previous = existing?.summary as unknown as
      SheetConnectionSummary | undefined;
    if (previous?.isSyncing) {
      throw new ConflictException(
        'A sync is running for this source — try again when it finishes.',
      );
    }
    const summary: SheetConnectionSummary = {
      ...(previous ?? {}),
      kind: SHEET_CONNECTION_KIND,
      url,
      spreadsheetId,
      gid,
      isSyncing: false,
      connectedBy: userId,
    };
    const data = {
      sheetName,
      mapping: config as unknown as Prisma.InputJsonValue,
      summary: summary as unknown as Prisma.InputJsonValue,
    };
    const connection = existing
      ? await this.prisma.paymentStatementImport.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.paymentStatementImport.create({
          data: {
            ...data,
            paymentMethodId: methodId,
            sourceType: PaymentStatementSourceType.GOOGLE_SHEET,
            createdBy: userId,
          },
        });
    return this.describeConnection(connection);
  }

  /** Per-source lock (spec: no concurrent syncs of one source); a lock older than 15 minutes is treated as abandoned. */
  private async acquireSyncLock(connectionId: string): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE payment_statement_imports
      SET summary = COALESCE(summary, '{}'::jsonb)
        || jsonb_build_object('isSyncing', true, 'syncingSince', to_jsonb(now()))
      WHERE id = ${connectionId}::uuid
        AND (
          COALESCE((summary->>'isSyncing')::boolean, false) = false
          OR (summary->>'syncingSince')::timestamptz
             < now() - make_interval(mins => ${SYNC_LOCK_STALE_MINUTES}::int)
        )
    `;
    return changed === 1;
  }

  private async releaseSyncLock(
    connectionId: string,
    patch: Partial<SheetConnectionSummary>,
  ) {
    const json = JSON.stringify({
      ...patch,
      isSyncing: false,
      syncingSince: null,
    });
    await this.prisma.$executeRaw`
      UPDATE payment_statement_imports
      SET summary = COALESCE(summary, '{}'::jsonb) || ${json}::jsonb
      WHERE id = ${connectionId}::uuid
    `;
  }

  async syncSheet(methodId: string, userId: string) {
    await this.requireReconciledMethod(methodId);
    const connection = await this.findConnection(methodId);
    if (!connection) {
      throw new BadRequestException(
        'Connect a Google Sheet for this method first.',
      );
    }
    if (!(await this.acquireSyncLock(connection.id))) {
      throw new ConflictException(
        'A sync is already running for this sheet — wait for it to finish.',
      );
    }
    const summary = connection.summary as unknown as SheetConnectionSummary;
    const config = connection.mapping as unknown as StatementMappingConfig;
    try {
      const sheetName = await this.sheets.resolveSheetTitle(
        summary.spreadsheetId,
        summary.gid ?? undefined,
      );
      const table = await this.readSheet(summary.spreadsheetId, summary.gid);
      this.assertMapping(config, table.headers);
      if (table.rows.length === 0) {
        const priorLines = await this.prisma.paymentStatementLine.count({
          where: { statementImport: { syncSourceId: connection.id } },
        });
        if (priorLines > 0) {
          throw new BadRequestException(
            'The sheet returned no data rows — nothing was changed. Check the tab and try again (an empty read never flags existing lines as deleted).',
          );
        }
      }
      const result = await this.commitRows({
        methodId,
        sourceType: PaymentStatementSourceType.GOOGLE_SHEET,
        rows: table.rows,
        config,
        userId,
        sheetName,
        syncSourceId: connection.id,
      });
      await this.releaseSyncLock(connection.id, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'SUCCESS',
        lastSyncError: null,
        lastSyncResult: { ...result, errors: result.errors.slice(0, 50) },
      });
      return result;
    } catch (error) {
      await this.releaseSyncLock(connection.id, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'FAILED',
        lastSyncError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ------------------------------------------------------------------ reads

  async listImports(methodId: string) {
    await this.requireReconciledMethod(methodId);
    const rows = await this.prisma.paymentStatementImport.findMany({
      where: {
        paymentMethodId: methodId,
        NOT: {
          sourceType: PaymentStatementSourceType.GOOGLE_SHEET,
          syncSourceId: null,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        sourceType: true,
        fileName: true,
        sheetName: true,
        syncSourceId: true,
        totalRows: true,
        createdRows: true,
        duplicateRows: true,
        exceptionRows: true,
        errorRows: true,
        createdAt: true,
        createdBy: true,
      },
    });
    return rows;
  }
}
