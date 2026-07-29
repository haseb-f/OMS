import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ShipmentStatus, ShippingCostPayer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * One shipping attempt per row (decision #15/#5: reshipping creates a new
 * Shipment — unlimited attempts, numbered #1/#2/#3... via attemptNumber —
 * never a new SalesOrder). Operations that touch shipment-level data (Assign
 * Shipping Company, Add Tracking Number, Upload Shipping Label, Add Shipping
 * Cost) all act on "the current shipment" — the most recently created
 * Shipment for the order, created on demand if none exists yet. Create
 * Reshipment always creates a brand new one, which then becomes the current
 * one for anything that follows.
 */
@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(
    salesOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.shipment.findFirst({
      where: { salesOrderId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Returns the current shipment, creating one if none exists yet. Reports whether it was created. */
  async getOrCreateCurrent(
    salesOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    isReship = false,
  ) {
    const existing = await this.getCurrent(salesOrderId, tx);
    if (existing) {
      return { shipment: existing, created: false };
    }
    const shipment = await this.createShipment(salesOrderId, isReship, tx);
    return { shipment, created: true };
  }

  private async createShipment(
    salesOrderId: string,
    isReship: boolean,
    tx: Prisma.TransactionClient | PrismaService,
  ) {
    const previousCount = await tx.shipment.count({ where: { salesOrderId } });
    return tx.shipment.create({
      data: { salesOrderId, isReship, attemptNumber: previousCount + 1 },
    });
  }

  /** Decision #5: unlimited numbered attempts. Always creates a new row (#2, #3, ...). */
  async createReshipment(
    salesOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return this.createShipment(salesOrderId, true, tx);
  }

  async assignShippingCompany(
    salesOrderId: string,
    shippingCompanyId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const shippingCompany = await tx.shippingCompany.findFirst({
      where: { id: shippingCompanyId, deletedAt: null },
    });
    if (!shippingCompany) {
      throw new BadRequestException(
        'Shipping company not found or is not active.',
      );
    }

    const { shipment, created } = await this.getOrCreateCurrent(
      salesOrderId,
      tx,
    );
    const updated = await tx.shipment.update({
      where: { id: shipment.id },
      data: { shippingCompanyId },
    });
    return { shipment: updated, created };
  }

  async addTrackingNumber(
    salesOrderId: string,
    trackingNumber: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(salesOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { trackingNumber },
    });
  }

  /** Decision #2: Shipment stores the label itself, plus reaches LABEL_CREATED status. */
  async setLabel(
    salesOrderId: string,
    labelUrl: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(salesOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { labelUrl, status: ShipmentStatus.LABEL_CREATED },
    });
  }

  async markShipped(
    salesOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(salesOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.SHIPPED },
    });
  }

  async markDelivered(
    salesOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(salesOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.DELIVERED },
    });
  }

  /**
   * Decision #6: distinguishes before/after delivery, inferred from the
   * current shipment's own status at the moment of return (DELIVERED ->
   * after; anything else -> before) — not asked of the caller, since the
   * system already knows it.
   */
  async markReturned(
    salesOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(salesOrderId, tx);
    const returnStatus =
      shipment.status === ShipmentStatus.DELIVERED
        ? ShipmentStatus.RETURN_AFTER_DELIVERY
        : ShipmentStatus.RETURN_BEFORE_DELIVERY;
    const updated = await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: returnStatus },
    });
    return { shipment: updated, returnStatus };
  }

  async addShippingCost(
    salesOrderId: string,
    data: {
      baseShippingCost?: number;
      additionalShippingCost?: number;
      costPaidBy: ShippingCostPayer;
      notes?: string;
    },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { shipment } = await this.getOrCreateCurrent(salesOrderId, tx);
    return tx.shipment.update({
      where: { id: shipment.id },
      data: {
        baseShippingCost: data.baseShippingCost,
        additionalShippingCost: data.additionalShippingCost,
        costPaidBy: data.costPaidBy,
        notes: data.notes,
      },
    });
  }

  findAllForOrder(salesOrderId: string) {
    return this.prisma.shipment.findMany({
      where: { salesOrderId, deletedAt: null },
      orderBy: { attemptNumber: 'asc' },
    });
  }
}
