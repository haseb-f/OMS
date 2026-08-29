import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PaymentStatus,
  StoreOrderPaymentStatus,
  StoreOrderShippingStage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowStatusResolverService } from '../workflow/workflow-status-resolver.service';
import { PAID_PAYMENT_CODES } from '../workflow/workflow-status-map';

/**
 * Keeps Store Order payment + fulfillment StatusDefinitions in sync with
 * verified Payment allocations. Dual-writes legacy enums during cutover.
 */
@Injectable()
export class StoreOrderPaymentSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusResolver: WorkflowStatusResolverService,
  ) {}

  async recompute(storeOrderId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const order = await client.storeOrder.findUnique({
      where: { id: storeOrderId },
      include: {
        items: { select: { quantity: true, unitPrice: true } },
        shipments: {
          where: { deletedAt: null },
          select: { id: true },
          take: 1,
        },
        paymentStatusDef: { select: { code: true } },
      },
    });
    if (!order) return;

    const orderTotal = order.items.reduce(
      (sum, item) => sum + item.quantity * Number(item.unitPrice),
      0,
    );
    const verified = await client.payment.aggregate({
      where: {
        storeOrderId,
        status: PaymentStatus.VERIFIED,
        deletedAt: null,
      },
      _sum: { amount: true },
    });
    const verifiedTotal = Number(verified._sum.amount ?? 0);

    // Preserve manual PAYMENT_REVIEW / UNMATCHED until real verified money arrives.
    const currentCode = order.paymentStatusDef?.code;
    if (
      verifiedTotal <= 0 &&
      (currentCode === 'PAYMENT_REPORTED' || currentCode === 'UNMATCHED')
    ) {
      return;
    }

    let paymentStatus: StoreOrderPaymentStatus;
    if (verifiedTotal <= 0) {
      paymentStatus = StoreOrderPaymentStatus.PAYMENT_PENDING;
    } else if (verifiedTotal < orderTotal) {
      paymentStatus = StoreOrderPaymentStatus.PARTIALLY_PAID;
    } else if (verifiedTotal === orderTotal) {
      paymentStatus = StoreOrderPaymentStatus.FULLY_PAID_RECONCILED;
    } else {
      paymentStatus = StoreOrderPaymentStatus.OVERPAID;
    }

    const paymentStatusId = this.statusResolver.paymentStatusId(paymentStatus);
    const data: Prisma.StoreOrderUpdateInput = {
      paymentStatus,
      paymentStatusDef: { connect: { id: paymentStatusId } },
    };

    if (
      PAID_PAYMENT_CODES.has(
        paymentStatus === StoreOrderPaymentStatus.FULLY_PAID_RECONCILED
          ? 'PAID'
          : paymentStatus === StoreOrderPaymentStatus.OVERPAID
            ? 'OVERPAID'
            : '',
      ) &&
      order.shippingStage === StoreOrderShippingStage.NOT_READY &&
      order.shipments.length === 0
    ) {
      data.shippingStage = StoreOrderShippingStage.READY_FOR_SHIPPING;
      data.fulfillmentStatus = {
        connect: {
          id: this.statusResolver.fulfillmentStatusId(
            StoreOrderShippingStage.READY_FOR_SHIPPING,
          ),
        },
      };
    }

    await client.storeOrder.update({ where: { id: storeOrderId }, data });
  }
}
