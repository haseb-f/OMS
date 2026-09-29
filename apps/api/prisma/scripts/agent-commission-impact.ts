import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { commissionOf } from '../../src/agents/commission/agent-commission';

/**
 * Read-only impact report of the commission policy correction
 * (specs/agents-fulfillment-partners/commission-policy.md A9). Never writes.
 *
 * For every earned agent order it shows how its commission was computed
 * (legacy single rate vs per-line), the carrier-cost treatment it was
 * submitted under, and — for legacy orders — what the agent's CURRENT
 * agreement defaults would give per line. A difference is informational:
 * the correction plan is a reasoned Finance ADJUSTMENT per order, never an
 * edit of posted entries.
 *
 * Usage: pnpm --filter ./apps/api exec ts-node prisma/scripts/agent-commission-impact.ts
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const round2 = (value: number) => Math.round(value * 100) / 100;

async function main() {
  const today = new Date();
  const orders = await prisma.storeOrder.findMany({
    where: { agentId: { not: null }, agentEarnedAt: { not: null } },
    orderBy: { agentEarnedAt: 'asc' },
    select: {
      id: true,
      internalOrderId: true,
      agentId: true,
      agentTermsSnapshot: true,
      shippingCharge: true,
      agent: { select: { agentNumber: true, name: true } },
      items: {
        where: { deletedAt: null },
        select: {
          productId: true,
          agreedAmount: true,
          product: { select: { sku: true, itemType: true } },
        },
      },
    },
  });
  const rows: Array<Record<string, string | number | null>> = [];
  for (const order of orders) {
    const snapshot = (order.agentTermsSnapshot ?? {}) as {
      commissionRatePercent?: number;
      productCommissionRatePercent?: number;
      shippingPolicy?: string;
      shippingFeePerShipment?: number;
    };
    const entries = await prisma.agentLedgerEntry.findMany({
      where: { storeOrderId: order.id },
      select: {
        id: true,
        entryType: true,
        debit: true,
        credit: true,
        postingStatus: true,
      },
    });
    const commission = entries.find((e) => e.entryType === 'COMMISSION');
    const lineCount = commission
      ? await prisma.agentCommissionLine.count({
          where: { ledgerEntryId: commission.id },
        })
      : 0;
    const legacy = snapshot.productCommissionRatePercent == null;
    const flatFees = entries
      .filter((e) => e.entryType === 'SHIPPING_FEE')
      .reduce((s, e) => s + Number(e.debit), 0);
    let correctedCommission: number | null = null;
    if (legacy) {
      const agreement = await prisma.agentAgreement.findFirst({
        where: {
          agentId: order.agentId!,
          status: { in: ['ACTIVE', 'ENDED'] },
          activatedAt: { not: null },
          effectiveFrom: { lte: today },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (agreement) {
        correctedCommission = round2(
          order.items.reduce((sum, item) => {
            // Explicit item type only (A2); an unclassified item cannot be
            // re-rated and is listed for review below.
            if (!item.product.itemType) return Number.NaN;
            const rate =
              item.product.itemType === 'PRODUCT'
                ? Number(agreement.productCommissionRatePercent)
                : Number(agreement.serviceCommissionRatePercent);
            return sum + commissionOf(Number(item.agreedAmount), rate);
          }, 0),
        );
      }
    }
    const recorded = commission ? Number(commission.debit) : 0;
    rows.push({
      agent: order.agent?.agentNumber ?? null,
      order: order.internalOrderId,
      interpretation: legacy ? 'LEGACY_SINGLE_RATE' : 'PER_LINE',
      legacyRate: snapshot.commissionRatePercent ?? null,
      commissionRecorded: recorded,
      perLineDetail: lineCount,
      postingStatus: commission?.postingStatus ?? null,
      correctedUnderCurrentAgreement: correctedCommission,
      difference:
        correctedCommission == null
          ? null
          : round2(correctedCommission - recorded),
      shippingPolicy:
        snapshot.shippingPolicy ?? 'FLAT_FEE_PER_SHIPMENT (legacy)',
      flatShippingFees: round2(flatFees),
      customerShippingOwner:
        (snapshot as { customerShippingChargeOwner?: string })
          .customerShippingChargeOwner ?? null,
      shippingRetained: round2(
        entries
          .filter((e) => e.entryType === 'CUSTOMER_SHIPPING_RETAINED')
          .reduce((s, e) => s + Number(e.debit), 0),
      ),
      /** Under the corrected model the company retains the customer shipping and charges no flat fee. */
      correctedShippingDelta: round2(
        Number(order.shippingCharge ?? 0) -
          entries
            .filter((e) => e.entryType === 'CUSTOMER_SHIPPING_RETAINED')
            .reduce((s, e) => s + Number(e.debit), 0) -
          flatFees,
      ),
    });
  }
  console.table(rows);
  const unclassified = await prisma.product.findMany({
    where: { deletedAt: null, itemType: null },
    select: {
      sku: true,
      name: true,
      type: true,
      isInventoryItem: true,
      ownerAgentId: true,
    },
    orderBy: { sku: 'asc' },
  });
  console.log(
    `Items without an item type (review — A2): ${unclassified.length}`,
  );
  if (unclassified.length) console.table(unclassified);
  const legacyRows = rows.filter(
    (r) => r.interpretation === 'LEGACY_SINGLE_RATE',
  );
  const posted = rows.filter((r) => r.postingStatus === 'POSTED').length;
  console.log(
    JSON.stringify(
      {
        earnedAgentOrders: rows.length,
        legacyInterpretation: legacyRows.length,
        commissionEntriesPostedToGl: posted,
        ordersWithNonZeroDifference: legacyRows.filter(
          (r) => r.difference != null && r.difference !== 0,
        ).length,
        ordersWithShippingDelta: rows.filter(
          (r) => r.correctedShippingDelta !== 0,
        ).length,
        unclassifiedItems: unclassified.length,
        correctionPlan:
          'No automatic change. If the owner applies the corrected terms retroactively, Finance records one reasoned ADJUSTMENT per listed order for the difference (never an edit of the original entry).',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
