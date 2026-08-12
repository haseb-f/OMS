import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShipmentStatus, ShippingCostPayer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  StoreOrderActivityService,
  StoreOrderActivitySource,
  StoreOrderActivityType,
} from '../activities/store-order-activity.service';
import { StoreOrderShipmentsService } from './store-order-shipments.service';

const MANUAL = StoreOrderActivitySource.MANUAL;

/**
 * Orchestrates one shipment mutation + its own named activity log entry in
 * a single transaction — the same role `SalesOrdersService` plays around
 * the legacy `ShipmentsService`, scoped here to just the shipment
 * operations since a Store Order has no order-level status column that
 * also needs updating on every shipment transition (only the
 * pre-shipment `shippingStage` gate, handled by `StoreOrderPaymentSyncService`).
 *
 * Every method takes a trailing, optional `source` (default `MANUAL`) —
 * the ONE place that distinguishes which channel (manual OMS UI, bulk
 * action, Google Sheets sync) drove a change for the audit trail (Data
 * Synchronization spec section 28). The underlying operation and
 * validation are identical regardless of `source` — it only tags the
 * resulting `StoreOrderActivity` row, never gates behavior.
 */
@Injectable()
export class StoreOrderShipmentOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentsService: StoreOrderShipmentsService,
    private readonly activityService: StoreOrderActivityService,
  ) {}

  private async assertOrderExists(storeOrderId: string) {
    const order = await this.prisma.storeOrder.findFirst({
      where: { id: storeOrderId, deletedAt: null },
    });
    if (!order) {
      throw new NotFoundException(`Store Order ${storeOrderId} not found`);
    }
    return order;
  }

  async assignShippingCompany(
    storeOrderId: string,
    shippingCompanyId: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const { shipment, created } =
        await this.shipmentsService.assignShippingCompany(
          storeOrderId,
          shippingCompanyId,
          tx,
        );
      if (created) {
        await this.activityService.log(
          storeOrderId,
          StoreOrderActivityType.SHIPMENT_CREATED,
          `Shipment #${shipment.attemptNumber} created`,
          userId,
          tx,
          source,
        );
      }
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.SHIPPING_COMPANY_ASSIGNED,
        'Shipping company assigned',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async addTrackingNumber(
    storeOrderId: string,
    trackingNumber: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.addTrackingNumber(
        storeOrderId,
        trackingNumber,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.TRACKING_UPDATED,
        `Tracking number updated: ${trackingNumber}`,
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async setLabel(
    storeOrderId: string,
    fileUrl: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.setLabel(
        storeOrderId,
        fileUrl,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.LABEL_CREATED,
        'Label Created',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async markShipped(
    storeOrderId: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.markShipped(
        storeOrderId,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.SHIPPED,
        'Marked Shipped',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async markOutForDelivery(
    storeOrderId: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.markOutForDelivery(
        storeOrderId,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.OUT_FOR_DELIVERY,
        'Marked Out For Delivery',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async markDelivered(
    storeOrderId: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.markDelivered(
        storeOrderId,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.DELIVERED,
        'Marked Delivered',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async markDeliveryFailed(
    storeOrderId: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.markDeliveryFailed(
        storeOrderId,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.DELIVERY_FAILED,
        'Marked Delivery Failed',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async markNeedsReshipment(
    storeOrderId: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.markNeedsReshipment(
        storeOrderId,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.DELIVERY_FAILED,
        'Flagged as needing reshipment',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async createReshipment(
    storeOrderId: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.createReshipment(
        storeOrderId,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.RESHIPPED,
        `Shipment #${shipment.attemptNumber} created (reship)`,
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async addShippingCost(
    storeOrderId: string,
    data: {
      baseShippingCost?: number;
      additionalShippingCost?: number;
      costPaidBy: ShippingCostPayer;
      notes?: string;
    },
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.addShippingCost(
        storeOrderId,
        data,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.SHIPPING_COST_ADDED,
        'Shipping cost added',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  async addNotes(
    storeOrderId: string,
    notes: string,
    userId?: string,
    source: StoreOrderActivitySource = MANUAL,
  ) {
    await this.assertOrderExists(storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.addNotes(
        storeOrderId,
        notes,
        tx,
      );
      await this.activityService.log(
        storeOrderId,
        StoreOrderActivityType.NOTE_ADDED,
        'Shipment note added',
        userId,
        tx,
        source,
      );
      return shipment;
    });
  }

  findAllForOrder(storeOrderId: string) {
    return this.shipmentsService.findAllForOrder(storeOrderId);
  }

  /**
   * Bulk status transition for the flat Shipping list page — reuses the
   * exact same single-item operation per row (so "the same validation as
   * the single-item endpoint" holds by construction), applied atomically
   * per row with partial success allowed. Only accepts targetStatus values
   * that need no extra input (LABEL_CREATED needs a label URL, and
   * reshipment creates a new row rather than "setting a status" — both stay
   * single-item-only operations). Tags every resulting activity row `BULK`.
   */
  private readonly BULK_TARGET_STATUSES: ShipmentStatus[] = [
    ShipmentStatus.SHIPPED,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.DELIVERY_FAILED,
    ShipmentStatus.NEEDS_RESHIPMENT,
  ];

  async bulkUpdateStatus(
    shipmentIds: string[],
    targetStatus: ShipmentStatus,
    userId?: string,
  ) {
    if (!this.BULK_TARGET_STATUSES.includes(targetStatus)) {
      throw new BadRequestException(
        `"${targetStatus}" cannot be set via bulk update — use the dedicated single-item operation instead.`,
      );
    }

    const results: { id: string; success: boolean; message?: string }[] = [];
    for (const shipmentId of shipmentIds) {
      try {
        const shipment = await this.prisma.shipment.findFirst({
          where: { id: shipmentId, deletedAt: null },
        });
        if (!shipment) {
          throw new Error('Shipment not found.');
        }
        if (!shipment.storeOrderId) {
          throw new Error('Not a Store Order shipment.');
        }
        const source = StoreOrderActivitySource.BULK;
        switch (targetStatus) {
          case ShipmentStatus.SHIPPED:
            await this.markShipped(shipment.storeOrderId, userId, source);
            break;
          case ShipmentStatus.OUT_FOR_DELIVERY:
            await this.markOutForDelivery(
              shipment.storeOrderId,
              userId,
              source,
            );
            break;
          case ShipmentStatus.DELIVERED:
            await this.markDelivered(shipment.storeOrderId, userId, source);
            break;
          case ShipmentStatus.DELIVERY_FAILED:
            await this.markDeliveryFailed(
              shipment.storeOrderId,
              userId,
              source,
            );
            break;
          case ShipmentStatus.NEEDS_RESHIPMENT:
            await this.markNeedsReshipment(
              shipment.storeOrderId,
              userId,
              source,
            );
            break;
          default:
            throw new Error(`Unsupported target status "${targetStatus}".`);
        }
        results.push({ id: shipmentId, success: true });
      } catch (error) {
        results.push({
          id: shipmentId,
          success: false,
          message: error instanceof Error ? error.message : 'Failed to update.',
        });
      }
    }
    return results;
  }
}
