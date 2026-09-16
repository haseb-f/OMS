import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../../sales/shared/sales-totals.util';
import type {
  CostState,
  OrderEconomics,
  OrderEconomicsItemLine,
  ShipmentAttemptCost,
} from './order-economics.types';

/**
 * ADR-0018 (Order Economics M2) — the one canonical, server-side
 * calculation of direct-cost Order profitability. Never computed a second
 * time client-side. Consumes M1's historical COGS (`SalesInvoiceItem.unitCost`,
 * the same snapshot Sales Returns already replay) and whatever
 * `Shipment.baseShippingCost`/`additionalShippingCost` already exist — it
 * does not calculate Packaging or Payment Transaction Fee, because no data
 * source for either exists anywhere in this schema yet; those stay
 * UNKNOWN, never fabricated as 0.
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

    const totalDirectCost = shippingCost; // packaging/payment fee are UNKNOWN — never added as 0
    const contributionProfit = round2(grossProductProfit - totalDirectCost);
    const contributionMarginPercent =
      netRevenue > 0 ? (contributionProfit / netRevenue) * 100 : null;

    // Packaging and Payment Fee have no data source anywhere in this schema
    // yet (ADR-0018) — the overall state can never read COMPLETE today,
    // which is correct: "unknown cost is not zero."
    const costState: CostState =
      cogsState === 'UNKNOWN' && shippingState === 'UNKNOWN'
        ? 'UNKNOWN'
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
      packagingState: 'UNKNOWN',
      paymentFeeState: 'UNKNOWN',
      totalDirectCost,
      contributionProfit,
      contributionMarginPercent,
      costState,
    };
  }
}
