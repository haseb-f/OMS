import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, ShipmentStatus, StoreOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreOrderShipmentsService } from '../../store-orders/shipments/store-order-shipments.service';
import {
  StoreOrderActivityService,
  StoreOrderActivitySource,
} from '../../store-orders/activities/store-order-activity.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import { getReferenceCache } from '../reference-data/reference-cache';
import {
  ImportRowNeedsReviewError,
  type ImportFieldDef,
  type ImportRowOptions,
  type ImportRowResult,
  type ImportTypeHandler,
} from '../import-type.interface';
import {
  isOperationalShipmentStatus,
  matchShippingStatusRecord,
  OPERATIONAL_SHIPMENT_STATUS_CODES,
} from '../../shipping/shipping-status.catalog';
import { SHIPPING_RESULT_COLUMN_NAMES } from '../sync/store-orders-sheet.columns';
import { normalizeExternalOrderId } from '../sync/store-orders-sync.lifecycle';

/**
 * The 6 usable Store Order ShipmentStatus values — the two legacy RETURN_*
 * values never appear in this handler's import surface (rule: "never use
 * the two legacy RETURN_* values"). Derived from the canonical shipping
 * status catalog so Excel dropdowns, List Sheet labels, and validation
 * never drift apart.
 */
export const ALLOWED_STATUSES: ShipmentStatus[] =
  OPERATIONAL_SHIPMENT_STATUS_CODES;

/** Statuses that indicate "a fresh shipping attempt is starting" — triggers RESHIP when the order's current shipment is already terminal. */
const RESHIP_TRIGGER_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.LABEL_CREATED,
  ShipmentStatus.SHIPPED,
];

/** Data Synchronization spec section 26 — never silently overwritten, always surfaced for a human decision. */
const CONFLICT_MESSAGE =
  'تم تعديل الشحنة في النظام بعد آخر مزامنة، يرجى مراجعة التغيير قبل تطبيق تحديث الشيت.';

/** Data Synchronization spec section 8/9 example, verbatim. */
const TRACKING_REQUIRED_MESSAGE = 'رقم التتبع مطلوب لهذه الحالة.';

/** Same transition guard the manual channel's `markNeedsReshipment` already enforces — a sync row must never reach NEEDS_RESHIPMENT by any other path, so this is checked here too rather than relying on `setStatus`'s deliberately permissive "jump to any status" import behavior. */
const INVALID_RESHIP_TRANSITION_MESSAGE =
  'لا يمكن الانتقال إلى حالة "يحتاج إعادة شحن" إلا من حالة "فشل التسليم".';

/** `preloadRows`'s batched Store Order lookup, keyed once per import/sync run — see `ImportTypeHandler.preloadRows`'s doc comment. */
const STORE_ORDER_CACHE_KEY = 'shipping-updates:store-orders-by-external-id';
/** Companion cache — System Order ID (`StoreOrder.internalOrderId`) is the PRIMARY resolution key; see `resolveOrder`. */
const STORE_ORDER_BY_INTERNAL_ID_CACHE_KEY =
  'shipping-updates:store-orders-by-internal-id';

/** Data Synchronization spec — "R populated but not resolvable" (never a silent fallback, never a new order). */
function systemOrderIdNotFoundMessage(systemOrderId: string): string {
  return `تعذر العثور على طلب OMS المرتبط بهذا الصف.\nرقم طلب OMS في عمود System Order ID: [${systemOrderId}].\nتحقق من الرقم أو أعد مزامنة طلبات المتجر أولًا.`;
}

