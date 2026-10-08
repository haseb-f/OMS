import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentOrigin,
  PaymentStatus,
  StoreOrderPaymentType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { lockStoreOrderRow } from '../../store-orders/store-order-payment-settlement.util';
import {
  recomputeDeclaredPaymentStatus,
  resolvePaymentSourceId,
} from '../../store-orders/payment-declaration/payment-declaration.core';
import {
  POSTED_SALES_STATUSES,
  loadStoreOrderMoneyPosition,
  roundMoney,
} from '../../financial-transactions/shared/store-order-money';

/** Idempotency key of the expected collection of one delivered COD shipment. */
export function carrierCodKey(shipmentId: string): string {
  return `carrier-cod:${shipmentId}`;
}

export type CarrierCodOutcome =
  | { status: 'CREATED' | 'EXISTS'; paymentId: string; amount: number }
  | {
      status:
        | 'NOT_APPLICABLE'
        | 'NOT_TRACKED'
        | 'AWAITING_INVOICE'
        | 'NOTHING_DUE'
        | 'FAILED';
      reason: string;
    };

const EPSILON = 0.005;

/**
 * R15 (D15-9) — cash a carrier collects on delivery. Delivery never posts
 * cash: when a COD shipment is DELIVERED and its carrier has a COD collection
 * method, ONE pending `Payment` (origin CARRIER_COD, method = the carrier's)
 * records what the carrier is expected to collect — a claim, no journal.
 * The carrier's COD report then confirms it through the method's statement
 * matching (or Finance verification for a non-reconciled method): the
 * receipt debits the method's clearing account ("receivable from the
 * carrier") and credits the customer's AR; the carrier's remittance settles
 * clearing → bank through `PaymentSettlement`. One receipt per payment,
 * settlement only from clearing — the cash is never recognised twice.
 *
 * A carrier without a COD method is "not tracked": nothing is created and the
 * order says so (Finance records the payment when the carrier pays).
 *
 * The amount is the shipment's posted invoice (incl. VAT and service lines —
 * what the customer pays the carrier), capped by what the order still owes
 * net of standing claims. Without an invoice (recognition failed) nothing is
 * created yet (review L8): a guessed amount without VAT would be a wrong
 * expectation; `StoreOrderCollectionService.syncVerifiedPayments` — run when
 * the invoice is finally issued — records it then.
 */
