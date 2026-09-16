import { InventoryValuationService } from './inventory-valuation.service';
import type { Prisma } from '@prisma/client';

/**
 * ADR-0017 (Cost Engine M1) acceptance scenario — deterministic moving
 * weighted-average coverage. Mocks a Prisma transaction client with mutable
 * in-memory state (current cost + on-hand quantity) rather than hitting a
 * real DB, since `InventoryValuationService` only ever touches
 * `Product`/`ProductCostSnapshot`/`ProductCostHistory` through the `tx` it's
 * handed — the same boundary every other unit-tested service in this repo
 * mocks at.
 */
describe('InventoryValuationService — moving weighted-average acceptance scenario', () => {
  const productId = 'product-1';

  function makeTx(initialQuantity: number) {
    let quantity = initialQuantity;
    let currentCost: number | null = null;

    const tx = {
      inventoryMovement: {
        aggregate: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ _sum: { quantity } })),
      },
      product: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ currentCost })),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: { currentCost: number } }) => {
            currentCost = data.currentCost;
            return Promise.resolve({});
          }),
      },
      productCostSnapshot: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      productCostHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;

    return {
      tx,
      setQuantity: (next: number) => {
        quantity = next;
      },
    };
  }

  it('walks the full ADR-0017 acceptance scenario to the exact expected values', async () => {
    const service = new InventoryValuationService({} as never);

    // Opening: 100 units @ 100 = 10,000 (simulated as the very first receipt).
    const opening = makeTx(0);
    opening.setQuantity(100);
    const step1 = await service.applyPurchaseReceipt(
      productId,
      100,
      100,
      opening.tx,
    );
    expect(step1.newCost).toBe(100);

    // Receive 100 units at base unit cost 110 (11,000 base) — qty now 200.
    const receipt = makeTx(100);
    Object.defineProperty(receipt.tx, 'product', {
      value: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currentCost: 100 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    receipt.setQuantity(200);
    const step2 = await service.applyPurchaseReceipt(
      productId,
      100,
      110,
      receipt.tx,
    );
    expect(step2.newCost).toBe(105); // (100*100 + 100*110) / 200

    // Inbound freight of 1,000 (VAT-exclusive — recoverable VAT is never
    // part of this call's `allocatedAmount`) capitalized via Landed Cost.
    const landed = makeTx(200);
    Object.defineProperty(landed.tx, 'product', {
      value: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currentCost: 105 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const step3 = await service.applyLandedCost(productId, 1000, landed.tx);
    expect(step3.newCost).toBe(110); // (105*200 + 1000) / 200
    expect(step3.onHandQuantity).toBe(200);

    // Sell 30 units — sales never move the average (getUnitCost only reads
    // Product.currentCost; a sale never calls applyPurchaseReceipt/applyLandedCost).
    const cogsUnitCost = step3.newCost;
    const cogs = 30 * cogsUnitCost;
    expect(cogs).toBe(3300);
    const qtyAfterSale = 200 - 30;
    expect(qtyAfterSale).toBe(170);
    expect(170 * cogsUnitCost).toBe(18700);

    // Later receive 100 units at a fully-landed unit cost of 130 — qty was
    // reduced by the sale (170), average was NOT (still 110).
    const laterReceipt = makeTx(170);
    Object.defineProperty(laterReceipt.tx, 'product', {
      value: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currentCost: 110 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    laterReceipt.setQuantity(270);
    const step4 = await service.applyPurchaseReceipt(
      productId,
      100,
      130,
      laterReceipt.tx,
    );
    expect(step4.newCost).toBeCloseTo(117.407407, 6); // (170*110 + 100*130) / 270

    // Historical COGS from the earlier sale must never be recalculated from
    // today's average — it stays exactly what it was when recognized.
    expect(cogs).toBe(3300);
  });

  it('never capitalizes landed cost into a zero on-hand balance', async () => {
    const service = new InventoryValuationService({} as never);
    const zeroStock = makeTx(0);
    Object.defineProperty(zeroStock.tx, 'product', {
      value: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currentCost: 110 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    await expect(
      service.applyLandedCost(productId, 500, zeroStock.tx),
    ).rejects.toThrow(/no on-hand quantity remains/);
  });
});
