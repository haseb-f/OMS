import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  PaymentMatchStatus,
  PaymentOrigin,
  PaymentSettlementStatus,
  PaymentStatus,
  StoreOrderPaymentType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import {
  loadStoreOrderMoneyPosition,
  roundMoney,
  storeOrderReturnsWhere,
} from '../../financial-transactions/shared/store-order-money';
import { StoreOrderRefundsService } from '../../financial-transactions/refunds/store-order-refunds.service';

/** Claims that still stand but are not money yet. */
const OPEN_CLAIM_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.MATCHED,
];
/** A posted claim whose cash still sits with the provider / carrier. */
const UNSETTLED: PaymentSettlementStatus[] = [
  PaymentSettlementStatus.AWAITING_SETTLEMENT,
  PaymentSettlementStatus.PARTIALLY_SETTLED,
];

export type CodCollectionTracking =
  'TRACKED' | 'NOT_TRACKED' | 'NOT_APPLICABLE';

/** Why a VERIFIED payment cannot be reversed from the order (null = it can). */
export type ReverseBlock = 'MATCHED' | 'SETTLED' | 'AGENT_RECEIVED' | null;

export interface PaymentClaimView {
  status: PaymentStatus;
  origin: PaymentOrigin;
  amount: number;
  settlementStatus: PaymentSettlementStatus;
  settledAmount: number;
}

export interface CollectionBreakdown {
  /** Declarations / claims not verified yet — never money. */
  declared: number;
  /** Carrier COD collections expected from delivered parcels, not confirmed yet. */
  expectedFromCarrier: number;
  /** Verified carrier COD cash the carrier still holds (not remitted). */
  withCarrier: number;
  /** Verified provider cash not yet settled to the bank. */
  awaitingSettlement: number;
}

/**
 * Splits the order's claims into what was only declared / expected and
 * where verified money sits (pure, unit-tested). Verified cash not with the
 * carrier or a provider is in the bank.
 */
export function collectionBreakdown(
  claims: PaymentClaimView[],
): CollectionBreakdown {
  const sum = (
    rows: PaymentClaimView[],
    value: (row: PaymentClaimView) => number,
  ) => roundMoney(rows.reduce((total, row) => total + value(row), 0));
  const open = claims.filter((claim) =>
    OPEN_CLAIM_STATUSES.includes(claim.status),
  );
  const unsettled = claims.filter(
    (claim) =>
      claim.status === PaymentStatus.VERIFIED &&
      UNSETTLED.includes(claim.settlementStatus),
  );
  const carrier = (claim: PaymentClaimView) =>
    claim.origin === PaymentOrigin.CARRIER_COD;
  const outstanding = (claim: PaymentClaimView) =>
    Math.max(claim.amount - claim.settledAmount, 0);
  return {
    declared: sum(
      open.filter((claim) => !carrier(claim)),
      (row) => row.amount,
    ),
    expectedFromCarrier: sum(open.filter(carrier), (row) => row.amount),
    withCarrier: sum(unsettled.filter(carrier), outstanding),
    awaitingSettlement: sum(
      unsettled.filter((claim) => !carrier(claim)),
      outstanding,
    ),
  };
}

/** Reversal is refused while a statement match or a settlement stands on the claim. */
export function reverseBlockOf(payment: {
  destinationOwnership: string | null;
  activeMatches: number;
  settledAmount: number;
  settlementStatus: PaymentSettlementStatus;
}): ReverseBlock {
  if (payment.destinationOwnership === 'AGENT') return 'AGENT_RECEIVED';
  // Same order as `PaymentsService.reverse`: a settlement is undone first.
  if (
    payment.settledAmount > 0 ||
    payment.settlementStatus === PaymentSettlementStatus.SETTLED ||
    payment.settlementStatus === PaymentSettlementStatus.PARTIALLY_SETTLED
  ) {
    return 'SETTLED';
  }
  if (payment.activeMatches > 0) return 'MATCHED';
  return null;
}

/**
 * R15 (D15-9 … D15-12) — the order "Collection" panel: every money figure of
 * one store order from the ONE shared position (`loadStoreOrderMoneyPosition`,
 * the figures the refund caps enforce) plus the documents behind each figure
 * (claims, receipts, invoices per shipment, credit notes, refunds). Read
 * only; gated by the order's by-id sales scope (404, never 403).
 */
