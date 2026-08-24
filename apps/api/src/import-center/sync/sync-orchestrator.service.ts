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
import { CustomersService } from '../../customers/customers.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import {
  matchReferenceRecords,
  matchCodeSuffix,
} from '../reference-data/match-reference-records';
import { referenceValueKey } from '../list-sheet/list-sheet.normalize';
import { buildSyncReviewRows, type SyncReviewRow } from './sync-review.util';
import {
  groupRowsByKey,
  extractImportErrorMessage,
} from '../import-value.util';
import {
  classifyDeletedStoreOrderGroups,
  classifyStoreOrderGroups,
  externalDupWritebackValues,
  fingerprintMappedRows,
  fingerprintStorageKey,
  isDeletedSyncRowNumber,
  normalizeExternalOrderId,
  phoneSkipWritebackValues,
  REPEAT_CUSTOMER_ORDER_LABEL,
  storeOrderWritebackValues,
  STORE_ORDER_RESULT_COLUMNS,
  type BatchPhoneMember,
  type ClassifiedStoreOrderGroup,
  type DeletedStoreOrderGroup,
  type PhoneMatchScope,
  type PriorOrderSummary,
  type StoreOrderRowHashMap,
} from './store-orders-sync.lifecycle';
import {
  SHIPPING_RESULT_COLUMNS,
  STORE_ORDERS_SHEET_LAYOUT,
  isEmptyShippingInput,
  missingShippingInputColumnNames,
  readShippingSyncMetadata,
  shippingColumnMappingFromStoreOrders,
  shippingStatusHeaderRename,
  withShippingSyncMetadata,
} from './store-orders-sheet.columns';

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

/** Full-Batch Phone Duplicate Detection — the review message names every row/order sharing the phone and whether the match is inside this batch, against an existing OMS order, or both. */
function phoneMatchScopeLabel(
  scope: PhoneMatchScope | null | undefined,
): string {
  switch (scope) {
    case 'BATCH':
      return 'داخل نفس ملف الاستيراد';
    case 'EXISTING':
      return 'مع طلب سابق في النظام';
    case 'BOTH':
      return 'داخل نفس ملف الاستيراد ومع طلب سابق في النظام';
    default:
      return '';
  }
}

function buildPhoneMatchMessage(
  normalizedPhone: string | null,
  prior: PriorOrderSummary | null | undefined,
  batchMatches: BatchPhoneMember[] | undefined,
  scope: PhoneMatchScope | null | undefined,
): string {
  const parts: string[] = [];
  if (normalizedPhone) parts.push(`رقم الجوال: ${normalizedPhone}`);
  const scopeLabel = phoneMatchScopeLabel(scope);
  if (scopeLabel) parts.push(`نوع التطابق: ${scopeLabel}`);
  if (prior) {
    const priorExternal = prior.externalOrderId
      ? ` / ${prior.externalOrderId}`
      : '';
    const priorDate = prior.orderDate ? ` بتاريخ ${prior.orderDate}` : '';
    parts.push(
      `طلب سابق في النظام: ${prior.internalOrderId}${priorExternal}${priorDate}`,
    );
  }
  if (batchMatches?.length) {
    const others = batchMatches
      .map((member) => {
        const name = member.customerName ? ` — ${member.customerName}` : '';
        const external = member.displayExternalOrderId
          ? ` (${member.displayExternalOrderId})`
          : '';
        return `الصف ${member.rowNumbers.join('/')}${external}${name}`;
      })
      .join('، ');
    parts.push(`صفوف أخرى في نفس الملف بنفس رقم الجوال: ${others}`);
  }
  parts.push('الإجراء الافتراضي: تخطي. اقبل صراحةً كطلب جديد لاستيراده.');
  return parts.join(' — ');
}

type ShippingRunAs = 'SHIPPING_UPDATES';

type SyncRunOptions = {
  retryRowNumbers?: number[];
  retryAllFailed?: boolean;
  runAs?: ShippingRunAs;
};

type SyncCommitOptions = {
  acceptRowNumbers?: number[];
  runAs?: ShippingRunAs;
};

export interface SyncPreviewIncremental {
  newCount: number;
  retryCount: number;
  errorCount: number;
  readyCount: number;
  importedSkippedCount: number;
  unchangedSkippedCount: number;
  externalDupCount: number;
  phoneMatchCount: number;
  totalScanned: number;
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
  /** SHIPPING_UPDATES only — count of `rows` with `result: 'SKIPPED_FINAL'`, for the "تم تجاوز N شحنة منتهية" summary line instead of flooding the report with one row each. */
  skippedFinalCount?: number;
  writebackError?: string | null;
}

