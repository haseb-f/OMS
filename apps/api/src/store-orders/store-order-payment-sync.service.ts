import { Injectable } from '@nestjs/common';
import { Prisma, PaymentStatus, StoreOrderPaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowStatusResolverService } from '../workflow/workflow-status-resolver.service';
import { storeOrderItemsTotal } from './store-order-line-amount';
import { roundMoney } from './store-order-payment-settlement.util';

/**
 * Keeps Store Order payment StatusDefinitions in sync with verified Payment
 * allocations. Dual-writes legacy enums during cutover.
 *
 * Payment status is independent of fulfillment/shipping. Marking an order
 * Paid MUST NEVER advance shippingStage or fulfillmentStatus.
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
        items: {
          where: { deletedAt: null },
          select: { quantity: true, unitPrice: true, agreedAmount: true },
        },
        paymentStatusDef: { select: { code: true } },
      },
    });
    if (!order) return;

    const orderTotal = roundMoney(storeOrderItemsTotal(order.items));
    const verified = await client.payment.aggregate({
      where: {
        storeOrderId,
        status: PaymentStatus.VERIFIED,
        deletedAt: null,
      },
      _sum: { amount: true },
    });
    const verifiedTotal = roundMoney(Number(verified._sum.amount ?? 0));

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
    await client.storeOrder.update({
      where: { id: storeOrderId },
      data: {
        paymentStatus,
        paymentStatusDef: { connect: { id: paymentStatusId } },
      },
    });
  }
}
