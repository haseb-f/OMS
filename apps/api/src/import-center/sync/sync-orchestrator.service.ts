import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SyncSourceType, SyncRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportJobsService } from '../import-jobs.service';
import { GoogleSheetsService } from '../google-sheets.service';
import { NEEDS_REVIEW_PREFIX } from '../import-type.interface';
import { RejectImportRowDto } from '../dto/reject-import-row.dto';
import { PhoneNumberService } from '../../common/phone/phone-number.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { buildSyncReviewRows, type SyncReviewRow } from './sync-review.util';
import {
  groupRowsByKey,
  extractImportErrorMessage,
} from '../import-value.util';
import {
  classifyDeletedStoreOrderGroups,
  classifyStoreOrderGroups,
  fingerprintMappedRows,
  fingerprintStorageKey,
  isDeletedSyncRowNumber,
  storeOrderWritebackValues,
  type ClassifiedStoreOrderGroup,
  type DeletedStoreOrderGroup,
  type StoreOrderRowHashMap,
} from './store-orders-sync.lifecycle';

const HANDLER_TYPE_BY_SOURCE: Record<SyncSourceType, string> = {
  LEADS: 'LEADS',
  STORE_ORDERS: 'STORE_ORDERS',
  CASH_FLOW: 'BANK_TRANSACTIONS',
  SHIPPING_UPDATES: 'SHIPPING_UPDATES',
};

/** Two-way Store Orders / Shipping workflow (spec section 27) — triggering a sync at all needs `import-center.sync`, but a SHIPPING_UPDATES commit specifically ALSO needs the same permission the manual/bulk shipping channels require, so access to the Sync operation can never grant a capability those channels gate. */
const EXTRA_PERMISSION_BY_SOURCE: Partial<Record<SyncSourceType, string>> = {
  SHIPPING_UPDATES: 'shipping.manage',
};

export interface SyncPreviewIncremental {
  newCount: number;
  retryCount: number;
  errorCount: number;
  readyCount: number;
  importedSkippedCount: number;
  unchangedSkippedCount: number;
  modifiedCount: number;
  deletedCount: number;
  nothingToSync: boolean;
}

export interface SyncPreviewResult {
  sourceId: string;
  jobId: string;
  totalRows: number;
  newCount: number;
  willImportCount: number;
  duplicateCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  errorCount: number;
  errors: { rowNumber: number; columnName: string | null; message: string }[];
  needsReview: { rowNumber: number; reason: string }[];
  duplicateGroups: { field: string; value: string; rowNumbers: number[] }[];
  source: {
    type: 'GOOGLE_SHEETS';
    label: string;
    worksheetName: string | null;
    spreadsheetId: string;
  };
  previewedAt: string;
  rows: SyncReviewRow[];
  incremental?: SyncPreviewIncremental;
  writebackError?: string | null;
}

export interface SyncCommitResult {
  totalRows: number;
  importedCount: number;
  errorCount: number;
  status: SyncRunStatus;
  /** SHIPPING_UPDATES only (spec section 13's per-row report). */
  rows?: ShippingSyncRowReport[];
  writebackError?: string | null;
}

/** Per-row detail for a SHIPPING_UPDATES commit (spec section 13's report table) — populated only for that source type. */
export interface ShippingSyncRowReport {
  externalOrderId: string;
  result: 'UPDATED' | 'NO_CHANGE' | 'REJECTED' | 'NOT_FOUND' | 'NEEDS_REVIEW';
  shipmentId: string | null;
  message: string;
}

/**
 * Data Synchronization (مزامنة البيانات) engine — the ONE backend capability
 * every entry point (Import Center, Leads, Store Orders, Cash Flow pages)
 * calls, never a per-page reimplementation. Deliberately thin: it never
 * touches a business table itself — every read/write goes through the
 * exact same `ImportJobsService`/`GoogleSheetsService`/`ImportTypeHandler`
 * pipeline a manual Import Center upload already uses, wired to a
 * `SyncSourceConfig`'s saved spreadsheet + column mapping instead of an
 * ad-hoc file upload.
 */