@Injectable()
export class CarrierCodCollectionService {
  private readonly logger = new Logger(CarrierCodCollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  /**
   * Post-commit hook of the delivery paths (manual, bulk, direct status,
   * shipping import) — never throws, so a courier status is never lost.
   * Safe for every delivered shipment: prepaid, pickup, agent and
   * already-recorded shipments are skipped.
   */
  async onCodShipmentDelivered(
    shipmentId: string,
    userId?: string,
  ): Promise<CarrierCodOutcome> {
    try {
      return await this.recordExpectedCollection(shipmentId, userId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Carrier COD collection for shipment ${shipmentId} failed: ${reason}`,
      );
      return { status: 'FAILED', reason };
    }
  }

  /** The hook's work, throwing on unexpected failures (tests / callers that want them). */
  async recordExpectedCollection(
    shipmentId: string,
    userId?: string,
  ): Promise<CarrierCodOutcome> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        storeOrderId: true,
        deletedAt: true,
        trackingNumber: true,
        shippingCompany: {
          select: {
            name: true,
            codPaymentMethod: {
              select: { id: true, name: true, isActive: true, deletedAt: true },
            },
          },
        },
      },
    });
    if (!shipment || shipment.deletedAt || !shipment.storeOrderId) {
      return { status: 'NOT_APPLICABLE', reason: 'NO_STORE_ORDER_SHIPMENT' };
    }
    if (shipment.status !== 'DELIVERED') {
      return { status: 'NOT_APPLICABLE', reason: 'NOT_DELIVERED' };
    }
    const storeOrderId = shipment.storeOrderId;
    const key = carrierCodKey(shipment.id);

    return this.prisma.$transaction(
      async (tx) => {
        await lockStoreOrderRow(tx, storeOrderId);
        const existing = await tx.payment.findUnique({
          where: { idempotencyKey: key },
          select: { id: true, amount: true },
        });
        if (existing) {
          return {
            status: 'EXISTS' as const,
            paymentId: existing.id,
            amount: Number(existing.amount),
          };
        }
        const order = await tx.storeOrder.findUniqueOrThrow({
          where: { id: storeOrderId },
          select: {
            id: true,
            internalOrderId: true,
            paymentType: true,
            agentId: true,
            currencyId: true,
          },
        });
        if (order.paymentType !== StoreOrderPaymentType.CASH_ON_DELIVERY) {
          return { status: 'NOT_APPLICABLE' as const, reason: 'PREPAID' };
        }
        if (order.agentId) {
          // Agent orders' collections run through the agent destinations /
          // agent ledger, never this company-cash path.
          return { status: 'NOT_APPLICABLE' as const, reason: 'AGENT_ORDER' };
        }
        const method = shipment.shippingCompany?.codPaymentMethod;
        if (!method || !method.isActive || method.deletedAt) {
          return {
            status: 'NOT_TRACKED' as const,
            reason: 'CARRIER_HAS_NO_COD_METHOD',
          };
        }

        const invoice = await tx.salesInvoice.findFirst({
          where: {
            shipmentId: shipment.id,
            deletedAt: null,
            status: { in: POSTED_SALES_STATUSES },
          },
          select: { grandTotal: true },
        });
        if (!invoice) {
          return {
            status: 'AWAITING_INVOICE' as const,
            reason: 'NOT_INVOICED',
          };
        }
        const amount = roundMoney(
          Math.min(
            Number(invoice.grandTotal),
            await this.unclaimedBalance(tx, order.id),
          ),
        );
        if (amount <= EPSILON) {
          return { status: 'NOTHING_DUE' as const, reason: 'NOTHING_DUE' };
        }

        const paymentSourceId = await resolvePaymentSourceId(tx, {
          paymentMethodId: method.id,
        });
        const paymentNumber = await this.numberingEngine.generateNumber(
          'PAYMENT',
          undefined,
          tx,
        );
        const carrier = shipment.shippingCompany?.name ?? 'Carrier';
        const payment = await tx.payment.create({
          data: {
            paymentNumber,
            storeOrderId: order.id,
            paymentDate: new Date(),
            amount,
            currencyId: order.currencyId,
            paymentSourceId,
            paymentMethodId: method.id,
            receivingAccountId: null,
            origin: PaymentOrigin.CARRIER_COD,
            idempotencyKey: key,
            referenceNumber: shipment.trackingNumber ?? undefined,
            senderName: carrier,
            status: PaymentStatus.PENDING,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
        });
        const label = `${amount.toFixed(2)} expected from ${carrier} (cash on delivery) via ${method.name}`;
        await tx.paymentActivity.create({
          data: {
            paymentId: payment.id,
            type: 'CARRIER_COD_EXPECTED',
            description: `Carrier COD collection expected: ${label} — not cash until the carrier's collection is confirmed`,
            metadata: {
              shipmentId: shipment.id,
              paymentMethodId: method.id,
              idempotencyKey: key,
              userId: userId ?? null,
            },
          },
        });
        await tx.storeOrderActivity.create({
          data: {
            storeOrderId: order.id,
            action: 'CARRIER_COD_EXPECTED',
            details: `Payment ${paymentNumber}: ${label} (awaiting the carrier's COD report — no cash posted)`,
            performedById: userId ?? null,
          },
        });
        await recomputeDeclaredPaymentStatus(tx, order.id);
        return {
          status: 'CREATED' as const,
          paymentId: payment.id,
          amount,
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /**
   * What the order still owes that no standing claim covers yet: the money
   * position's balance due (invoiced incl. VAT, net of credit notes, minus
   * money collected and not refunded) minus pending / matched claims.
   */
  private async unclaimedBalance(
    tx: Parameters<typeof loadStoreOrderMoneyPosition>[0],
    storeOrderId: string,
  ): Promise<number> {
    const position = await loadStoreOrderMoneyPosition(tx, storeOrderId);
    const pending = await tx.payment.aggregate({
      where: {
        storeOrderId,
        deletedAt: null,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.MATCHED] },
      },
      _sum: { amount: true },
    });
    return roundMoney(
      (position?.balanceDue ?? 0) - Number(pending._sum.amount ?? 0),
    );
  }
}
