import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreOrderShipmentsService } from '../../store-orders/shipments/store-order-shipments.service';
import { StoreOrderActivityService } from '../../store-orders/activities/store-order-activity.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

/** The 6 usable Store Order ShipmentStatus values — the two legacy RETURN_* values never appear in this handler's import surface (rule: "never use the two legacy RETURN_* values"). */
const ALLOWED_STATUSES: ShipmentStatus[] = [
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
 * Shipping Updates Import — looks the Store Order up by `externalOrderId`
 * ONLY (rule 2: phone is never the Order key), then decides the action per
 * row (rule: pre/post-confirmation report by action type):
 *
 *   - no Shipment yet + a shippable status        -> CREATE_SHIPMENT
 *   - current Shipment is open + an update         -> UPDATE_SHIPMENT
 *   - current Shipment is DELIVERY_FAILED/
 *     NEEDS_RESHIPMENT + a fresh-attempt status     -> RESHIP (always a NEW
 *     Shipment row on the SAME Store Order — never a new StoreOrder,
 *     reusing `createReshipment`)
 *
 * The determined action is logged on the order's own activity timeline
 * (`IMPORT_<ACTION>`) so a per-job action-type breakdown can be reconstructed
 * from `StoreOrderActivity` after the fact; a dedicated aggregated
 * pre-confirmation breakdown endpoint was not built in this pass (see the
 * task's final summary) — the existing Import Center preview/validate
 * screen already reports per-row pass/fail counts, which is what "nothing
 * is imported until validation succeeds" needs.
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
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    if (!row.externalOrderId?.trim()) {
      throw new BadRequestException('External Order ID is required.');
    }
    const order = await this.prisma.storeOrder.findFirst({
      where: { externalOrderId: row.externalOrderId, deletedAt: null },
    });
    if (!order) {
      throw new BadRequestException(
        `No Store Order found for External Order ID "${row.externalOrderId}".`,
      );
    }

    const status = row.status?.trim().toUpperCase() as ShipmentStatus;
    if (!ALLOWED_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Status must be one of: ${ALLOWED_STATUSES.join(', ')}.`,
      );
    }

    let shippingCompanyId: string | undefined;
    if (row.shippingCompanyName?.trim()) {
      const shippingCompany = await this.prisma.shippingCompany.findFirst({
        where: {
          name: { equals: row.shippingCompanyName.trim(), mode: 'insensitive' },
          deletedAt: null,
        },
      });
      if (!shippingCompany) {
        throw new BadRequestException(
          `Shipping Company "${row.shippingCompanyName}" not found.`,
        );
      }
      shippingCompanyId = shippingCompany.id;
    }

    if (options?.dryRun) return { id: 'dry-run' };

    const current = await this.shipmentsService.getCurrent(order.id);
    const isTerminalAwaitingReship =
      !!current &&
      (current.status === ShipmentStatus.DELIVERY_FAILED ||
        current.status === ShipmentStatus.NEEDS_RESHIPMENT);
    const action: 'CREATE_SHIPMENT' | 'UPDATE_SHIPMENT' | 'RESHIP' = !current
      ? 'CREATE_SHIPMENT'
      : isTerminalAwaitingReship && RESHIP_TRIGGER_STATUSES.includes(status)
        ? 'RESHIP'
        : 'UPDATE_SHIPMENT';

    const shipment = await this.prisma.$transaction(async (tx) => {
      if (action === 'RESHIP') {
        if (current!.status === ShipmentStatus.DELIVERY_FAILED) {
          await this.shipmentsService.markNeedsReshipment(order.id, tx);
        }
        await this.shipmentsService.createReshipment(order.id, tx);
      }
      let updated = await this.shipmentsService.setStatus(order.id, status, tx);
      if (shippingCompanyId) {
        updated = await tx.shipment.update({
          where: { id: updated.id },
          data: { shippingCompanyId },
        });
      }
      if (row.trackingNumber?.trim()) {
        updated = await tx.shipment.update({
          where: { id: updated.id },
          data: { trackingNumber: row.trackingNumber.trim() },
        });
      }
      if (row.notes?.trim()) {
        updated = await tx.shipment.update({
          where: { id: updated.id },
          data: { notes: row.notes.trim() },
        });
      }

      await this.activityService.log(
        order.id,
        `IMPORT_${action}`,
        `Shipping update imported (${action}): status set to ${status}`,
        userId,
        tx,
      );

      return updated;
    });

    return { id: shipment.id };
  }
}