/** Per-row detail for a SHIPPING_UPDATES commit (spec section 13's report table) — populated only for that source type. */
export interface ShippingSyncRowReport {
  externalOrderId: string;
  result:
    | 'UPDATED'
    | 'NO_CHANGE'
    | 'REJECTED'
    | 'NOT_FOUND'
    | 'NEEDS_REVIEW'
    /** The incoming row just moved this shipment into a FINAL syncBehavior status for the first time. */
    | 'FINAL'
    /** The shipment was already FINAL — skipped outright, no revalidation, no write. */
    | 'SKIPPED_FINAL';
  shipmentId: string | null;
  message: string;
}

/** Final-Shipment Sync Rules write-back text — the ticket's own literal example. */
const FINAL_SYNC_STATUS_LABEL = 'تمت المزامنة — حالة نهائية';
const SKIPPED_FINAL_SYNC_STATUS_LABEL = 'تم تجاوز — حالة نهائية';
function finalSyncMessage(statusName: string): string {
  return `تم إغلاق مزامنة هذه الشحنة لأنها في حالة «${statusName}».`;
}
function skippedFinalSyncMessage(statusName: string): string {
  return `تم تجاوز هذه الشحنة لأنها بالفعل في حالة نهائية «${statusName}».`;
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
    private readonly referenceData: ReferenceDataRegistryService,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Canonical Phone Normalization — resolves a List Sheet Country display
   * value (e.g. "السعودية") to its ISO2 calling-code region, reusing the
   * EXACT SAME matcher (`matchReferenceRecords`/`matchCodeSuffix`) the real
   * Store Orders import path resolves Country through (never a second,
   * weaker ad-hoc lookup — a bare `Prisma equals` comparison is not
   * whitespace-safe, so a pasted sheet value with incidental spaces would
   * silently fail to resolve a country that import validation resolves
   * just fine). Never throws — a preview-time duplicate-detection pre-check
   * must degrade gracefully (phone stays unparsed) rather than break the
   * whole batch.
   */
  private async resolveCountryCodeForPhone(
    countryName: string,
  ): Promise<string | undefined> {
    const trimmed = countryName.trim();
    if (!trimmed) return undefined;
    const records = await this.referenceData.listCached('COUNTRY');
    let matches = matchReferenceRecords(records, 'name', trimmed);
    if (matches.length === 0) matches = matchCodeSuffix(records, trimmed);
    const match = matches.length === 1 ? matches[0] : undefined;
    return match?.active && match.code ? match.code : undefined;
  }

  private async getEnabledSource(
    sourceId: string,
    userId?: string,
    runAs?: ShippingRunAs,
  ) {
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
    const effectiveType = this.effectiveSourceType(source.sourceType, runAs);
    const extraPermission = EXTRA_PERMISSION_BY_SOURCE[effectiveType];
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

  private effectiveSourceType(
    sourceType: SyncSourceType,
    runAs?: ShippingRunAs,
  ): SyncSourceType {
    if (!runAs) return sourceType;
    if (
      sourceType !== SyncSourceType.STORE_ORDERS &&
      sourceType !== SyncSourceType.SHIPPING_UPDATES
    ) {
      throw new BadRequestException(
        'Shipping Sync can only run against the Store Orders Google Sheets source.',
      );
    }
    return SyncSourceType.SHIPPING_UPDATES;
  }

  private reusesStoreOrdersSource(
    sourceType: SyncSourceType,
    runAs?: ShippingRunAs,
  ): boolean {
    return (
      runAs === 'SHIPPING_UPDATES' && sourceType === SyncSourceType.STORE_ORDERS
    );
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
    overrides?: {
      handlerType?: string;
      columnMapping?: Record<string, string>;
    },
  ) {
    const metadata = (source.configMetadata ?? {}) as {
      columnMapping?: Record<string, string>;
    };
    const columnMapping = overrides?.columnMapping ?? metadata.columnMapping;
    if (!columnMapping || Object.keys(columnMapping).length === 0) {
      throw new BadRequestException(
        `"${source.label}" has no saved column mapping — edit the source and map its columns before syncing.`,
      );
    }

    const handlerType =
      overrides?.handlerType ?? HANDLER_TYPE_BY_SOURCE[source.sourceType];
    const job = await this.importJobs.create(
      { importType: handlerType },
      userId,
    );
    await this.importJobs.uploadFromGoogleSheets(
      job.id,
      this.buildShareUrl(source),
    );
    await this.importJobs.setMapping(job.id, { columnMapping });

    await this.prisma.importJob.update({
      where: { id: job.id },
      data: {
        rowDefaults: this.rowDefaultsFor({
          ...source,
          sourceType: overrides?.handlerType
            ? SyncSourceType.SHIPPING_UPDATES
            : source.sourceType,
        }),
      },
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
    options?: SyncRunOptions,
  ): Promise<SyncPreviewResult> {
    const source = await this.getEnabledSource(
      sourceId,
      userId,
      options?.runAs,
    );
    return this.withSyncLock(sourceId, async () => {
      if (this.reusesStoreOrdersSource(source.sourceType, options?.runAs)) {
        return this.previewShippingOnStoreOrdersSource(source, userId);
      }

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

  private async previewShippingOnStoreOrdersSource(
    source: {
      id: string;
      sourceType: SyncSourceType;
      label: string;
      spreadsheetId: string;
      worksheetGid: string | null;
      worksheetName: string | null;
      configMetadata: unknown;
    },
    userId?: string,
  ): Promise<SyncPreviewResult> {
    const metadata = (source.configMetadata ?? {}) as {
      columnMapping?: Record<string, string>;
    };
    // Ensure T:W employee input headers exist without orphaning a legacy
    // `Status` column: rename in place when needed, then append only truly
    // missing headers (never wipe cell values).
    let headers = await this.googleSheets.getHeaders(
      source.spreadsheetId,
      source.worksheetGid ?? undefined,
    );
    const rename = shippingStatusHeaderRename(headers);
    if (rename) {
      await this.googleSheets.renameHeader(
        source.spreadsheetId,
        rename.from,
        rename.to,
        source.worksheetGid ?? undefined,
      );
      headers = await this.googleSheets.getHeaders(
        source.spreadsheetId,
        source.worksheetGid ?? undefined,
      );
    }
    const missingShippingHeaders = missingShippingInputColumnNames(headers);
    if (missingShippingHeaders.length > 0) {
      await this.googleSheets.ensureResultColumns(
        source.spreadsheetId,
        missingShippingHeaders,
        source.worksheetGid ?? undefined,
        { minStartColumn: STORE_ORDERS_SHEET_LAYOUT.shippingInputStartColumn },
      );
      headers = await this.googleSheets.getHeaders(
        source.spreadsheetId,
        source.worksheetGid ?? undefined,
      );
    }
    const jobId = await this.createRunJob(source, userId, {
      handlerType: HANDLER_TYPE_BY_SOURCE[SyncSourceType.SHIPPING_UPDATES],
      columnMapping: shippingColumnMappingFromStoreOrders(
        metadata.columnMapping ?? {},
        headers,
      ),
    });
    const mapped = await this.importJobs.listMappedRows(jobId);
    const skipRowNumbers = mapped.rows
      .filter((row) => isEmptyShippingInput(row.mappedRow))
      .map((row) => row.rowNumber);
    const result = await this.importJobs.validate(jobId, userId, {
      skipRowNumbers,
    });
    await this.prisma.syncSourceConfig.update({
      where: { id: source.id },
      data: {
        configMetadata: withShippingSyncMetadata(source.configMetadata, {
          importJobId: jobId,
          skipRowNumbers,
        }) as unknown as Prisma.InputJsonValue,
      },
    });
    const preview = await this.buildGenericPreview(source, jobId, result);
    const skipped = new Set(skipRowNumbers);
    preview.rows = preview.rows.filter(
      (row) => !row.rowNumbers.every((rowNumber) => skipped.has(rowNumber)),
    );
    preview.totalRows = Math.max(0, preview.totalRows - skipRowNumbers.length);
    preview.newCount = Math.max(0, preview.newCount - skipRowNumbers.length);
    preview.willImportCount = Math.max(
      0,
      preview.willImportCount - skipRowNumbers.length,
    );
    return preview;
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
        const staleId = group.staleSheetSystemOrderId?.trim() || '—';
        const externalId = group.displayExternalOrderId || '—';
        result.errors.push({
          rowNumber,
          columnName: 'System Order ID',
          message: `الصف ${rowNumber}: رقم الطلب في النظام «${staleId}» غير موجود في OMS (الرقم الخارجي: ${externalId}). امسح نتائج المزامنة (Q:R:S) ثم أعد المزامنة — لا يُنشأ طلب جديد طالما بقي رقم النظام القديم.`,
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
        const prior = group?.priorOrder;
        const issues = [...row.issues];
        if (group?.lifecycle === 'PHONE_MATCH') {
          if (!issues.some((issue) => issue.code === 'PHONE_MATCH')) {
            issues.push({
              field: 'customerPhone',
              code: 'PHONE_MATCH',
              message: buildPhoneMatchMessage(
                row.normalizedPhone,
                prior,
                group.batchPhoneMatches,
                group.phoneMatchScope,
              ),
            });
          }
        }
        if (group?.lifecycle === 'ORPHAN_LINK') {
          const staleId = group.staleSheetSystemOrderId?.trim() || '—';
          const externalId = group.displayExternalOrderId || '—';
          if (!issues.some((issue) => issue.code === 'ORPHAN_LINK')) {
            issues.push({
              field: 'System Order ID',
              code: 'ORPHAN_LINK',
              message: `رقم الطلب في النظام «${staleId}» غير موجود في OMS. الرقم الخارجي: ${externalId}. الإجراء الموصى به: إعادة تعيين نتائج المزامنة (Q:R:S) ثم إعادة المحاولة.`,
              originalValue: staleId === '—' ? null : staleId,
            });
          }
        }
        return {
          ...row,
          issues,
          status:
            group?.lifecycle === 'PHONE_MATCH'
              ? ('DUPLICATE' as const)
              : group?.lifecycle === 'ORPHAN_LINK'
                ? ('ERROR' as const)
                : row.status,
          lifecycle: group?.lifecycle ?? 'NEW',
          changed: group?.changed ?? false,
          retryable: group?.retryable ?? false,
          existingRecordId:
            row.existingRecordId ??
            group?.existingInternalOrderId ??
            prior?.internalOrderId ??
            null,
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
      totalScanned: classified.length,
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
      externalDupCount: classified.filter(
        (row) => row.lifecycle === 'EXTERNAL_DUP',
      ).length,
      phoneMatchCount: classified.filter(
        (row) => row.lifecycle === 'PHONE_MATCH',
      ).length,
      modifiedCount: 0,
      deletedCount: deleted.length,
      nothingToSync: preview.rows.length === 0,
    };
    preview.incremental = incremental;
    preview.newCount = incremental.newCount;
    preview.willImportCount = incremental.readyCount;
    preview.errorCount = incremental.errorCount;
    preview.duplicateCount =
      incremental.externalDupCount + incremental.phoneMatchCount;
    preview.needsReviewCount = warningCount + incremental.phoneMatchCount;
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
          .map((group) =>
            normalizeExternalOrderId(group[0]?.mappedRow.externalOrderId),
          )
          .filter((id): id is string => !!id),
      ),
    ];
    const existing = externalIds.length
      ? await this.prisma.storeOrder.findMany({
          where: {
            deletedAt: null,
            OR: externalIds.map((id) => ({
              externalOrderId: { equals: id, mode: 'insensitive' as const },
            })),
          },
          select: { externalOrderId: true, internalOrderId: true },
        })
      : [];
    const existingByExternalId = new Map(
      existing
        .filter((order) => order.externalOrderId)
        .map((order) => [
          normalizeExternalOrderId(order.externalOrderId),
          { internalOrderId: order.internalOrderId },
        ]),
    );

    // Canonical Phone Normalization + Full-Batch Phone Duplicate Detection.
    const phoneByGroupRow = new Map<number, string | null>();
    const batchPhoneGroups = new Map<string, BatchPhoneMember[]>();
    const phones = new Set<string>();
    for (const group of groups) {
      const primary = group[0];
      if (!primary) continue;
      const rawPhone = primary.mappedRow.customerPhone?.trim() ?? '';
      const countryName = primary.mappedRow.countryName?.trim() ?? '';
      let e164: string | null = null;
      if (rawPhone) {
        const countryCode = countryName
          ? await this.resolveCountryCodeForPhone(countryName)
          : undefined;
        const parsed = this.phone.parse(rawPhone, countryCode);
        e164 = parsed?.isValid ? (parsed.e164 ?? null) : null;
      }
      phoneByGroupRow.set(primary.rowNumber, e164);
      if (!e164) continue;
      phones.add(e164);

      const member: BatchPhoneMember = {
        primaryRowNumber: primary.rowNumber,
        rowNumbers: group.map((row) => row.rowNumber),
        externalOrderId: normalizeExternalOrderId(
          primary.mappedRow.externalOrderId,
        ),
        displayExternalOrderId: (
          primary.mappedRow.externalOrderId ?? ''
        ).trim(),
        customerName: primary.mappedRow.customerName?.trim() ?? '',
      };
      const members = batchPhoneGroups.get(e164) ?? [];
      members.push(member);
      batchPhoneGroups.set(e164, members);
    }

    const priorOrderByPhone = new Map<string, PriorOrderSummary>();
    if (phones.size > 0) {
      // Existing-data compatibility (safe, read-only): matches normalized
      // against possibly raw/mixed-format stored `phone`/`mobile` values —
      // never assumes a Customer row is already clean E.164, never merges
      // or rewrites anything.
      const customerByPhone = await this.customers.findByNormalizedPhones([
        ...phones,
      ]);
      const customerIds = [
        ...new Set([...customerByPhone.values()].map((c) => c.id)),
      ];
      if (customerIds.length > 0) {
        const orders = await this.prisma.storeOrder.findMany({
          where: { customerId: { in: customerIds }, deletedAt: null },
          orderBy: { orderDate: 'desc' },
          select: {
            customerId: true,
            internalOrderId: true,
            externalOrderId: true,
            orderDate: true,
          },
        });
        const orderByCustomerId = new Map<string, (typeof orders)[number]>();
        for (const order of orders) {
          if (!orderByCustomerId.has(order.customerId)) {
            orderByCustomerId.set(order.customerId, order);
          }
        }
        for (const [normalizedPhone, customer] of customerByPhone) {
          const order = orderByCustomerId.get(customer.id);
          if (!order) continue;
          priorOrderByPhone.set(normalizedPhone, {
            internalOrderId: order.internalOrderId,
            externalOrderId: order.externalOrderId,
            orderDate: order.orderDate
              ? order.orderDate.toISOString().slice(0, 10)
              : null,
          });
        }
      }
    }

    return classifyStoreOrderGroups({
      groups: groups.map((group) => ({
        rowNumbers: group.map((row) => row.rowNumber),
        mappedRows: group.map((row) => ({
          ...row.mappedRow,
          externalOrderId: normalizeExternalOrderId(
            row.mappedRow.externalOrderId,
          ),
        })),
        sourceRow: group[0]?.sourceRow ?? {},
      })),
      existingByExternalId,
      priorOrderByPhone,
      phoneByGroupRow,
      batchPhoneGroups,
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
      if (row.lifecycle === 'PHONE_MATCH') {
        // Preview only — leave sheet eligible until commit accept/reject.
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
      (row) => row.lifecycle === 'EXTERNAL_DUP',
    )) {
      const values = externalDupWritebackValues({
        displayExternalOrderId:
          group.displayExternalOrderId || group.externalOrderId,
        existingInternalOrderId: group.existingInternalOrderId ?? '',
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
      if (
        group.lifecycle === 'IMPORTED' ||
        group.lifecycle === 'EXTERNAL_DUP'
      ) {
        if (!hashes[key]?.hash?.trim()) {
          hashes[key] = {
            hash: group.hash,
            status: 'IMPORTED',
            internalOrderId: group.existingInternalOrderId ?? undefined,
          };
        }
        continue;
      }
      if (group.lifecycle === 'DELETED') {
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
          storeOrderPhoneMatchRowNumbers: classified
            .filter((group) => group.lifecycle === 'PHONE_MATCH')
            .flatMap((group) => group.rowNumbers),
          storeOrderPhoneMatchPriors: Object.fromEntries(
            classified
              .filter(
                (group) =>
                  group.lifecycle === 'PHONE_MATCH' && group.priorOrder,
              )
              .map((group) => [String(group.rowNumbers[0]), group.priorOrder]),
          ),
          storeOrderPhoneMatchBatch: Object.fromEntries(
            classified
              .filter(
                (group) =>
                  group.lifecycle === 'PHONE_MATCH' &&
                  group.batchPhoneMatches?.length,
              )
              .map((group) => [
                String(group.rowNumbers[0]),
                group.batchPhoneMatches,
              ]),
          ),
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
      countryCodeByName.set(referenceValueKey(country.name), country.code);
      if (country.nameEn) {
        countryCodeByName.set(referenceValueKey(country.nameEn), country.code);
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
    options?: SyncCommitOptions,
  ): Promise<SyncCommitResult> {
    const source = await this.getEnabledSource(
      sourceId,
      userId,
      options?.runAs,
    );
    const shippingOnStoreOrders = this.reusesStoreOrdersSource(
      source.sourceType,
      options?.runAs,
    );
    const expectedJobId = shippingOnStoreOrders
      ? readShippingSyncMetadata(source.configMetadata).importJobId
      : source.importJobId;
    if (expectedJobId !== jobId) {
      throw new BadRequestException(
        'This preview is no longer current — run Sync again before committing.',
      );
    }

    return this.withSyncLock(sourceId, async () => {
      let acceptRowNumbers = options?.acceptRowNumbers;
      if (acceptRowNumbers === undefined && shippingOnStoreOrders) {
        const skip = new Set(
          readShippingSyncMetadata(source.configMetadata).skipRowNumbers ?? [],
        );
        const mapped = await this.importJobs.listMappedRows(jobId);
        acceptRowNumbers = mapped.rows
          .map((row) => row.rowNumber)
          .filter((rowNumber) => !skip.has(rowNumber));
      } else if (
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
      const shouldBoundAcceptRows =
        options?.acceptRowNumbers !== undefined ||
        source.sourceType === SyncSourceType.STORE_ORDERS;
      const result = await this.importJobs.run(jobId, userId, {
        ...options,
        acceptRowNumbers: shouldBoundAcceptRows ? acceptedSheetRows : undefined,
        contextOverrides:
          source.sourceType === SyncSourceType.STORE_ORDERS &&
          !shippingOnStoreOrders
            ? { allowRepeatCustomer: 'true' }
            : undefined,
      });

      const noChangeCount = result.successRows.filter(
        (row) => row.noChange,
      ).length;
      const skippedFinalCount = result.successRows.filter(
        (row) => row.skippedFinal,
      ).length;

      const summary: SyncCommitResult = {
        totalRows: result.totalRows,
        importedCount: result.successCount,
        errorCount: result.errorCount,
        skippedFinalCount,
        status:
          result.successCount === 0 && result.errorCount > 0
            ? SyncRunStatus.FAILED
            : result.errorCount > 0
              ? SyncRunStatus.PARTIAL
              : SyncRunStatus.SUCCESS,
      };

      const lastSyncSummary = {
        totalRows: summary.totalRows,
        importedCount: summary.importedCount,
        noChangeCount,
        skippedFinalCount,
        errorCount: summary.errorCount,
      };

      if (shippingOnStoreOrders) {
        await this.prisma.syncSourceConfig.update({
          where: { id: source.id },
          data: {
            configMetadata: withShippingSyncMetadata(source.configMetadata, {
              lastSyncedAt: new Date().toISOString(),
              lastSyncStatus: summary.status,
              lastSyncUserId: userId ?? null,
              lastSyncSummary,
            }) as unknown as Prisma.InputJsonValue,
          },
        });
      } else {
        await this.prisma.syncSourceConfig.update({
          where: { id: source.id },
          data: {
            lastSyncedAt: new Date(),
            lastSyncStatus: summary.status,
            lastSyncUserId: userId ?? null,
            lastSyncSummary,
          },
        });
      }

      let writebackError: string | null = null;
      const writeShipping =
        shippingOnStoreOrders ||
        source.sourceType === SyncSourceType.SHIPPING_UPDATES;
      if (shippingOnStoreOrders) {
        try {
          summary.rows = await this.writeBackShippingUpdates(
            source,
            result,
            (result.columnMapping ?? {}) as Record<string, string>,
          );
        } catch (error) {
          writebackError = extractImportErrorMessage(error);
          summary.status =
            summary.importedCount > 0
              ? SyncRunStatus.PARTIAL
              : SyncRunStatus.FAILED;
        }
      } else if (source.sourceType === SyncSourceType.STORE_ORDERS) {
        try {
          await this.writeBackStoreOrders(source, result);
          await this.writeRejectedPhoneMatchRows(
            source,
            acceptedSheetRows,
            options?.acceptRowNumbers !== undefined,
          );
          await this.labelAcceptedPhoneMatchOrders(source, result.successRows);
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
      } else if (writeShipping) {
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
        if (shippingOnStoreOrders) {
          await this.prisma.syncSourceConfig.update({
            where: { id: source.id },
            data: {
              configMetadata: withShippingSyncMetadata(source.configMetadata, {
                lastSyncStatus: summary.status,
              }) as unknown as Prisma.InputJsonValue,
            },
          });
        } else {
          await this.prisma.syncSourceConfig.update({
            where: { id: source.id },
            data: { lastSyncStatus: summary.status },
          });
        }
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
  /**
   * Phone-match rows default to Reject. On commit, any phone-match row that
   * was not explicitly accepted gets an Arabic skip write-back (no OMS order).
   */
  private async writeRejectedPhoneMatchRows(
    source: {
      id: string;
      spreadsheetId: string;
      worksheetGid: string | null;
      configMetadata: unknown;
    },
    acceptedSheetRows: number[],
    decisionsWereSent: boolean,
  ) {
    if (!decisionsWereSent) return;
    const metadata = (source.configMetadata ?? {}) as {
      storeOrderPhoneMatchRowNumbers?: number[];
      storeOrderPhoneMatchPriors?: Record<
        string,
        { internalOrderId: string } | undefined
      >;
      storeOrderPhoneMatchBatch?: Record<string, BatchPhoneMember[]>;
    };
    const phoneMatchRows = metadata.storeOrderPhoneMatchRowNumbers ?? [];
    if (phoneMatchRows.length === 0) return;
    const accepted = new Set(acceptedSheetRows);
    const writes = phoneMatchRows
      .filter((rowNumber) => !accepted.has(rowNumber))
      .map((rowNumber) => {
        const prior =
          metadata.storeOrderPhoneMatchPriors?.[String(rowNumber)]
            ?.internalOrderId ?? '';
        const batchMatches =
          metadata.storeOrderPhoneMatchBatch?.[String(rowNumber)] ?? [];
        return {
          rowNumber,
          values: phoneSkipWritebackValues({
            priorInternalOrderId: prior,
            batchMatches,
          }),
        };
      });
    if (writes.length === 0) return;
    await this.googleSheets.writeRowResults(
      source.spreadsheetId,
      writes,
      source.worksheetGid ?? undefined,
    );
  }

  /**
   * Full-Batch Phone Duplicate Detection — "If the user explicitly accepts
   * a row as new: apply the مكرر badge." Reads the SAME
   * `storeOrderPhoneMatchRowNumbers` metadata `writeRejectedPhoneMatchRows`
   * uses, so it's driven by the actual classification decision rather than
   * a live "does a prior order already exist" query — which would miss the
   * FIRST row of a batch-only duplicate pair (nothing existed yet when it
   * was created, only the second row's own creation would have found it).
   */
  private async labelAcceptedPhoneMatchOrders(
    source: { configMetadata: unknown },
    successRows: { rowNumber: number; id: string }[],
  ) {
    const metadata = (source.configMetadata ?? {}) as {
      storeOrderPhoneMatchRowNumbers?: number[];
    };
    const phoneMatchRows = new Set(
      metadata.storeOrderPhoneMatchRowNumbers ?? [],
    );
    if (phoneMatchRows.size === 0) return;
    const orderIds = successRows
      .filter((row) => phoneMatchRows.has(row.rowNumber))
      .map((row) => row.id);
    if (orderIds.length === 0) return;
    await this.prisma.storeOrder.updateMany({
      where: { id: { in: orderIds } },
      data: { sourceChannel: REPEAT_CUSTOMER_ORDER_LABEL },
    });
  }

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
    source: {
      spreadsheetId: string;
      worksheetGid: string | null;
      sourceType?: SyncSourceType;
    },
    result: {
      successRows: {
        rowNumber: number;
        id: string;
        noChange?: boolean;
        skippedFinal?: boolean;
      }[];
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
            shippingStatus: { select: { name: true, syncBehavior: true } },
          },
        })
      : [];
    const shipmentInfoById = new Map(shipments.map((s) => [s.id, s]));

    const sheetRows: { rowNumber: number; values: Record<string, string> }[] =
      [];
    const report: ShippingSyncRowReport[] = [];
    const externalOrderIdColumn = columnMapping.externalOrderId;

    for (const {
      rowNumber,
      id,
      noChange,
      skippedFinal,
    } of result.successRows) {
      const info = shipmentInfoById.get(id);
      const isFinal = info?.shippingStatus?.syncBehavior === 'FINAL';
      const statusName = info?.shippingStatus?.name ?? '';

      let status: ShippingSyncRowReport['result'];
      let message: string;
      if (skippedFinal) {
        status = 'SKIPPED_FINAL';
        message = skippedFinalSyncMessage(statusName);
      } else if (isFinal) {
        status = 'FINAL';
        message = finalSyncMessage(statusName);
      } else {
        status = noChange ? 'NO_CHANGE' : 'UPDATED';
        message = noChange ? 'لا يوجد تغيير' : 'تم تحديث حالة الشحن';
      }
      const sheetStatus = skippedFinal
        ? SKIPPED_FINAL_SYNC_STATUS_LABEL
        : isFinal
          ? FINAL_SYNC_STATUS_LABEL
          : status;
      sheetRows.push({
        rowNumber,
        values: {
          [SHIPPING_RESULT_COLUMNS.syncStatus]: sheetStatus,
          [SHIPPING_RESULT_COLUMNS.syncMessage]: message,
          [SHIPPING_RESULT_COLUMNS.shipmentId]: id,
        },
      });
      report.push({
        externalOrderId: info?.storeOrder?.externalOrderId ?? '',
        result: status,
        shipmentId: id,
        message,
      });
    }

    for (const error of result.errors) {
      const isNeedsReview = error.errorMessage.startsWith(NEEDS_REVIEW_PREFIX);
      const isNotFound =
        /No Store Order found/i.test(error.errorMessage) ||
        error.errorMessage.includes('لا يوجد طلب متجر') ||
        error.errorMessage.includes('تعذر العثور على طلب OMS') ||
        error.errorMessage.includes('لا يمكن مزامنة الشحن');
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
          [SHIPPING_RESULT_COLUMNS.syncStatus]: status,
          [SHIPPING_RESULT_COLUMNS.syncMessage]: message,
          [SHIPPING_RESULT_COLUMNS.shipmentId]: '',
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
        source.sourceType === SyncSourceType.STORE_ORDERS
          ? {
              minStartColumn:
                STORE_ORDERS_SHEET_LAYOUT.shippingResultStartColumn,
            }
          : undefined,
      );
    }
    return report;
  }

  /** Finds the sync source (if any) a Needs-Review job's rows should write back to — null for a plain manual upload/import, or when a later sync cycle has since moved the source's "most recent job" pointer elsewhere. Matches ANY source type — Store Orders' phone-match review and Shipping Updates' conflict review both flow through here. */
  private async findSourceForJob(jobId: string) {
    return this.prisma.syncSourceConfig.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { importJobId: jobId },
          {
            configMetadata: {
              path: ['shippingSync', 'importJobId'],
              equals: jobId,
            },
          },
        ],
      },
    });
  }

  private async isShippingJob(jobId: string): Promise<boolean> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: { importType: true },
    });
    return job?.importType === 'SHIPPING_UPDATES';
  }

  private shippingRowWriteOptions(source: {
    sourceType: SyncSourceType;
  }): { minStartColumn: string } | undefined {
    return source.sourceType === SyncSourceType.STORE_ORDERS
      ? {
          minStartColumn: STORE_ORDERS_SHEET_LAYOUT.shippingResultStartColumn,
        }
      : undefined;
  }

  /** Confirm a Needs-Review row ("قبول الطلب" / a Shipping conflict override) — delegates to the same `ImportJobsService.confirmRow` the generic Needs Review screen uses, then writes the outcome back to the sheet in the correct column set for this source's type. */
  async confirmRow(jobId: string, rowId: string, userId?: string) {
    const errorRow = await this.prisma.importJobError.findUnique({
      where: { id: rowId },
    });
    const source = errorRow ? await this.findSourceForJob(jobId) : null;

    const result = await this.importJobs.confirmRow(jobId, rowId, userId);

    if (source && errorRow) {
      if (
        source.sourceType === SyncSourceType.SHIPPING_UPDATES ||
        (await this.isShippingJob(jobId))
      ) {
        await this.googleSheets.writeRowResults(
          source.spreadsheetId,
          [
            {
              rowNumber: errorRow.rowNumber,
              values: {
                [SHIPPING_RESULT_COLUMNS.syncStatus]: 'UPDATED',
                [SHIPPING_RESULT_COLUMNS.syncMessage]: 'تم تحديث حالة الشحن',
                [SHIPPING_RESULT_COLUMNS.shipmentId]: result.id,
              },
            },
          ],
          source.worksheetGid ?? undefined,
          this.shippingRowWriteOptions(source),
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
      if (
        source.sourceType === SyncSourceType.SHIPPING_UPDATES ||
        (await this.isShippingJob(jobId))
      ) {
        await this.googleSheets.writeRowResults(
          source.spreadsheetId,
          [
            {
              rowNumber: errorRow.rowNumber,
              values: {
                [SHIPPING_RESULT_COLUMNS.syncStatus]: 'REJECTED',
                [SHIPPING_RESULT_COLUMNS.syncMessage]: message,
                [SHIPPING_RESULT_COLUMNS.shipmentId]: '',
              },
            },
          ],
          source.worksheetGid ?? undefined,
          this.shippingRowWriteOptions(source),
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

  /**
   * Clears only OMS Store Orders result columns Q:R:S for the given sheet
   * rows. Never touches customer/order input or shipping T:W / X:Z.
   * After reset, rows become eligible for normal validation on the next preview.
   */
  async clearStoreOrderSyncResults(
    sourceId: string,
    rowNumbers: number[],
    userId?: string,
  ): Promise<{ clearedRowNumbers: number[] }> {
    const source = await this.getEnabledSource(sourceId, userId);
    if (source.sourceType !== SyncSourceType.STORE_ORDERS) {
      throw new BadRequestException(
        'Clearing sync result columns is only supported for Store Orders sources.',
      );
    }
    const uniqueRows = [
      ...new Set(
        rowNumbers.filter(
          (rowNumber) => Number.isInteger(rowNumber) && rowNumber >= 2,
        ),
      ),
    ];
    if (uniqueRows.length === 0) {
      throw new BadRequestException(
        'Select at least one sheet data row to reset.',
      );
    }
    const values = {
      [STORE_ORDER_RESULT_COLUMNS.syncStatus]: '',
      [STORE_ORDER_RESULT_COLUMNS.systemOrderId]: '',
      [STORE_ORDER_RESULT_COLUMNS.errorMessage]: '',
    };
    await this.googleSheets.writeRowResults(
      source.spreadsheetId,
      uniqueRows.map((rowNumber) => ({ rowNumber, values })),
      source.worksheetGid ?? undefined,
      { minStartColumn: STORE_ORDERS_SHEET_LAYOUT.storeOrderResultStartColumn },
    );
    return { clearedRowNumbers: uniqueRows };
  }
}
