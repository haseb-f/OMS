import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../../sales/shared/sales-totals.util';
import type {
  CostState,
  OrderEconomics,
  OrderEconomicsItemLine,
  PaymentFeeLine,
  ShipmentAttemptCost,
} from './order-economics.types';

/**
 * ADR-0018 (Order Economics M2, extended M2.2) — the one canonical,
 * server-side calculation of direct-cost Order profitability. Never
 * computed a second time client-side. Consumes M1's historical COGS
 * (`SalesInvoiceItem.unitCost`, the same snapshot Sales Returns already
 * replay), `Shipment.baseShippingCost`/`additionalShippingCost`, per-Payment
 * fees (ACTUAL > ESTIMATED > UNKNOWN), and the immutable
 * `StoreOrderFulfillmentCost` snapshot — an UNKNOWN component is never
 * fabricated as 0.
 */
@Injectable()
export class OrderEconomicsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForStoreOrder(
    storeOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<OrderEconomics> {
    const order = await tx.storeOrder.findFirst({
      where: { id: storeOrderId, deletedAt: null },
      select: {
        id: true,
        items: {
          select: { productId: true, quantity: true, agreedAmount: true },
        },
        invoices: {
          where: { deletedAt: null },
          select: {
            items: { select: { productId: true, unitCost: true } },
          },
        },
        shipments: {
          select: {
            id: true,
            attemptNumber: true,
            status: true,
            baseShippingCost: true,
            additionalShippingCost: true,
          },
        },
        payments: {
          where: { deletedAt: null, status: { not: 'REJECTED' } },
          select: {
            id: true,
            amount: true,
            actualFeeAmount: true,
            paymentSource: {
              select: { feePercentage: true, feeFixedAmount: true },
            },
          },
        },
        fulfillmentCost: {
          select: { amount: true, source: true, ruleName: true },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Store Order ${storeOrderId} not found.`);
    }

    // Historical unit cost per product, from the Order's own generated
    // invoice(s) — never Product.currentCost. Kept once per product; a
    // product line split across more than one generated invoice is an edge
    // case this milestone does not need to disambiguate further.
    const unitCostByProduct = new Map<string, number | null>();
    for (const invoice of order.invoices) {
      for (const item of invoice.items) {
        const existing = unitCostByProduct.get(item.productId);
        if (existing == null) {
          unitCostByProduct.set(
            item.productId,
            item.unitCost != null ? Number(item.unitCost) : null,
          );
        }
      }
    }

    let netRevenue = 0;
    let cogs = 0;
    let anyCogsKnown = false;
    let anyCogsMissing = false;
    const items: OrderEconomicsItemLine[] = order.items.map((item) => {
      const lineRevenue = Number(item.agreedAmount);
      netRevenue += lineRevenue;
      const historicalUnitCost = unitCostByProduct.get(item.productId) ?? null;
      let lineCogs: number | null = null;
      if (historicalUnitCost != null) {
        lineCogs = historicalUnitCost * item.quantity;
        cogs += lineCogs;
        anyCogsKnown = true;
      } else {
        anyCogsMissing = true;
      }
      return {
        productId: item.productId,
        quantity: item.quantity,
        netRevenue: round2(lineRevenue),
        historicalUnitCost,
        cogs: lineCogs !== null ? round2(lineCogs) : null,
      };
    });
    const cogsState: CostState = !anyCogsKnown
      ? 'UNKNOWN'
      : anyCogsMissing
        ? 'PARTIAL'
        : 'COMPLETE';

    netRevenue = round2(netRevenue);
    cogs = round2(cogs);
    const grossProductProfit = round2(netRevenue - cogs);
    const grossMarginPercent =
      netRevenue > 0 ? (grossProductProfit / netRevenue) * 100 : null;

    // Every Shipment Attempt row for this Order counts — a failed attempt's
    // cost was still incurred, and a reshipment's new row never overwrites
    // the previous attempt's own cost.
    const shippingAttempts: ShipmentAttemptCost[] = order.shipments.map(
      (shipment) => {
        const base =
          shipment.baseShippingCost != null
            ? Number(shipment.baseShippingCost)
            : null;
        const additional =
          shipment.additionalShippingCost != null
            ? Number(shipment.additionalShippingCost)
            : null;
        const totalCost =
          base != null || additional != null
            ? (base ?? 0) + (additional ?? 0)
            : null;
        return {
          shipmentId: shipment.id,
          attemptNumber: shipment.attemptNumber,
          status: shipment.status,
          baseShippingCost: base,
          additionalShippingCost: additional,
          totalCost: totalCost !== null ? round2(totalCost) : null,
        };
      },
    );
    let shippingCost = 0;
    let anyShippingKnown = false;
    let anyShippingMissing = false;
    for (const attempt of shippingAttempts) {
      if (attempt.totalCost != null) {
        shippingCost += attempt.totalCost;
        anyShippingKnown = true;
      } else {
        anyShippingMissing = true;
      }
    }
    shippingCost = round2(shippingCost);
    const shippingState: CostState =
      shippingAttempts.length === 0 || !anyShippingKnown
        ? 'UNKNOWN'
        : anyShippingMissing
          ? 'PARTIAL'
          : 'COMPLETE';

    // Payment fee precedence (ADR-0018 M2.2): ACTUAL (Payment.actualFeeAmount,
    // once reconciled) > ESTIMATED (PaymentSource.feePercentage/feeFixedAmount)
    // > UNKNOWN. Rejected/deleted payments never happened, so they're
    // excluded at the query level, not just skipped here.
    const payments: PaymentFeeLine[] = order.payments.map((payment) => {
      const amount = Number(payment.amount);
      if (payment.actualFeeAmount != null) {
        return {
          paymentId: payment.id,
          amount: round2(amount),
          feeAmount: round2(Number(payment.actualFeeAmount)),
          feeSource: 'ACTUAL',
        };
      }
      const feePercentage =
        payment.paymentSource.feePercentage != null
          ? Number(payment.paymentSource.feePercentage)
          : null;
      const feeFixedAmount =
        payment.paymentSource.feeFixedAmount != null
          ? Number(payment.paymentSource.feeFixedAmount)
          : null;
      if (feePercentage != null || feeFixedAmount != null) {
        const estimatedFee =
          amount * ((feePercentage ?? 0) / 100) + (feeFixedAmount ?? 0);
        return {
          paymentId: payment.id,
          amount: round2(amount),
          feeAmount: round2(estimatedFee),
          feeSource: 'ESTIMATED',
        };
      }
      return {
        paymentId: payment.id,
        amount: round2(amount),
        feeAmount: null,
        feeSource: 'UNKNOWN',
      };
    });
    let paymentFeeCost = 0;
    let anyPaymentFeeKnown = false;
    let anyPaymentFeeMissing = false;
    for (const line of payments) {
      if (line.feeAmount != null) {
        paymentFeeCost += line.feeAmount;
        anyPaymentFeeKnown = true;
      } else {
        anyPaymentFeeMissing = true;
      }
    }
    paymentFeeCost = round2(paymentFeeCost);
    const paymentFeeState: CostState =
      payments.length === 0 || !anyPaymentFeeKnown
        ? 'UNKNOWN'
        : anyPaymentFeeMissing
          ? 'PARTIAL'
          : 'COMPLETE';

    // Fulfillment cost (ADR-0018 M2.2) — the immutable snapshot applied once
    // at invoice generation; absence means the Order hasn't been invoiced
    // yet or no active rule existed at that moment, never a real zero.
    const fulfillmentCost = order.fulfillmentCost
      ? round2(Number(order.fulfillmentCost.amount))
      : 0;
    const fulfillmentCostState: CostState = order.fulfillmentCost
      ? 'COMPLETE'
      : 'UNKNOWN';
    const fulfillmentCostSource = order.fulfillmentCost?.source ?? null;
    const fulfillmentCostRuleName = order.fulfillmentCost?.ruleName ?? null;

    const totalDirectCost = round2(
      shippingCost + paymentFeeCost + fulfillmentCost,
    ); // UNKNOWN components are never added as 0
    const contributionProfit = round2(grossProductProfit - totalDirectCost);
    const contributionMarginPercent =
      netRevenue > 0 ? (contributionProfit / netRevenue) * 100 : null;

    const componentStates = [
      cogsState,
      shippingState,
      paymentFeeState,
      fulfillmentCostState,
    ];
    const costState: CostState = componentStates.every(
      (state) => state === 'UNKNOWN',
    )
      ? 'UNKNOWN'
      : componentStates.every((state) => state === 'COMPLETE')
        ? 'COMPLETE'
        : 'PARTIAL';

    return {
      storeOrderId: order.id,
      netRevenue,
      items,
      cogs,
      cogsState,
      grossProductProfit,
      grossMarginPercent,
      shippingAttempts,
      shippingCost,
      shippingState,
      payments,
      paymentFeeCost,
      paymentFeeState,
      fulfillmentCost,
      fulfillmentCostState,
      fulfillmentCostSource,
      fulfillmentCostRuleName,
      totalDirectCost,
      contributionProfit,
      contributionMarginPercent,
      costState,
    };
  }
}