@Injectable()
export class StoreOrderMoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
    private readonly refunds: StoreOrderRefundsService,
  ) {}

  async panel(storeOrderId: string, userId: string) {
    // A cancelled (archived) order keeps its money position: an advance may
    // still be due back to the customer (D15-11).
    await this.salesScope.assertCanOpenStoreOrder(userId, storeOrderId, {
      includeArchived: true,
    });
    const position = await loadStoreOrderMoneyPosition(
      this.prisma,
      storeOrderId,
    );
    if (!position) {
      throw new NotFoundException(`Store Order ${storeOrderId} not found`);
    }
    const [order, payments, refundLines, refundable] = await Promise.all([
      this.prisma.storeOrder.findUniqueOrThrow({
        where: { id: storeOrderId },
        select: {
          paymentType: true,
          currency: { select: { id: true, code: true } },
          shipments: {
            where: { deletedAt: null },
            select: {
              id: true,
              attemptNumber: true,
              trackingNumber: true,
              status: true,
              shippingCompany: {
                select: {
                  name: true,
                  codPaymentMethod: {
                    select: { id: true, name: true, isActive: true },
                  },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: { storeOrderId, deletedAt: null },
        select: {
          id: true,
          paymentNumber: true,
          origin: true,
          status: true,
          amount: true,
          paymentDate: true,
          verifiedAt: true,
          settlementStatus: true,
          settledAmount: true,
          destinationOwnership: true,
          reversedAt: true,
          reversalReason: true,
          paymentMethod: { select: { id: true, name: true } },
          receiptLink: {
            select: {
              financialTransaction: {
                select: { id: true, transactionNumber: true, status: true },
              },
            },
          },
          _count: {
            select: {
              matches: { where: { status: PaymentMatchStatus.ACTIVE } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.financialTransactionAllocation.findMany({
        where: {
          transaction: {
            type: FinancialTransactionType.CUSTOMER_REFUND,
            status: FinancialTransactionStatus.CONFIRMED,
            deletedAt: null,
          },
          OR: [
            { storeOrderId },
            { salesReturn: storeOrderReturnsWhere(storeOrderId) },
          ],
        },
        select: {
          allocatedAmount: true,
          salesReturnId: true,
          transaction: {
            select: {
              id: true,
              transactionNumber: true,
              transactionDate: true,
              referenceNumber: true,
            },
          },
        },
      }),
      this.refunds.describe(position, this.prisma),
    ]);

    const claims = payments.map((payment) => ({
      status: payment.status,
      origin: payment.origin,
      amount: Number(payment.amount),
      settlementStatus: payment.settlementStatus,
      settledAmount: Number(payment.settledAmount),
    }));
    const breakdown = collectionBreakdown(claims);
    const inBank = Math.max(
      roundMoney(
        position.collected -
          breakdown.withCarrier -
          breakdown.awaitingSettlement,
      ),
      0,
    );

    const shipmentById = new Map(order.shipments.map((row) => [row.id, row]));
    const carrierShipment = [...order.shipments]
      .reverse()
      .find((row) => row.shippingCompany);
    const codMethod = carrierShipment?.shippingCompany?.codPaymentMethod;
    const codTracking: CodCollectionTracking =
      order.paymentType !== StoreOrderPaymentType.CASH_ON_DELIVERY ||
      position.agentId ||
      !carrierShipment
        ? 'NOT_APPLICABLE'
        : codMethod?.isActive
          ? 'TRACKED'
          : 'NOT_TRACKED';

    const refunds = new Map<
      string,
      {
        id: string;
        transactionNumber: string;
        transactionDate: Date;
        referenceNumber: string | null;
        amount: number;
        againstReturns: number;
      }
    >();
    for (const line of refundLines) {
      const row = refunds.get(line.transaction.id) ?? {
        ...line.transaction,
        amount: 0,
        againstReturns: 0,
      };
      const amount = Number(line.allocatedAmount);
      row.amount = roundMoney(row.amount + amount);
      if (line.salesReturnId) {
        row.againstReturns = roundMoney(row.againstReturns + amount);
      }
      refunds.set(line.transaction.id, row);
    }

    return {
      storeOrderId: position.storeOrderId,
      internalOrderId: position.internalOrderId,
      partnerId: position.partnerId,
      currency: order.currency,
      paymentType: order.paymentType,
      isAgentOrder: position.agentId !== null,
      cancelled: !position.active,
      figures: {
        payable: position.payable,
        declared: breakdown.declared,
        expectedFromCarrier: breakdown.expectedFromCarrier,
        collected: position.collected,
        withCarrier: breakdown.withCarrier,
        awaitingSettlement: breakdown.awaitingSettlement,
        inBank,
        invoiced: position.invoiced,
        credited: position.credited,
        refunded: position.refunded,
        balanceDue: position.balanceDue,
        refundDue: position.refundDue,
        refundable: refundable.refundable,
        customerCreditBalance: refundable.customerCreditBalance,
      },
      codCollection: {
        tracking: codTracking,
        carrierName: carrierShipment?.shippingCompany?.name ?? null,
        methodName:
          codTracking === 'TRACKED' ? (codMethod?.name ?? null) : null,
      },
      payments: payments.map((payment) => ({
        id: payment.id,
        paymentNumber: payment.paymentNumber,
        origin: payment.origin,
        status: payment.status,
        amount: Number(payment.amount),
        paymentDate: payment.paymentDate,
        verifiedAt: payment.verifiedAt,
        settlementStatus: payment.settlementStatus,
        settledAmount: Number(payment.settledAmount),
        method: payment.paymentMethod,
        reversedAt: payment.reversedAt,
        reversalReason: payment.reversalReason,
        receipt: payment.receiptLink?.financialTransaction ?? null,
        reverseBlock:
          payment.status === PaymentStatus.VERIFIED
            ? reverseBlockOf({
                destinationOwnership: payment.destinationOwnership,
                activeMatches: payment._count.matches,
                settledAmount: Number(payment.settledAmount),
                settlementStatus: payment.settlementStatus,
              })
            : null,
      })),
      invoices: position.invoices.map((invoice) => {
        const shipment = invoice.shipmentId
          ? shipmentById.get(invoice.shipmentId)
          : undefined;
        return {
          ...invoice,
          shipment: shipment
            ? {
                id: shipment.id,
                attemptNumber: shipment.attemptNumber,
                trackingNumber: shipment.trackingNumber,
              }
            : null,
        };
      }),
      returnCredits: position.returnCredits,
      refunds: [...refunds.values()].sort(
        (a, b) => a.transactionDate.getTime() - b.transactionDate.getTime(),
      ),
    };
  }
}