@Injectable()
export class SyncOrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importJobs: ImportJobsService,
    private readonly googleSheets: GoogleSheetsService,
    private readonly permissionsResolver: PermissionsResolverService,
    private readonly phone: PhoneNumberService,
    private readonly storeOrders: StoreOrdersService,
  ) {}

  private async getEnabledSource(sourceId: string, userId?: string) {
    const source = await this.prisma.syncSourceConfig.findFirst({
      where: { id: sourceId, deletedAt: null },
    });
    if (!source) {
      throw new NotFoundException(`Sync source ${sourceId} not found`);
    }
    if (!source.enabled) {
      throw new BadRequestException(
        `"${source.label}" is disabled — enable it before syncing.`,
      );
    }
    // Spec section 27 — a channel-specific extra permission, checked in
    // addition to (never instead of) the `import-center.sync` the
    // controller already enforces on every route.
    const extraPermission = EXTRA_PERMISSION_BY_SOURCE[source.sourceType];
    if (extraPermission && userId) {
      const allowed = await this.permissionsResolver.hasPermission(
        userId,
        extraPermission,
      );
      if (!allowed) {
        throw new ForbiddenException(
          `Missing permission "${extraPermission}".`,
        );
      }
    }
    return source;
  }

  /** Concurrency guard (spec section 16) — one `preview()`/`commit()` at a time per source, mirroring `ImportJob.isSyncing`'s existing per-job advisory lock one level up. */
  private async withSyncLock<T>(
    sourceId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const { count } = await this.prisma.syncSourceConfig.updateMany({
      where: { id: sourceId, isSyncing: false },
      data: { isSyncing: true },
    });
    if (count === 0) {
      throw new BadRequestException(
        'A synchronization is already in progress for this source.',
      );
    }
    try {
      return await fn();
    } finally {
      await this.prisma.syncSourceConfig.update({
        where: { id: sourceId },
        data: { isSyncing: false },
      });
    }
  }

  private buildShareUrl(source: {
    spreadsheetId: string;
    worksheetGid: string | null;
  }): string {
    const gidFragment = source.worksheetGid
      ? `#gid=${source.worksheetGid}`
      : '';
    return `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit${gidFragment}`;
  }

  /**
   * `source: 'GOOGLE_SHEETS'` is set for EVERY sync run, regardless of
   * type — it's the one channel-agnostic signal a handler (see
   * `ShippingUpdatesImportHandler.importRow`'s `options.context.source`
   * check) uses to tag its own audit-trail entries `GOOGLE_SHEETS` instead
   * of the generic `IMPORT`, since a plain manual CSV/XLSX upload through
   * Import Center never sets `ImportJob.rowDefaults` at all.
   *
   * Cash Flow additionally gets the worksheet's provider label as a
   * fallback for `bankName`/`account` when the sheet itself has no
   * matching column (a Tabby/Tamara export, for instance, has no "Bank
   * Name" column at all) — `account` specifically so rows from two
   * different providers never collide on `BankTransaction.fingerprint`,
   * which is deliberately unchanged and does NOT include the provider —
   * see `bank-transactions-import.handler.ts`'s `computeFingerprint`
   * comment.
   */
  private rowDefaultsFor(source: {
    sourceType: SyncSourceType;
    label: string;
    configMetadata?: unknown;
  }): Record<string, string> {
    if (source.sourceType === SyncSourceType.CASH_FLOW) {
      // Cash Flow spec section 2 — "TWO Google Sheets: Incoming / Outgoing.
      // Each can contain multiple tabs." One `SyncSourceConfig` row = one
      // tab = one cash source; its configured direction (set on the source
      // itself, never inferred/guessed per row) reaches every row of this
      // run via `ImportJob.rowDefaults` -> `options.context.direction`.
      const metadata = (source.configMetadata ?? {}) as {
        direction?: 'INCOMING' | 'OUTGOING';
      };
      return {
        source: 'GOOGLE_SHEETS',
        bankName: source.label,
        account: source.label,
        ...(metadata.direction ? { direction: metadata.direction } : {}),
      };
    }
    return { source: 'GOOGLE_SHEETS' };
  }

  /** Builds a fresh `ImportJob` from a source's saved spreadsheet + column mapping — "one row per upload-through-import run" (see `ImportJob`'s own doc comment), never a long-lived job repeatedly refreshed across sync cycles. */
  private async createRunJob(
    source: {
      id: string;
      sourceType: SyncSourceType;
      label: string;
      spreadsheetId: string;
      worksheetGid: string | null;
      configMetadata: unknown;
    },
    userId?: string,
  ) {
    const metadata = (source.configMetadata ?? {}) as {
      columnMapping?: Record<string, string>;
    };
    const columnMapping = metadata.columnMapping;
    if (!columnMapping || Object.keys(columnMapping).length === 0) {
      throw new BadRequestException(
        `"${source.label}" has no saved column mapping — edit the source and map its columns before syncing.`,
      );
    }

    const job = await this.importJobs.create(
      { importType: HANDLER_TYPE_BY_SOURCE[source.sourceType] },
      userId,
    );
    await this.importJobs.uploadFromGoogleSheets(
      job.id,
      this.buildShareUrl(source),
    );
    await this.importJobs.setMapping(job.id, { columnMapping });

    await this.prisma.importJob.update({
      where: { id: job.id },
      data: { rowDefaults: this.rowDefaultsFor(source) },
    });
    return job.id;
  }

  /**
   * Step 1 — fetch the latest source data and validate it (dry run, writes
   * nothing) so the caller can show a preview and require confirmation
   * before anything commits. Always builds a brand-new `ImportJob` (fresh
   * "latest data" every time — never a stale cached read) and remembers it
   * as this source's "most recent run" for `commit()` to verify against.
   */
  async preview(
    sourceId: string,
    userId?: string,
    options?: { retryRowNumbers?: number[]; retryAllFailed?: boolean },
  ): Promise<SyncPreviewResult> {
    const source = await this.getEnabledSource(sourceId, userId);
    return this.withSyncLock(sourceId, async () => {
      const jobId = await this.createRunJob(source, userId);

      if (source.sourceType === SyncSourceType.STORE_ORDERS) {
        return this.previewStoreOrders(source, jobId, userId, options);
      }

      const result = await this.importJobs.validate(jobId, userId);
      await this.prisma.syncSourceConfig.update({
        where: { id: source.id },
        data: { importJobId: jobId },
      });
      return this.buildGenericPreview(source, jobId, result);
    });
  }

  private async previewStoreOrders(
    source: {
      id: string;
      label: string;
      spreadsheetId: string;
      worksheetName: string | null;
      worksheetGid: string | null;
      configMetadata: unknown;
    },
    jobId: string,
    userId?: string,
    options?: { retryRowNumbers?: number[]; retryAllFailed?: boolean },
  ): Promise<SyncPreviewResult> {
    const mapped = await this.importJobs.listMappedRows(jobId);
    const groups = mapped.groupKey
      ? [...groupRowsByKey(mapped.rows, mapped.groupKey).values()]
      : mapped.rows.map((row) => [row]);
    const classified = await this.classifyStoreOrderMappedRows(
      source,
      groups,
      options,
    );
    const skipRowNumbers = classified
      .filter((row) => !row.runValidation)
      .flatMap((row) => row.rowNumbers);

    const result = await this.importJobs.validate(jobId, userId, {
      skipRowNumbers,
    });

    for (const group of classified.filter(
      (row) => row.lifecycle === 'ORPHAN_LINK',
    )) {
      for (const rowNumber of group.rowNumbers) {
        result.errors.push({
          rowNumber,
          columnName: 'System Order ID',
          message: 'A Store Order linked in the sheet was not found in OMS.',
        });
      }
    }

    const deleted = classifyDeletedStoreOrderGroups({
      currentKeys: classified.map((group) =>
        fingerprintStorageKey(group.externalOrderId, group.rowNumbers[0] ?? 0),
      ),
      previous:
        (
          (source.configMetadata ?? {}) as {
            storeOrderRowHashes?: StoreOrderRowHashMap;
          }
        ).storeOrderRowHashes ?? {},
    });
    for (const group of deleted) {
      result.needsReview.push({
        rowNumber: group.sentinelRowNumber,
        reason:
          'Source row was removed from Google Sheets — confirm to archive the Store Order.',
      });
    }

    await this.prisma.syncSourceConfig.update({
      where: { id: source.id },
      data: { importJobId: jobId },
    });

    const preview = await this.buildGenericPreview(source, jobId, result);
    const classifiedByRow = new Map<number, ClassifiedStoreOrderGroup>();
    for (const group of classified) {
      for (const rowNumber of group.rowNumbers) {
        classifiedByRow.set(rowNumber, group);
      }
    }

    const reviewRowNumbers = new Set(
      classified
        .filter((row) => row.includeInReview)
        .flatMap((row) => row.rowNumbers),
    );
    preview.rows = preview.rows
      .filter((row) => reviewRowNumbers.has(row.rowNumber))
      .map((row) => {
        const group = classifiedByRow.get(row.rowNumber);
        return {
          ...row,
          lifecycle: group?.lifecycle ?? 'NEW',
          changed: group?.changed ?? false,
          retryable: group?.retryable ?? false,
          existingRecordId:
            row.existingRecordId ?? group?.existingInternalOrderId ?? null,
        };
      });

    preview.rows.push(...this.buildDeletedReviewRows(jobId, deleted));

    const readyCount = preview.rows.filter(
      (row) => row.status === 'READY',
    ).length;
    const warningCount = preview.rows.filter(
      (row) => row.status === 'WARNING',
    ).length;
    const incremental = {
      newCount: classified.filter((row) => row.lifecycle === 'NEW').length,
      retryCount: classified.filter((row) => row.lifecycle === 'RETRY').length,
      errorCount: preview.rows.filter((row) => row.status === 'ERROR').length,
      readyCount: readyCount + warningCount,
      importedSkippedCount: classified.filter(
        (row) => row.lifecycle === 'IMPORTED',
      ).length,
      unchangedSkippedCount: classified.filter(
        (row) => row.lifecycle === 'UNCHANGED_FAILURE',
      ).length,
      modifiedCount: classified.filter((row) => row.lifecycle === 'MODIFIED')
        .length,
      deletedCount: deleted.length,
      nothingToSync: preview.rows.length === 0,
    };
    preview.incremental = incremental;
    preview.newCount = incremental.newCount;
    preview.willImportCount = incremental.readyCount;
    preview.errorCount = incremental.errorCount;
    preview.needsReviewCount = warningCount;
    preview.errors = preview.errors.filter((error) =>
      reviewRowNumbers.has(error.rowNumber),
    );
    preview.needsReview = preview.needsReview.filter((row) =>
      reviewRowNumbers.has(row.rowNumber),
    );

    preview.writebackError = await this.writeStoreOrderPreviewOutcomes(
      source,
      preview.rows,
      classified,
    );
    await this.persistStoreOrderHashes(
      source,
      classified,
      preview.rows,
      deleted,
    );

    return preview;
  }

  private async classifyStoreOrderMappedRows(
    source: { configMetadata: unknown },
    groups: Array<
      Array<{
        rowNumber: number;
        mappedRow: Record<string, string>;
        sourceRow?: Record<string, string>;
      }>
    >,
    options?: { retryRowNumbers?: number[]; retryAllFailed?: boolean },
  ): Promise<ClassifiedStoreOrderGroup[]> {
    const metadata = (source.configMetadata ?? {}) as {
      storeOrderRowHashes?: StoreOrderRowHashMap;
    };
    const externalIds = [
      ...new Set(
        groups
          .map((group) => group[0]?.mappedRow.externalOrderId?.trim())
          .filter((id): id is string => !!id),
      ),
    ];
    const existing = externalIds.length
      ? await this.prisma.storeOrder.findMany({
          where: { externalOrderId: { in: externalIds }, deletedAt: null },
          select: { externalOrderId: true, internalOrderId: true },
        })
      : [];
    const existingByExternalId = new Map(
      existing
        .filter((order) => order.externalOrderId)
        .map((order) => [
          order.externalOrderId as string,
          { internalOrderId: order.internalOrderId },
        ]),
    );
    return classifyStoreOrderGroups({
      groups: groups.map((group) => ({
        rowNumbers: group.map((row) => row.rowNumber),
        mappedRows: group.map((row) => row.mappedRow),
        sourceRow: group[0]?.sourceRow ?? {},
      })),
      existingByExternalId,
      previous: metadata.storeOrderRowHashes ?? {},
      retryRowNumbers: options?.retryRowNumbers,
      retryAllFailed: options?.retryAllFailed,
    });
  }

  private async writeStoreOrderPreviewOutcomes(
    source: { spreadsheetId: string; worksheetGid: string | null },
    rows: SyncReviewRow[],
    classified: ClassifiedStoreOrderGroup[],
  ): Promise<string | null> {
    const writes: { rowNumber: number; values: Record<string, string> }[] = [];
    for (const row of rows) {
      if (
        row.rowNumbers.every((rowNumber) => isDeletedSyncRowNumber(rowNumber))
      ) {
        continue;
      }
      if (row.status === 'ERROR' || row.status === 'DUPLICATE') {
        const values = storeOrderWritebackValues({
          status: 'error',
          issues: row.issues,
        });
        for (const rowNumber of row.rowNumbers) {
          writes.push({ rowNumber, values });
        }
      } else if (row.status === 'WARNING') {
        const values = storeOrderWritebackValues({
          status: 'needsReview',
          issues: row.issues,
        });
        for (const rowNumber of row.rowNumbers) {
          writes.push({ rowNumber, values });
        }
      }
    }
    for (const group of classified.filter(
      (row) => row.needsSheetNumberWriteback,
    )) {
      const values = storeOrderWritebackValues({
        status: 'imported',
        internalOrderId: group.existingInternalOrderId ?? undefined,
      });
      for (const rowNumber of group.rowNumbers) {
        writes.push({ rowNumber, values });
      }
    }
    if (writes.length === 0) return null;
    try {
      await this.googleSheets.writeRowResults(
        source.spreadsheetId,
        writes,
        source.worksheetGid ?? undefined,
      );
      return null;
    } catch (error) {
      return extractImportErrorMessage(error);
    }
  }

  private async persistStoreOrderHashes(
    source: { id: string; configMetadata: unknown },
    classified: ClassifiedStoreOrderGroup[],
    reviewRows: SyncReviewRow[],
    deleted: DeletedStoreOrderGroup[],
  ) {
    const metadata = (source.configMetadata ?? {}) as Record<string, unknown>;
    const hashes: StoreOrderRowHashMap = {
      ...((metadata.storeOrderRowHashes as StoreOrderRowHashMap | undefined) ??
        {}),
    };
    const reviewByRow = new Map(
      reviewRows.map((row) => [row.rowNumber, row] as const),
    );
    for (const group of classified) {
      const key = fingerprintStorageKey(
        group.externalOrderId,
        group.rowNumbers[0] ?? 0,
      );
      if (group.lifecycle === 'IMPORTED') {
        if (!hashes[key]?.hash?.trim()) {
          hashes[key] = {
            hash: group.hash,
            status: 'IMPORTED',
            internalOrderId: group.existingInternalOrderId ?? undefined,
          };
        }
        continue;
      }
      if (group.lifecycle === 'MODIFIED' || group.lifecycle === 'DELETED') {
        continue;
      }
      if (group.lifecycle === 'UNCHANGED_FAILURE') continue;
      const review = reviewByRow.get(group.rowNumbers[0] ?? -1);
      if (!review) continue;
      if (review.status === 'READY') continue;
      hashes[key] = {
        hash: group.hash,
        status: review.status === 'WARNING' ? 'NEEDS_REVIEW' : 'ERROR',
      };
    }
    await this.prisma.syncSourceConfig.update({
      where: { id: source.id },
      data: {
        configMetadata: {
          ...metadata,
          storeOrderRowHashes: hashes,
          pendingStoreOrderDeletions: deleted.map((group) => ({
            key: group.key,
            externalOrderId: group.externalOrderId,
            internalOrderId: group.internalOrderId,
            sentinelRowNumber: group.sentinelRowNumber,
          })),
          storeOrderSkipRowNumbers: classified
            .filter((group) => !group.includeInReview)
            .flatMap((group) => group.rowNumbers),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private buildDeletedReviewRows(
    jobId: string,
    deleted: DeletedStoreOrderGroup[],
  ): SyncReviewRow[] {
    return deleted.map((group) => ({
      id: `${jobId}:deleted:${group.key}`,
      rowNumber: group.sentinelRowNumber,
      rowNumbers: [group.sentinelRowNumber],
      status: 'WARNING' as const,
      values: {
        externalOrderId: group.externalOrderId,
        internalOrderId: group.internalOrderId,
      },
      sourceRow: {},
      originalPhone: null,
      normalizedPhone: null,
      countryName: null,
      issues: [
        {
          field: 'externalOrderId',
          code: 'NEEDS_REVIEW',
          message:
            'Source row was removed from Google Sheets — confirm to archive the Store Order.',
        },
      ],
      existingRecordId: group.internalOrderId,
      lifecycle: 'DELETED',
      changed: true,
      retryable: false,
    }));
  }

  private async buildGenericPreview(
    source: {
      id: string;
      label: string;
      worksheetName: string | null;
      spreadsheetId: string;
    },
    jobId: string,
    result: {
      totalRows: number;
      errors: {
        rowNumber: number;
        columnName: string | null;
        message: string;
      }[];
      needsReview: { rowNumber: number; reason: string }[];
      duplicateGroups: { field: string; value: string; rowNumbers: number[] }[];
      summary: {
        newCount: number;
        duplicateCount: number;
        needsReviewCount: number;
      };
    },
  ): Promise<SyncPreviewResult> {
    const dbDuplicates = result.errors.filter((error) =>
      /already exists/i.test(error.message),
    );
    const dbDuplicateRowNumbers = new Set(dbDuplicates.map((e) => e.rowNumber));
    const otherErrors = result.errors.filter(
      (error) => !dbDuplicateRowNumbers.has(error.rowNumber),
    );

    const [mapped, countries] = await Promise.all([
      this.importJobs.listMappedRows(jobId),
      this.prisma.country.findMany({
        where: { deletedAt: null },
        select: { name: true, nameEn: true, code: true },
      }),
    ]);
    const countryCodeByName = new Map<string, string>();
    for (const country of countries) {
      countryCodeByName.set(country.name.toLowerCase(), country.code);
      if (country.nameEn) {
        countryCodeByName.set(country.nameEn.toLowerCase(), country.code);
      }
    }

    return {
      sourceId: source.id,
      jobId,
      totalRows: result.totalRows,
      newCount: result.summary.newCount,
      willImportCount: result.summary.newCount,
      duplicateCount: result.summary.duplicateCount + dbDuplicates.length,
      needsReviewCount: result.summary.needsReviewCount,
      rejectedCount: 0,
      errorCount: otherErrors.length,
      errors: otherErrors,
      needsReview: result.needsReview,
      duplicateGroups: result.duplicateGroups,
      source: {
        type: 'GOOGLE_SHEETS' as const,
        label: source.label,
        worksheetName: source.worksheetName,
        spreadsheetId: source.spreadsheetId,
      },
      previewedAt: new Date().toISOString(),
      rows: buildSyncReviewRows({
        jobId,
        groupKey: mapped.groupKey,
        mappedRows: mapped.rows,
        errors: result.errors,
        needsReview: result.needsReview,
        duplicateGroups: result.duplicateGroups,
        countryCodeByName,
        phone: this.phone,
      }),
    };
  }

  /**
   * Step 2 — commits a previously-previewed job for real (through the same
   * `ImportJobsService.run()` every manual import uses), updates the
   * source's Last Sync summary, and — Store Orders only — writes the
   * outcome back to the sheet, strictly after this commit succeeds.
   * Requires `jobId` to be the exact job `preview()` most recently built
   * for this source, so a stale/already-committed preview can never be
   * replayed blindly.
   */
  async commit(
    sourceId: string,
    jobId: string,
    userId?: string,
    options?: { acceptRowNumbers?: number[] },
  ): Promise<SyncCommitResult> {
    const source = await this.getEnabledSource(sourceId, userId);
    if (source.importJobId !== jobId) {
      throw new BadRequestException(
        'This preview is no longer current — run Sync again before committing.',
      );
    }

    return this.withSyncLock(sourceId, async () => {
      let acceptRowNumbers = options?.acceptRowNumbers;
      if (
        acceptRowNumbers === undefined &&
        source.sourceType === SyncSourceType.STORE_ORDERS
      ) {
        const metadata = (source.configMetadata ?? {}) as {
          storeOrderSkipRowNumbers?: number[];
        };
        const skip = new Set(metadata.storeOrderSkipRowNumbers ?? []);
        const mapped = await this.importJobs.listMappedRows(jobId);
        acceptRowNumbers = mapped.rows
          .map((row) => row.rowNumber)
          .filter((rowNumber) => !skip.has(rowNumber));
      }
      const acceptedSheetRows = (acceptRowNumbers ?? []).filter(
        (rowNumber) => !isDeletedSyncRowNumber(rowNumber),
      );
      const acceptedDeletedRows = new Set(
        (acceptRowNumbers ?? []).filter(isDeletedSyncRowNumber),
      );
      const result = await this.importJobs.run(jobId, userId, {
        ...options,
        acceptRowNumbers:
          options?.acceptRowNumbers === undefined &&
          source.sourceType !== SyncSourceType.STORE_ORDERS
            ? undefined
            : acceptedSheetRows,
      });

      // Google Sheets NO_CHANGE rows are reported as a distinct outcome
      // (spec section 15) but still count as a successful, no-op sync —
      // never an error.
      const noChangeCount = result.successRows.filter(
        (row) => row.noChange,
      ).length;

      const summary: SyncCommitResult = {
        totalRows: result.totalRows,
        importedCount: result.successCount,
        errorCount: result.errorCount,
        status:
          result.successCount === 0 && result.errorCount > 0
            ? SyncRunStatus.FAILED
            : result.errorCount > 0
              ? SyncRunStatus.PARTIAL
              : SyncRunStatus.SUCCESS,
      };

      await this.prisma.syncSourceConfig.update({
        where: { id: source.id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: summary.status,
          lastSyncUserId: userId ?? null,
          lastSyncSummary: {
            totalRows: summary.totalRows,
            importedCount: summary.importedCount,
            noChangeCount,
            errorCount: summary.errorCount,
          },
        },
      });

      let writebackError: string | null = null;
      if (source.sourceType === SyncSourceType.STORE_ORDERS) {
        try {
          await this.writeBackStoreOrders(source, result);
          await this.markStoreOrdersImported(source, jobId, result.successRows);
          await this.applyStoreOrderDeletions(
            source,
            acceptedDeletedRows,
            options?.acceptRowNumbers !== undefined,
          );
        } catch (error) {
          writebackError = extractImportErrorMessage(error);
          summary.status =
            summary.importedCount > 0
              ? SyncRunStatus.PARTIAL
              : SyncRunStatus.FAILED;
        }
      } else if (source.sourceType === SyncSourceType.SHIPPING_UPDATES) {
        summary.rows = await this.writeBackShippingUpdates(
          source,
          result,
          (result.columnMapping ?? {}) as Record<string, string>,
        );
      } else if (source.sourceType === SyncSourceType.CASH_FLOW) {
        await this.writeBackCashFlow(source, result);
      }

      if (writebackError) {
        summary.writebackError = writebackError;
        await this.prisma.syncSourceConfig.update({
          where: { id: source.id },
          data: { lastSyncStatus: summary.status },
        });
      }

      return summary;
    });
  }

  /**
   * Store Orders write-back — existing managed columns only:
   * Sync Status / System Order ID / Error Message.
   * Preview already wrote validation errors; commit writes success (and any
   * additional run-time errors) to the exact source row.
   */
  private async writeBackStoreOrders(
    source: { spreadsheetId: string; worksheetGid: string | null },
    result: {
      successRows: { rowNumber: number; id: string }[];
      errors: {
        rowNumber: number;
        errorMessage: string;
        rejectedAt: Date | null;
        rejectionReasonNote: string | null;
      }[];
    },
  ) {
    const orderIds = result.successRows.map((r) => r.id);
    const orders = orderIds.length
      ? await this.prisma.storeOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, internalOrderId: true },
        })
      : [];
    const internalOrderIdById = new Map(
      orders.map((o) => [o.id, o.internalOrderId]),
    );

    const rows: { rowNumber: number; values: Record<string, string> }[] = [];
    for (const { rowNumber, id } of result.successRows) {
      rows.push({
        rowNumber,
        values: storeOrderWritebackValues({
          status: 'imported',
          internalOrderId: internalOrderIdById.get(id),
        }),
      });
    }
    for (const error of result.errors) {
      const isNeedsReview = error.errorMessage.startsWith(NEEDS_REVIEW_PREFIX);
      const message = isNeedsReview
        ? error.errorMessage.slice(NEEDS_REVIEW_PREFIX.length)
        : error.errorMessage;
      rows.push({
        rowNumber: error.rowNumber,
        values: storeOrderWritebackValues({
          status: isNeedsReview ? 'needsReview' : 'error',
          issues: [{ message }],
        }),
      });
    }

    if (rows.length === 0) return;
    await this.googleSheets.writeRowResults(
      source.spreadsheetId,
      rows,
      source.worksheetGid ?? undefined,
    );
  }

  private async markStoreOrdersImported(
    source: { id: string; configMetadata: unknown },
    jobId: string,
    successRows: { rowNumber: number; id: string }[],
  ) {
    if (successRows.length === 0) return;
    const orders = await this.prisma.storeOrder.findMany({
      where: { id: { in: successRows.map((row) => row.id) } },
      select: { id: true, externalOrderId: true, internalOrderId: true },
    });
    const byId = new Map(orders.map((order) => [order.id, order]));
    const mapped = await this.importJobs.listMappedRows(jobId);
    const groups = mapped.groupKey
      ? [...groupRowsByKey(mapped.rows, mapped.groupKey).values()]
      : mapped.rows.map((row) => [row]);
    const hashByExternalId = new Map<string, string>();
    for (const group of groups) {
      const externalOrderId = group[0]?.mappedRow.externalOrderId?.trim();
      if (!externalOrderId) continue;
      hashByExternalId.set(
        externalOrderId,
        fingerprintMappedRows(group.map((row) => row.mappedRow)),
      );
    }
    const latest = await this.prisma.syncSourceConfig.findUniqueOrThrow({
      where: { id: source.id },
      select: { configMetadata: true },
    });
    const metadata = (latest.configMetadata ?? {}) as Record<string, unknown>;
    const hashes: StoreOrderRowHashMap = {
      ...((metadata.storeOrderRowHashes as StoreOrderRowHashMap | undefined) ??
        {}),
    };
    for (const row of successRows) {
      const order = byId.get(row.id);
      if (!order?.externalOrderId) continue;
      hashes[order.externalOrderId] = {
        hash: hashByExternalId.get(order.externalOrderId) ?? '',
        status: 'IMPORTED',
        internalOrderId: order.internalOrderId,
      };
    }
    await this.prisma.syncSourceConfig.update({
      where: { id: source.id },
      data: {
        configMetadata: {
          ...metadata,
          storeOrderRowHashes: hashes,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async applyStoreOrderDeletions(
    source: { id: string; configMetadata: unknown },
    acceptedDeletedRows: Set<number>,
    decisionsWereSent: boolean,
  ) {
    const latest = await this.prisma.syncSourceConfig.findUniqueOrThrow({
      where: { id: source.id },
      select: { configMetadata: true },
    });
    const metadata = (latest.configMetadata ?? {}) as Record<string, unknown>;
    const pending = (metadata.pendingStoreOrderDeletions ?? []) as Array<{
      key: string;
      internalOrderId: string;
      sentinelRowNumber: number;
    }>;
    if (pending.length === 0) return;

    const hashes: StoreOrderRowHashMap = {
      ...((metadata.storeOrderRowHashes as StoreOrderRowHashMap | undefined) ??
        {}),
    };
    for (const group of pending) {
      const accepted =
        decisionsWereSent && acceptedDeletedRows.has(group.sentinelRowNumber);
      if (accepted) {
        const order = await this.prisma.storeOrder.findFirst({
          where: {
            internalOrderId: group.internalOrderId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (order) {
          await this.storeOrders.archive(order.id);
        }
      }
      delete hashes[group.key];
    }

    await this.prisma.syncSourceConfig.update({
      where: { id: source.id },
      data: {
        configMetadata: {
          ...metadata,
          storeOrderRowHashes: hashes,
          pendingStoreOrderDeletions: [],
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Cash Flow write-back for a just-completed `run()` — spec section 19's
   * minimum column set (External/System Transaction ID, Sync Status/
   * Message, Reconciliation Status), traceable back from the sheet row to
   * the `BankTransaction` and — once reconciled — its Payment/Financial
   * Transaction/Journal Entry. Never touches the user's own source columns.
   */
  private async writeBackCashFlow(
    source: { spreadsheetId: string; worksheetGid: string | null },
    result: {
      successRows: { rowNumber: number; id: string; noChange?: boolean }[];
      errors: { rowNumber: number; errorMessage: string }[];
    },
  ) {
    const bankTransactionIds = result.successRows.map((r) => r.id);
    const transactions = bankTransactionIds.length
      ? await this.prisma.bankTransaction.findMany({
          where: { id: { in: bankTransactionIds } },
          select: { id: true, transactionId: true, matchStatus: true },
        })
      : [];
    const byId = new Map(transactions.map((t) => [t.id, t]));
    const processedAt = new Date().toISOString();

    const rows: { rowNumber: number; values: Record<string, string> }[] = [];
    for (const { rowNumber, id, noChange } of result.successRows) {
      const transaction = byId.get(id);
      rows.push({
        rowNumber,
        values: {
          'OMS Transaction ID': transaction?.transactionId ?? '',
          'System Transaction ID': id,
          'OMS Sync Status': noChange ? 'NO_CHANGE' : 'SYNCED',
          'OMS Sync Message': noChange ? 'لا يوجد تغيير' : 'تمت المزامنة بنجاح',
          'OMS Reconciliation Status': transaction?.matchStatus ?? 'UNMATCHED',
          'OMS Processed At': processedAt,
        },
      });
    }
    for (const error of result.errors) {
      rows.push({
        rowNumber: error.rowNumber,
        values: {
          'OMS Sync Status': 'ERROR',
          'OMS Sync Message': error.errorMessage,
          'OMS Processed At': processedAt,
        },
      });
    }

    if (rows.length === 0) return;
    await this.googleSheets.writeRowResults(
      source.spreadsheetId,
      rows,
      source.worksheetGid ?? undefined,
    );
  }

  /** Shipping Updates write-back for a just-completed `run()` — spec section 14's exact columns, and returns the per-row report spec section 13 wants surfaced to the caller. */
  private async writeBackShippingUpdates(
    source: { spreadsheetId: string; worksheetGid: string | null },
    result: {
      successRows: { rowNumber: number; id: string; noChange?: boolean }[];
      errors: {
        rowNumber: number;
        errorMessage: string;
        rawRowData: unknown;
      }[];
    },
    columnMapping: Record<string, string>,
  ): Promise<ShippingSyncRowReport[]> {
    const shipmentIds = result.successRows.map((r) => r.id);
    const shipments = shipmentIds.length
      ? await this.prisma.shipment.findMany({
          where: { id: { in: shipmentIds } },
          select: {
            id: true,
            storeOrder: { select: { externalOrderId: true } },
          },
        })
      : [];
    const externalOrderIdByShipmentId = new Map(
      shipments.map((s) => [s.id, s.storeOrder?.externalOrderId ?? '']),
    );

    const sheetRows: { rowNumber: number; values: Record<string, string> }[] =
      [];
    const report: ShippingSyncRowReport[] = [];
    const externalOrderIdColumn = columnMapping.externalOrderId;

    for (const { rowNumber, id, noChange } of result.successRows) {
      const status = noChange ? 'NO_CHANGE' : 'UPDATED';
      const message = noChange ? 'لا يوجد تغيير' : 'تم تحديث حالة الشحن';
      sheetRows.push({
        rowNumber,
        values: {
          'Shipping Sync Status': status,
          'Shipping Sync Message': message,
          'Shipment ID': id,
        },
      });
      report.push({
        externalOrderId: externalOrderIdByShipmentId.get(id) ?? '',
        result: status,
        shipmentId: id,
        message,
      });
    }

    for (const error of result.errors) {
      const isNeedsReview = error.errorMessage.startsWith(NEEDS_REVIEW_PREFIX);
      const isNotFound = /No Store Order found/i.test(error.errorMessage);
      const status: ShippingSyncRowReport['result'] = isNeedsReview
        ? 'NEEDS_REVIEW'
        : isNotFound
          ? 'NOT_FOUND'
          : 'REJECTED';
      const message = isNeedsReview
        ? error.errorMessage.slice(NEEDS_REVIEW_PREFIX.length)
        : error.errorMessage;
      sheetRows.push({
        rowNumber: error.rowNumber,
        values: {
          'Shipping Sync Status': status,
          'Shipping Sync Message': message,
          'Shipment ID': '',
        },
      });
      const rawRow = error.rawRowData as Record<string, unknown> | null;
      const rawValue =
        externalOrderIdColumn && rawRow
          ? rawRow[externalOrderIdColumn]
          : undefined;
      const externalOrderId = typeof rawValue === 'string' ? rawValue : '';
      report.push({
        externalOrderId,
        result: status,
        shipmentId: null,
        message,
      });
    }

    if (sheetRows.length > 0) {
      await this.googleSheets.writeRowResults(
        source.spreadsheetId,
        sheetRows,
        source.worksheetGid ?? undefined,
      );
    }
    return report;
  }

  /** Finds the sync source (if any) a Needs-Review job's rows should write back to — null for a plain manual upload/import, or when a later sync cycle has since moved the source's "most recent job" pointer elsewhere. Matches ANY source type — Store Orders' phone-match review and Shipping Updates' conflict review both flow through here. */
  private async findSourceForJob(jobId: string) {
    return this.prisma.syncSourceConfig.findFirst({
      where: { importJobId: jobId, deletedAt: null },
    });
  }

  /** Confirm a Needs-Review row ("قبول الطلب" / a Shipping conflict override) — delegates to the same `ImportJobsService.confirmRow` the generic Needs Review screen uses, then writes the outcome back to the sheet in the correct column set for this source's type. */
  async confirmRow(jobId: string, rowId: string, userId?: string) {
    const errorRow = await this.prisma.importJobError.findUnique({
      where: { id: rowId },
    });
    const source = errorRow ? await this.findSourceForJob(jobId) : null;

    const result = await this.importJobs.confirmRow(jobId, rowId, userId);

    if (source && errorRow) {
      if (source.sourceType === SyncSourceType.SHIPPING_UPDATES) {
        await this.googleSheets.writeRowResults(
          source.spreadsheetId,
          [
            {
              rowNumber: errorRow.rowNumber,
              values: {
                'Shipping Sync Status': 'UPDATED',
                'Shipping Sync Message': 'تم تحديث حالة الشحن',
                'Shipment ID': result.id,
              },
            },
          ],
          source.worksheetGid ?? undefined,
        );
      } else {
        const order = await this.prisma.storeOrder.findUnique({
          where: { id: result.id },
          select: { internalOrderId: true },
        });
        await this.googleSheets.writeRowResults(
          source.spreadsheetId,
          [
            {
              rowNumber: errorRow.rowNumber,
              values: storeOrderWritebackValues({
                status: 'imported',
                internalOrderId: order?.internalOrderId,
              }),
            },
          ],
          source.worksheetGid ?? undefined,
        );
      }
    }
    return result;
  }

  /** Reject a Needs-Review row ("رفض الطلب" / a Shipping conflict) — delegates to `ImportJobsService.rejectRow`, then writes the rejection back to the sheet in the correct column set for this source's type. */
  async rejectRow(jobId: string, rowId: string, dto: RejectImportRowDto) {
    const errorRow = await this.prisma.importJobError.findUnique({
      where: { id: rowId },
    });
    const source = errorRow ? await this.findSourceForJob(jobId) : null;

    const result = await this.importJobs.rejectRow(jobId, rowId, dto);

    if (source && errorRow) {
      const message = dto.note ?? dto.reasonCode;
      if (source.sourceType === SyncSourceType.SHIPPING_UPDATES) {
        await this.googleSheets.writeRowResults(
          source.spreadsheetId,
          [
            {
              rowNumber: errorRow.rowNumber,
              values: {
                'Shipping Sync Status': 'REJECTED',
                'Shipping Sync Message': message,
                'Shipment ID': '',
              },
            },
          ],
          source.worksheetGid ?? undefined,
        );
      } else {
        await this.googleSheets.writeRowResults(
          source.spreadsheetId,
          [
            {
              rowNumber: errorRow.rowNumber,
              values: storeOrderWritebackValues({
                status: 'error',
                issues: [{ message }],
              }),
            },
          ],
          source.worksheetGid ?? undefined,
        );
      }
    }
    return result;
  }
}
