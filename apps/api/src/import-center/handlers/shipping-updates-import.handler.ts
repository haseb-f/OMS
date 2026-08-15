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

/**
 * The 6 usable Store Order ShipmentStatus values — the two legacy RETURN_*
 * values never appear in this handler's import surface (rule: "never use
 * the two legacy RETURN_* values"). Exported so both the Excel Template's
 * `options` dropdown AND `ReferenceDataSourcesService`'s `SHIPPING_STATUS`
 * reference type (for the Google Sheets reference worksheet) read from
 * this ONE array — never a second, independently-maintained status list.
 */
export const ALLOWED_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.LABEL_CREATED,
  ShipmentStatus.SHIPPED,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.DELIVERY_FAILED,
  ShipmentStatus.NEEDS_RESHIPMENT,
];

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

const FIELDS: ImportFieldDef[] = [
  {
    key: 'externalOrderId',
    labelKey: 'importCenter.fields.externalOrderId',
    label: 'External Order ID',
    required: true,
    type: 'string',
    example: 'SH-100234',
  },
  {
    key: 'status',
    labelKey: 'importCenter.fields.shipmentStatus',
    label: 'Status',
    required: true,
    type: 'string',
    options: ALLOWED_STATUSES,
    referenceType: 'SHIPPING_STATUS',
    example: 'SHIPPED',
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
 * SHIPPING_UPDATES}` — see `SyncOrchestratorService`). Looks the Store
 * Order up by `externalOrderId` ONLY — never a spreadsheet row number,
 * never phone (rule 2) — then decides the action per row:
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentsService: StoreOrderShipmentsService,
    private readonly activityService: StoreOrderActivityService,
    private readonly registry: ImportTypeRegistryService,
    private readonly referenceData: ReferenceDataRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  /** Performance (spec section 21) — one batched `findMany` for the whole file/sheet instead of one `findFirst` per row. */
  async preloadRows(rows: Record<string, string>[]): Promise<void> {
    const cache = getReferenceCache();
    if (!cache) return;
    const externalOrderIds = [
      ...new Set(
        rows
          .map((row) => row.externalOrderId?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const orders = externalOrderIds.length
      ? await this.prisma.storeOrder.findMany({
          where: { externalOrderId: { in: externalOrderIds }, deletedAt: null },
        })
      : [];
    const byExternalId = new Map(
      orders
        .filter((order) => order.externalOrderId)
        .map((order) => [order.externalOrderId as string, order]),
    );
    cache.set(STORE_ORDER_CACHE_KEY, byExternalId);
  }

  private async findOrder(externalOrderId: string): Promise<StoreOrder | null> {
    const cache = getReferenceCache();
    const cached = cache?.get(STORE_ORDER_CACHE_KEY) as
      Map<string, StoreOrder> | undefined;
    if (cached) return cached.get(externalOrderId) ?? null;
    // No preload happened (e.g. a direct call outside ImportJobsService,
    // like a unit test) — fall back to a live, correct-either-way query.
    return this.prisma.storeOrder.findFirst({
      where: { externalOrderId, deletedAt: null },
    });
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    if (!row.externalOrderId?.trim()) {
      throw new BadRequestException('External Order ID is required.');
    }
    const order = await this.findOrder(row.externalOrderId.trim());
    if (!order) {
      throw new BadRequestException({
        code: 'NOT_FOUND',
        message: `No Store Order found for External Order ID "${row.externalOrderId}".`,
      });
    }

    const status = row.status?.trim().toUpperCase() as ShipmentStatus;
    if (!ALLOWED_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Status must be one of: ${ALLOWED_STATUSES.join(', ')}.`,
      );
    }

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
      status === ShipmentStatus.DELIVERED &&
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
        status,
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
      status,
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
    if (!row.externalOrderId?.trim()) {
      throw new BadRequestException('External Order ID is required.');
    }
    const order = await this.findOrder(row.externalOrderId.trim());
    if (!order) {
      throw new BadRequestException(
        `No Store Order found for External Order ID "${row.externalOrderId}".`,
      );
    }
    const status = row.status?.trim().toUpperCase() as ShipmentStatus;
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
      status,
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
      trackingNumber: string | null;
      shippingCompanyId: string | null;
      labelUrl: string | null;
      notes: string | null;
    },
    status: ShipmentStatus,
    trackingNumber: string | undefined,
    shippingCompanyId: string | undefined,
    labelUrl: string | undefined,
    notes: string | undefined,
  ): boolean {
    if (current.status !== status) return false;
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
    status: ShipmentStatus,
    trackingNumber: string | undefined,
    shippingCompanyId: string | undefined,
    labelUrl: string | undefined,
    notes: string | undefined,
    userId: string | undefined,
    source: StoreOrderActivitySource,
  ): Promise<ImportRowResult> {
    if (
      status === ShipmentStatus.NEEDS_RESHIPMENT &&
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
      : isTerminalAwaitingReship && RESHIP_TRIGGER_STATUSES.includes(status)
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
        let updated = await this.shipmentsService.setStatus(
          order.id,
          status,
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
          `Shipping update synced (${action}): status set to ${status}`,
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