/** Data Synchronization spec — neither R nor a usable External Order ID is present on the row. */
const NO_USABLE_IDENTIFIER_MESSAGE =
  'لا يمكن مزامنة الشحن لأن الصف لا يحتوي على رقم طلب OMS صالح أو رقم طلب خارجي صالح.';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'externalOrderId',
    labelKey: 'importCenter.fields.externalOrderId',
    label: 'External Order ID',
    // Not `required` at the generic-validation level: a row resolved by
    // System Order ID (see `systemOrderId` below) never needs it. Handler-
    // level `resolveOrder` still enforces "at least one identifier".
    required: false,
    type: 'string',
    example: 'SH-100234',
  },
  {
    key: 'systemOrderId',
    labelKey: 'importCenter.fields.systemOrderId',
    label: 'System Order ID',
    // PRIMARY resolution key (Store Order Sync's own write-back, column R
    // on the shared sheet) — resolved BEFORE External Order ID whenever
    // present. Optional because a plain CSV shipping-updates import never
    // has this column.
    required: false,
    type: 'string',
    example: 'STO-2026-000009',
  },
  {
    key: 'status',
    labelKey: 'importCenter.fields.shipmentStatus',
    label: 'Shipping Status',
    required: true,
    type: 'string',
    options: [],
    referenceType: 'SHIPPING_STATUS',
    example: 'تم الشحن',
  },
  {
    key: 'trackingNumber',
    labelKey: 'importCenter.fields.trackingNumber',
    label: 'Tracking Number',
    required: false,
    type: 'string',
  },
  {
    key: 'shippingCompanyName',
    labelKey: 'importCenter.fields.shippingCompanyName',
    label: 'Shipping Company',
    required: false,
    type: 'string',
    referenceType: 'SHIPPING_COMPANY',
  },
  {
    key: 'labelUrl',
    labelKey: 'importCenter.fields.shippingLabelUrl',
    label: 'Shipping Label URL',
    required: false,
    type: 'string',
  },
  {
    key: 'notes',
    labelKey: 'importCenter.fields.notes',
    label: 'Notes',
    required: false,
    type: 'string',
  },
];

/**
 * Shipping Updates Import — the ONE place a Shipment gets updated from an
 * external row (a CSV/XLSX upload through Import Center, or now a Google
 * Sheets Data Synchronization row via `SyncSourceConfig{sourceType:
 * SHIPPING_UPDATES}` — see `SyncOrchestratorService`). Resolves the Store
 * Order via `resolveOrder`: System Order ID (column R, Store Order Sync's
 * own write-back) FIRST when present — never falling back to External
 * Order ID once R is populated — then External Order ID only when R is
 * blank. Never a spreadsheet row number, never phone (rule 2). Then
 * decides the action per row:
 *
 *   - no Shipment yet + a shippable status        -> CREATE_SHIPMENT
 *   - current Shipment is open + an update         -> UPDATE_SHIPMENT
 *   - current Shipment is DELIVERY_FAILED/
 *     NEEDS_RESHIPMENT + a fresh-attempt status     -> RESHIP (always a NEW
 *     Shipment row on the SAME Store Order — never a new StoreOrder,
 *     reusing `createReshipment`, which is the existing "current shipment
 *     must already be NEEDS_RESHIPMENT" precondition, never invented here)
 *
 * Three Data Synchronization additions, all reused identically by BOTH the
 * CSV and Google Sheets channels (never a Sheets-only rule):
 *
 *   1. NO_CHANGE — if every requested field already matches the current
 *      shipment, nothing is written and no activity row is logged (a
 *      repeat sync of unchanged data must be a true no-op, see `isNoChange`).
 *   2. Conflict detection — `Shipment.lastExternalSyncAt` is stamped only
 *      by THIS handler's own successful writes; if some OTHER channel
 *      (manual UI, bulk action) touched the shipment more recently than
 *      that stamp, the row is flagged `ImportRowNeedsReviewError` instead
 *      of blindly overwritten, surfacing on the existing Needs Review
 *      screen exactly like Store Orders' phone-match case.
 *   3. Tracking Number is required to reach DELIVERED (spec section 8's
 *      worked example) unless the current shipment already has one.
 *
 * The determined action is logged on the order's own activity timeline
 * (`IMPORT_<ACTION>`, tagged with a `StoreOrderActivitySource` so the audit
 * trail can tell manual/bulk/import/sheets apart — spec section 28).
 */
