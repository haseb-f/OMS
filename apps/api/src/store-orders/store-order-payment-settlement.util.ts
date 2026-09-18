import { BadRequestException } from '@nestjs/common';
import { PaymentStatus, Prisma, StoreOrderPaymentStatus } from '@prisma/client';
import { storeOrderItemsTotal } from './store-order-line-amount';

const OPEN_CLAIM_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.MATCHED,
  PaymentStatus.VERIFIED,
];

export interface StoreOrderSettlement {
  total: number;
  paid: number;
  claimed: number;
  outstanding: number;
  remainingToClaim: number;
  fullySettled: boolean;
  canAcceptPayment: boolean;
  paymentStatus: StoreOrderPaymentStatus;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function settlementFromTotals(input: {
  total: number;
  paid: number;
  claimed: number;
  paymentStatus: StoreOrderPaymentStatus;
}): StoreOrderSettlement {
  const total = roundMoney(input.total);
  const paid = roundMoney(input.paid);
  const claimed = roundMoney(input.claimed);
  const outstanding = Math.max(roundMoney(total - paid), 0);
  const remainingToClaim = Math.max(roundMoney(total - claimed), 0);
  const fullySettled = paid + 0.005 >= total && total > 0;
  return {
    total,
    paid,
    claimed,
    outstanding,
    remainingToClaim,
    fullySettled,
    canAcceptPayment: !fullySettled && remainingToClaim > 0.005,
    paymentStatus: input.paymentStatus,
  };
}

export function assertCanAcceptPayment(
  settlement: StoreOrderSettlement,
  amount: number,
): void {
  const roundedAmount = roundMoney(amount);
  if (roundedAmount <= 0) {
    throw new BadRequestException('Payment amount must be greater than zero.');
  }
  if (settlement.fullySettled) {
    throw new BadRequestException(
      'This document is fully paid and settled — another payment cannot be accepted.',
    );
  }
  if (roundedAmount > settlement.remainingToClaim + 0.005) {
    throw new BadRequestException(
      `Payment of ${roundedAmount.toFixed(2)} exceeds remaining ${settlement.remainingToClaim.toFixed(2)}.`,
    );
  }
}

export function assertCanVerifyPayment(
  settlement: StoreOrderSettlement,
  amount: number,
): void {
  const roundedAmount = roundMoney(amount);
  if (settlement.paid + roundedAmount > settlement.total + 0.005) {
    throw new BadRequestException(
      `Verifying ${roundedAmount.toFixed(2)} would overpay this document — only ${settlement.outstanding.toFixed(2)} remains.`,
    );
  }
}

export async function lockStoreOrderRow(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM store_orders
    WHERE id = ${storeOrderId}::uuid
    FOR UPDATE
  `;
}

export async function computeStoreOrderSettlement(
  client: Prisma.TransactionClient | Prisma.DefaultPrismaClient,
  storeOrderId: string,
  options?: { excludePaymentId?: string },
): Promise<StoreOrderSettlement> {
  const order = await client.storeOrder.findFirst({
    where: { id: storeOrderId, deletedAt: null },
    include: {
      items: {
        select: { quantity: true, unitPrice: true, agreedAmount: true },
      },
    },
  });
  if (!order) {
    throw new BadRequestException(`Store Order ${storeOrderId} not found.`);
  }

  const grouped = await client.payment.groupBy({
    by: ['status'],
    where: {
      storeOrderId,
      deletedAt: null,
      status: { in: OPEN_CLAIM_STATUSES },
      ...(options?.excludePaymentId
        ? { id: { not: options.excludePaymentId } }
        : {}),
    },
    _sum: { amount: true },
  });

  const amountFor = (status: PaymentStatus) =>
    Number(grouped.find((row) => row.status === status)?._sum.amount ?? 0);

  const paid = amountFor(PaymentStatus.VERIFIED);
  const claimed =
    paid + amountFor(PaymentStatus.PENDING) + amountFor(PaymentStatus.MATCHED);

  return settlementFromTotals({
    total: storeOrderItemsTotal(order.items),
    paid,
    claimed,
    paymentStatus: order.paymentStatus,
  });
}

export function serializeSettlement(settlement: StoreOrderSettlement) {
  return {
    total: settlement.total.toFixed(2),
    paid: settlement.paid.toFixed(2),
    outstanding: settlement.outstanding.toFixed(2),
    claimed: settlement.claimed.toFixed(2),
    remainingToClaim: settlement.remainingToClaim.toFixed(2),
    fullySettled: settlement.fullySettled,
    canAcceptPayment: settlement.canAcceptPayment,
    paymentStatus: settlement.paymentStatus,
  };
}
