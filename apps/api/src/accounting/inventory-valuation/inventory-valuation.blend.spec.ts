import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  blendMovingAverage,
  InventoryValuationService,
  removeFromAverage,
  round2,
  round4,
  splitLandedCost,
} from './inventory-valuation.service';

/**
 * R13 — moving-average math at 4 dp, multi-line documents, landed-cost
 * capitalized/variance split and assembly output / reversal. Pure functions
 * are tested directly; the service is driven through a stateful fake `tx`
 * (current on-hand + stored cost) like the ADR-0017 scenario spec.
 */
describe('inventory valuation math (R13)', () => {
  const dec = (value: string | number) => new Prisma.Decimal(value);

  describe('pure helpers', () => {
    it('rounds unit costs to 4 dp and GL amounts to 2 dp, half up', () => {
      expect(round4('10.123456').toString()).toBe('10.1235');
      expect(round4('0.00005').toString()).toBe('0.0001');
      expect(round2('10.005').toString()).toBe('10.01');
      expect(round2('10.004').toString()).toBe('10');
    });

    it('blends existing stock and new units by value, never a float', () => {
      // 100 @ 100 + 100 @ 110 → 105
      expect(
        blendMovingAverage({
          onHandBefore: 100,
          previousCost: 100,
          addedQuantity: 100,
          addedValue: 11000,
        }).toString(),
      ).toBe('105');
      // nothing on hand before: the added units are the whole pool
      expect(
        blendMovingAverage({
          onHandBefore: 0,
          previousCost: 999,
          addedQuantity: 3,
          addedValue: '10',
        }).toString(),
      ).toBe('3.3333');
      // 0.1 + 0.2 style inputs stay exact
      expect(
        blendMovingAverage({
          onHandBefore: 1,
          previousCost: '0.1',
          addedQuantity: 1,
          addedValue: '0.2',
        }).toString(),
      ).toBe('0.15');
    });

    it('splits a landed cost into capitalized and variance (O ≥ Q, O < Q, O = 0)', () => {
      // all received units still in stock
      let split = splitLandedCost({
        allocatedAmount: 1000,
        allocatedQuantity: 100,
        onHand: 150,
      });
      expect(split.capitalized.toString()).toBe('1000');
      expect(split.variance.toString()).toBe('0');
      // 40 of the 100 received are still in stock → 40% capitalized
      split = splitLandedCost({
        allocatedAmount: 1000,
        allocatedQuantity: 100,
        onHand: 40,
      });
      expect(split.capitalized.toString()).toBe('400');
      expect(split.variance.toString()).toBe('600');
      // rounding: 100 × 1/3 → 33.33, the variance takes the remainder
      split = splitLandedCost({
        allocatedAmount: 100,
        allocatedQuantity: 3,
        onHand: 1,
      });
      expect(split.capitalized.toString()).toBe('33.33');
      expect(split.variance.toString()).toBe('66.67');
      // nothing left: everything is variance, no throw
      split = splitLandedCost({
        allocatedAmount: 250.5,
        allocatedQuantity: 10,
        onHand: 0,
      });
      expect(split.capitalized.toString()).toBe('0');
      expect(split.variance.toString()).toBe('250.5');
      split = splitLandedCost({
        allocatedAmount: 10,
        allocatedQuantity: 10,
        onHand: -2,
      });
      expect(split.capitalized.toString()).toBe('0');
    });

    it('rejects a landed-cost allocation without a positive quantity', () => {
      let caught: unknown;
      try {
        splitLandedCost({
          allocatedAmount: 10,
          allocatedQuantity: 0,
          onHand: 5,
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(
        (caught as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        code: 'LANDED_COST_QUANTITY_INVALID',
      });
    });

    it('removes units at their recorded value without moving the average of the rest', () => {
      // avg 40, 10 on hand; removing 2 units recorded at 40 each keeps 40
      expect(
        removeFromAverage({
          onHandBefore: 10,
          previousCost: 40,
          removedQuantity: 2,
          removedValue: 80,
        }).toString(),
      ).toBe('40');
      // the removed unit was cheaper than the average (30 vs 40) → the rest cost more
      expect(
        removeFromAverage({
          onHandBefore: 10,
          previousCost: 40,
          removedQuantity: 2,
          removedValue: 60,
        }).toString(),
      ).toBe('42.5');
      // nothing remains → keep the last average
      expect(
        removeFromAverage({
          onHandBefore: 2,
          previousCost: 40,
          removedQuantity: 2,
          removedValue: 80,
        }).toString(),
      ).toBe('40');
      // an impossible negative pool never produces a negative average
      expect(
        removeFromAverage({
          onHandBefore: 3,
          previousCost: 10,
          removedQuantity: 1,
          removedValue: 1000,
        }).toString(),
      ).toBe('10');
    });
  });

  describe('service on a stateful transaction', () => {
    const productId = 'p-1';

    function makeTx(state: { onHand: number; cost: string | null }) {
      const history: Record<string, unknown>[] = [];
      const tx = {
        inventoryMovement: {
          aggregate: jest.fn(() =>
            Promise.resolve({ _sum: { quantity: state.onHand } }),
          ),
        },
        product: {
          findUniqueOrThrow: jest.fn(() =>
            Promise.resolve({
              currentCost: state.cost === null ? null : dec(state.cost),
            }),
          ),
          update: jest.fn(
            ({ data }: { data: { currentCost: Prisma.Decimal } }) => {
              state.cost = data.currentCost.toString();
              return Promise.resolve({});
            },
          ),
        },
        productCostSnapshot: { upsert: jest.fn().mockResolvedValue({}) },
        productCostHistory: {
          create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
            history.push(data);
            return Promise.resolve({});
          }),
        },
      } as unknown as Prisma.TransactionClient;
      return { tx, history };
    }

    const service = new InventoryValuationService({} as never);

    it('two lines of the same product in ONE document blend against the on-hand BEFORE the document', async () => {
      // 10 @ 10 on hand; one invoice receives 10 @ 20 and 10 @ 30 of the same
      // product (movements are already posted: on-hand now 30).
      const state = { onHand: 30, cost: '10' };
      const { tx, history } = makeTx(state);
      const result = await service.applyPurchaseReceiptLines(
        productId,
        [
          { quantity: 10, unitCost: 20 },
          { quantity: 10, unitCost: 30 },
        ],
        tx,
      );
      // (10×10 + 10×20 + 10×30) / 30 = 20 — the old line-by-line blend on the
      // already-inflated on-hand gave a different, wrong figure.
      expect(result).toEqual({ previousCost: 10, newCost: 20 });
      expect(history).toHaveLength(1);

      // The legacy single-line call for the SECOND line alone shows the bug
      // the aggregate API removes: it assumes on-hand-before = 30 − 10.
      const legacy = makeTx({ onHand: 30, cost: '10' });
      const wrong = await service.applyPurchaseReceipt(
        productId,
        10,
        30,
        legacy.tx,
      );
      expect(wrong.newCost).toBe(16.6667); // (20×10 + 10×30)/30 — not 20
    });

    it('an explicit onHandBefore overrides the derived one', async () => {
      const state = { onHand: 999, cost: '10' };
      const { tx } = makeTx(state);
      const result = await service.applyPurchaseReceipt(
        productId,
        10,
        20,
        tx,
        undefined,
        10,
      );
      expect(result.newCost).toBe(15); // (10×10 + 10×20) / 20
    });

    it('sales-return lines of the same product use the same aggregate rule', async () => {
      const state = { onHand: 8, cost: '50' };
      const { tx } = makeTx(state);
      // 2 + 1 units come back at the original cost 40 and 37 (on-hand now 8, so 5 before)
      const result = await service.applyReturnToStockLines(
        productId,
        [
          { quantity: 2, unitCost: 40 },
          { quantity: 1, unitCost: 37 },
        ],
        tx,
      );
      // (5×50 + 2×40 + 1×37) / 8 = 45.875 → 45.875
      expect(result.newCost).toBe(45.875);
    });

    it('stores the average at 4 dp (no 2 dp rounding of the unit cost)', async () => {
      const state = { onHand: 3, cost: null };
      const { tx } = makeTx(state);
      const result = await service.applyPurchaseReceipt(
        productId,
        3,
        3.3333,
        tx,
      );
      expect(result.newCost).toBe(3.3333);
      expect(state.cost).toBe('3.3333');
    });

    it('landed cost with O ≥ Q capitalizes everything and raises the average by A / O', async () => {
      const state = { onHand: 200, cost: '105' };
      const { tx, history } = makeTx(state);
      const result = await service.applyLandedCost(productId, 1000, tx, 'u-1', {
        allocatedQuantity: 100,
        referenceId: 'lc-1',
      });
      expect(result).toMatchObject({
        capitalized: 1000,
        variance: 0,
        newCost: 110,
        onHandQuantity: 200,
      });
      expect(history[0]).toMatchObject({
        referenceType: 'LANDED_COST',
        referenceId: 'lc-1',
      });
    });

    it('landed cost with O < Q capitalizes only the units still in stock', async () => {
      // 100 received, 40 left: capitalized 400 over 40 units → +10 per unit
      const state = { onHand: 40, cost: '20' };
      const { tx } = makeTx(state);
      const result = await service.applyLandedCost(
        productId,
        1000,
        tx,
        undefined,
        {
          allocatedQuantity: 100,
        },
      );
      expect(result).toMatchObject({
        capitalized: 400,
        variance: 600,
        newCost: 30,
      });
    });

    it('legacy applyLandedCost (no quantity) still capitalizes into current stock', async () => {
      const state = { onHand: 200, cost: '105' };
      const { tx } = makeTx(state);
      const result = await service.applyLandedCost(productId, 1000, tx);
      expect(result.newCost).toBe(110);
      expect(result.variance).toBe(0);
    });

    it('assembly output blends the TOTAL value: A 2×10 + B 1×15 + direct 5 = 40 → FG +1 @ 40', async () => {
      const state = { onHand: 1, cost: null }; // output movement already posted
      const { tx, history } = makeTx(state);
      const result = await service.applyAssemblyOutput(tx, {
        productId,
        quantityReceived: 1,
        totalValue: 40,
        referenceId: 'asm-1',
        onHandBefore: 0,
        userId: 'u-1',
      });
      expect(result).toEqual({ previousCost: 0, newCost: 40, unitCost: 40 });
      expect(history[0]).toMatchObject({
        referenceType: 'ASSEMBLY_ORDER',
        referenceId: 'asm-1',
      });
    });

    it('assembly output into existing stock keeps the value exact', async () => {
      // 4 @ 10 on hand, assemble 3 more worth exactly 100 (33.3333 each)
      const state = { onHand: 7, cost: '10' };
      const { tx } = makeTx(state);
      const result = await service.applyAssemblyOutput(tx, {
        productId,
        quantityReceived: 3,
        totalValue: '100',
        referenceId: 'asm-2',
        onHandBefore: 4,
      });
      expect(result.unitCost).toBe(33.3333);
      // (4×10 + 100) / 7 = 20
      expect(result.newCost).toBe(20);
    });

    it('assembly reversal removes the output at its recorded value', async () => {
      const state = { onHand: 7, cost: '20' };
      const { tx, history } = makeTx(state);
      const result = await service.applyAssemblyReversal(tx, {
        productId,
        quantityRemoved: 3,
        removedValue: '100',
        referenceId: 'asm-2',
        onHandBefore: 7,
      });
      // (7×20 − 100) / 4 = 10
      expect(result.newCost).toBe(10);
      expect(history[0]).toMatchObject({ referenceType: 'ASSEMBLY_ORDER' });
    });
  });

  describe('getCompanyStockValue', () => {
    it('sums company-owned movements only, per product at its average cost', async () => {
      const groupBy = jest.fn().mockResolvedValue([
        { productId: 'a', _sum: { quantity: 4 } },
        { productId: 'b', _sum: { quantity: 0 } },
      ]);
      const findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'a', currentCost: dec('2.5') }]);
      const prisma = {
        inventoryMovement: { groupBy },
        product: { findMany },
      };
      const service = new InventoryValuationService(prisma as never);
      const result = await service.getCompanyStockValue();
      const [args] = groupBy.mock.calls[0] as [
        { where: { ownerAgentId: unknown } },
      ];
      expect(args.where.ownerAgentId).toBeNull();
      expect(result.totalValue.toString()).toBe('10');
      expect(result.items).toHaveLength(1);
    });
  });
});