@Injectable()
export class ShippingUpdatesImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'SHIPPING_UPDATES';
  readonly labelKey = 'importCenter.types.shippingUpdates.label';
  readonly descriptionKey = 'importCenter.types.shippingUpdates.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly resultColumns = [...SHIPPING_RESULT_COLUMN_NAMES];

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentsService: StoreOrderShipmentsService,
    private readonly activityService: StoreOrderActivityService,
    private readonly registry: ImportTypeRegistryService,
    private readonly referenceData: ReferenceDataRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
    void this.refreshStatusOptions();
  }

  private async refreshStatusOptions() {
    const statuses = await this.prisma.shippingStatus.findMany({
      where: { deletedAt: null, isImportable: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true },
    });
    const field = this.fields.find((item) => item.key === 'status');
    if (field) field.options = statuses.map((status) => status.name);
  }

  private async resolveCatalogStatus(raw: string | undefined) {
    const statuses = await this.prisma.shippingStatus.findMany({
      where: { deletedAt: null },
    });
    const matched = matchShippingStatusRecord(statuses, raw, true);
    if (!matched) {
      const labels = statuses
        .filter((status) => status.isImportable)
        .map((status) => status.name);
      throw new BadRequestException(
        `حالة الشحن غير معرّفة. القيم المسموحة: ${labels.join('، ') || '—'}.`,
      );
    }
    return matched;
  }

  /** Performance (spec section 21) — one batched `findMany` for the whole file/sheet instead of one `findFirst` per row. */
  async preloadRows(rows: Record<string, string>[]): Promise<void> {
    const cache = getReferenceCache();
    if (!cache) return;
    const systemOrderIds = [
      ...new Set(
        rows
          .map((row) => row.systemOrderId?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const externalOrderIds = [
      ...new Set(
        rows
          .map((row) => normalizeExternalOrderId(row.externalOrderId))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const orders =
      systemOrderIds.length || externalOrderIds.length
        ? await this.prisma.storeOrder.findMany({
            where: {
              deletedAt: null,
              OR: [
                ...(systemOrderIds.length
                  ? [{ internalOrderId: { in: systemOrderIds } }]
                  : []),
                ...(externalOrderIds.length
                  ? [{ externalOrderId: { in: externalOrderIds } }]
                  : []),
              ],
            },
          })
        : [];
    const byInternalId = new Map(
      orders.map((order) => [order.internalOrderId, order]),
    );
    const byExternalId = new Map(
      orders
        .filter((order) => order.externalOrderId)
        .map((order) => [order.externalOrderId as string, order]),
    );
    cache.set(STORE_ORDER_BY_INTERNAL_ID_CACHE_KEY, byInternalId);
    cache.set(STORE_ORDER_CACHE_KEY, byExternalId);
  }

  private async findByInternalId(
    internalOrderId: string,
  ): Promise<StoreOrder | null> {
    const cache = getReferenceCache();
    const cached = cache?.get(STORE_ORDER_BY_INTERNAL_ID_CACHE_KEY) as
      Map<string, StoreOrder> | undefined;
    if (cached) return cached.get(internalOrderId) ?? null;
    // No preload happened (e.g. a direct call outside ImportJobsService,
    // like a unit test) — fall back to a live, correct-either-way query.
    return this.prisma.storeOrder.findFirst({
      where: { internalOrderId, deletedAt: null },
    });
  }

  private async findByExternalId(
    externalOrderId: string,
  ): Promise<StoreOrder | null> {
    const normalized = normalizeExternalOrderId(externalOrderId);
    if (!normalized) return null;
    const cache = getReferenceCache();
    const cached = cache?.get(STORE_ORDER_CACHE_KEY) as
      Map<string, StoreOrder> | undefined;
    if (cached) return cached.get(normalized) ?? null;
    return this.prisma.storeOrder.findFirst({
      where: { externalOrderId: normalized, deletedAt: null },
    });
  }

  /**
   * Required Resolution Flow (Shipping Sync urgent fix):
   *   1. System Order ID (column R) present -> resolve by it EXCLUSIVELY.
   *      Found: use it, never touch External Order ID. Not found: a clear
   *      Arabic error, no order created, no fallback to External Order ID.
   *   2. System Order ID absent -> fall back to normalized External Order ID.
   *   3. Neither present -> a clear Arabic "no usable identifier" error.
   */
  private async resolveOrder(row: Record<string, string>): Promise<StoreOrder> {
    const systemOrderId = row.systemOrderId?.trim();
    if (systemOrderId) {
      const order = await this.findByInternalId(systemOrderId);
      if (order) return order;
      throw new BadRequestException({
        code: 'SYSTEM_ORDER_ID_NOT_FOUND',
        message: systemOrderIdNotFoundMessage(systemOrderId),
      });
    }

    const externalOrderId = row.externalOrderId?.trim();
    if (externalOrderId) {
      const order = await this.findByExternalId(externalOrderId);
      if (order) return order;
      throw new BadRequestException({
        code: 'NOT_FOUND',
        message: `لا يوجد طلب متجر لرقم الطلب الخارجي «${externalOrderId}».`,
      });
    }

    throw new BadRequestException({
      code: 'MISSING_IDENTIFIER',
      message: NO_USABLE_IDENTIFIER_MESSAGE,
    });
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const order = await this.resolveOrder(row);

    const catalogStatus = await this.resolveCatalogStatus(row.status);

    const shippingCompanyId = await this.referenceData.resolveOptional(
      'SHIPPING_COMPANY',
      'name',
      row.shippingCompanyName,
      'Shipping Company',
    );

    const current = await this.shipmentsService.getCurrent(order.id);

    // Conflict detection (spec section 26) — a manual/bulk change since our
    // own last successful sync always wins a human's attention, never a
    // silent overwrite.
    if (
      current?.lastExternalSyncAt &&
      current.updatedAt > current.lastExternalSyncAt
    ) {
      throw new ImportRowNeedsReviewError(CONFLICT_MESSAGE);
    }

    const trackingNumber = row.trackingNumber?.trim() || undefined;
    if (
      catalogStatus.code === ShipmentStatus.DELIVERED &&
      !trackingNumber &&
      !current?.trackingNumber
    ) {
      throw new BadRequestException(TRACKING_REQUIRED_MESSAGE);
    }

    const labelUrl = row.labelUrl?.trim() || undefined;
    if (labelUrl) assertValidUrl(labelUrl);
    const notes = row.notes?.trim() || undefined;
    if (
      current &&
      this.isNoChange(
        current,
        catalogStatus,
        trackingNumber,
        shippingCompanyId,
        labelUrl,
        notes,
      )
    ) {
      return { id: current.id, noChange: true };
    }

    if (options?.dryRun) return { id: 'dry-run' };

    const source =
      options?.context?.source === 'GOOGLE_SHEETS'
        ? StoreOrderActivitySource.GOOGLE_SHEETS
        : StoreOrderActivitySource.IMPORT;
    return this.applyUpdate(
      order,
      current,
      catalogStatus,
      trackingNumber,
      shippingCompanyId,
      labelUrl,
      notes,
      userId,
      source,
    );
  }

  /**
   * Called only after a human confirms a conflict-flagged row on the Needs
   * Review screen — never re-checks the conflict (the confirm IS the
   * answer), always writes for real, exactly like `importRow` without
   * `dryRun`.
   */
  async resolveNeedsReview(
    row: Record<string, string>,
    userId?: string,
  ): Promise<ImportRowResult> {
    const order = await this.resolveOrder(row);
    const catalogStatus = await this.resolveCatalogStatus(row.status);
    const shippingCompanyId = await this.referenceData.resolveOptional(
      'SHIPPING_COMPANY',
      'name',
      row.shippingCompanyName,
      'Shipping Company',
    );
    const current = await this.shipmentsService.getCurrent(order.id);
    const trackingNumber = row.trackingNumber?.trim() || undefined;
    const labelUrl = row.labelUrl?.trim() || undefined;
    if (labelUrl) assertValidUrl(labelUrl);
    const notes = row.notes?.trim() || undefined;

    return this.applyUpdate(
      order,
      current,
      catalogStatus,
      trackingNumber,
      shippingCompanyId,
      labelUrl,
      notes,
      userId,
      StoreOrderActivitySource.GOOGLE_SHEETS,
    );
  }

  /** Idempotency (spec section 15) — every requested field that was actually provided already matches; applying the update would be a pure no-op. */
  private isNoChange(
    current: {
      status: ShipmentStatus | null;
      shippingStatusId?: string | null;
      trackingNumber: string | null;
      shippingCompanyId: string | null;
      labelUrl: string | null;
      notes: string | null;
    },
    catalogStatus: { id: string; code: string },
    trackingNumber: string | undefined,
    shippingCompanyId: string | undefined,
    labelUrl: string | undefined,
    notes: string | undefined,
  ): boolean {
    if (
      current.shippingStatusId &&
      current.shippingStatusId !== catalogStatus.id
    ) {
      return false;
    }
    if (!current.shippingStatusId && current.status !== catalogStatus.code) {
      return false;
    }
    if (trackingNumber && trackingNumber !== current.trackingNumber)
      return false;
    if (shippingCompanyId && shippingCompanyId !== current.shippingCompanyId) {
      return false;
    }
    if (labelUrl && labelUrl !== current.labelUrl) return false;
    if (notes && notes !== current.notes) return false;
    return true;
  }

  private async applyUpdate(
    order: { id: string },
    current: { id: string; status: ShipmentStatus | null } | null,
    catalogStatus: { id: string; code: string; name: string },
    trackingNumber: string | undefined,
    shippingCompanyId: string | undefined,
    labelUrl: string | undefined,
    notes: string | undefined,
    userId: string | undefined,
    source: StoreOrderActivitySource,
  ): Promise<ImportRowResult> {
    const operational = isOperationalShipmentStatus(catalogStatus.code)
      ? catalogStatus.code
      : null;
    if (
      operational === ShipmentStatus.NEEDS_RESHIPMENT &&
      current?.status !== ShipmentStatus.DELIVERY_FAILED
    ) {
      throw new BadRequestException(INVALID_RESHIP_TRANSITION_MESSAGE);
    }
    const isTerminalAwaitingReship =
      !!current &&
      (current.status === ShipmentStatus.DELIVERY_FAILED ||
        current.status === ShipmentStatus.NEEDS_RESHIPMENT);
    const action: 'CREATE_SHIPMENT' | 'UPDATE_SHIPMENT' | 'RESHIP' = !current
      ? 'CREATE_SHIPMENT'
      : operational &&
          isTerminalAwaitingReship &&
          RESHIP_TRIGGER_STATUSES.includes(operational)
        ? 'RESHIP'
        : 'UPDATE_SHIPMENT';

    const shipment = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (action === 'RESHIP') {
          if (current!.status === ShipmentStatus.DELIVERY_FAILED) {
            await this.shipmentsService.markNeedsReshipment(order.id, tx);
          }
          await this.shipmentsService.createReshipment(order.id, tx);
        }
        let updated = await this.shipmentsService.applyCatalogStatus(
          order.id,
          catalogStatus.id,
          catalogStatus.code,
          tx,
        );
        if (shippingCompanyId) {
          updated = await tx.shipment.update({
            where: { id: updated.id },
            data: { shippingCompanyId },
          });
        }
        if (trackingNumber) {
          updated = await tx.shipment.update({
            where: { id: updated.id },
            data: { trackingNumber },
          });
        }
        if (labelUrl) {
          updated = await tx.shipment.update({
            where: { id: updated.id },
            data: { labelUrl },
          });
        }
        if (notes) {
          updated = await tx.shipment.update({
            where: { id: updated.id },
            data: { notes },
          });
        }
        // Stamped last, unconditionally — this is what conflict detection on
        // the NEXT sync/import run compares `Shipment.updatedAt` against.
        // Both fields are set to the SAME captured instant explicitly:
        // leaving `updatedAt` to Prisma's own `@updatedAt` auto-stamp would
        // compute it a moment after `lastExternalSyncAt`'s `new Date()`,
        // making updatedAt > lastExternalSyncAt true even for this own
        // write and falsely flagging every subsequent sync as a conflict.
        const syncedAt = new Date();
        updated = await tx.shipment.update({
          where: { id: updated.id },
          data: { lastExternalSyncAt: syncedAt, updatedAt: syncedAt },
        });

        await this.activityService.log(
          order.id,
          `IMPORT_${action}`,
          `Shipping update synced (${action}): status set to ${catalogStatus.name}`,
          userId,
          tx,
          source,
        );

        return updated;
      },
    );

    return { id: shipment.id };
  }
}

function assertValidUrl(value: string) {
  try {
    new URL(value);
  } catch {
    throw new BadRequestException(`"${value}" is not a valid URL.`);
  }
}
