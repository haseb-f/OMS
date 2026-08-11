import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PaymentStatus,
  StoreOrderPaymentStatus,
  StoreOrderShippingStage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Keeps `StoreOrder.paymentStatus` in sync with its Payments — called after
 * any Payment write that has `storeOrderId` set (Create, Match, Verify,
 * Reject). Lives in its own tiny, dependency-free service (not folded into
 * `StoreOrdersService`) so `PaymentsModule` can import just this one
 * recompute helper without creating a circular module dependency (Payments
 * never needs the rest of `StoreOrdersService`, and `StoreOrdersService`
 * never needs anything from Payments — it writes Payment rows directly).
 *
 * Sums VERIFIED payments against the order's item total:
 *   - none verified yet         -> PAYMENT_PENDING
 *   - verified < total          -> PARTIALLY_PAID
 *   - verified == total         -> FULLY_PAID_RECONCILED
 *   - verified > total          -> OVERPAID
 * `UNMATCHED`/`PAYMENT_REVIEW` are deliberately never produced here — see
 * `SetPaymentReviewStatusDto`'s doc comment; those are a manual operation so
 * this recompute never silently clobbers a human's review flag... except
 * that whenever it DOES run (a real Payment status change), the order's
 * true reconciliation state should win, so a later Verify/Reject still
 * moves the order out of a stale review state, same as it would for any of
 * the four automatic states.
 *
 * Also promotes `shippingStage` to READY_FOR_SHIPPING the moment the order
 * first reaches FULLY_PAID_RECONCILED, as long as no Shipment has been
 * created yet (rule: "Ready for Shipping... reached only after
 * paymentStatus = FULLY_PAID_RECONCILED, before any Shipment row exists").
 */
@Injectable()
export class StoreOrderPaymentSyncService {
  constructor(private readonly prisma: PrismaService) {}

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

    const data: Prisma.StoreOrderUpdateInput = { paymentStatus };
    if (
      paymentStatus === StoreOrderPaymentStatus.FULLY_PAID_RECONCILED &&
      order.shippingStage === StoreOrderShippingStage.NOT_READY &&
      order.shipments.length === 0
    ) {
      data.shippingStage = StoreOrderShippingStage.READY_FOR_SHIPPING;
    }

    await client.storeOrder.update({ where: { id: storeOrderId }, data });
  }
}
