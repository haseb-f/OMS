import { InventoryController } from './inventory.controller';
import { lastValueFrom, of } from 'rxjs';
import { Prisma } from '@prisma/client';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import {
  INVENTORY_COST_PERMISSIONS,
  redactMovementCost,
  redactProductCostDeep,
  redactStockCardCost,
} from './inventory-cost-visibility';
import { ProductCostRedactionInterceptor } from './product-cost-redaction.interceptor';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

const user = { sub: 'u-1' } as JwtPayload;

const movement = {
  id: 'm-1',
  movementNumber: 'MV-1',
  quantity: 5,
  quantityAfter: 20,
  unitCost: 12.5,
  product: { sku: 'SKU', name: 'Widget' },
};
const card = {
  productId: 'p-1',
  sku: 'SKU',
  productName: 'Widget',
  onHand: 8,
  reserved: 2,
  available: 6,
  averageCost: 3,
  lastCost: 3,
  stockValue: 24,
  lastMovement: null,
};

function build(granted: string[], superAdmin = false) {
  const service = {
    findAllMovements: jest.fn().mockResolvedValue([movement]),
    findOneMovement: jest.fn().mockResolvedValue(movement),
    getStockCards: jest.fn().mockResolvedValue([card]),
    getStockCard: jest.fn().mockResolvedValue(card),
  };
  const permissions = {
    hasPermission: jest.fn((_id: string, name: string) =>
      Promise.resolve(superAdmin || granted.includes(name)),
    ),
  };
  const controller = new InventoryController(
    service as never,
    permissions as never,
  );
  return { controller, service };
}

describe('inventory cost visibility', () => {
  it('uses only the two existing costing permissions', () => {
    expect([...INVENTORY_COST_PERMISSIONS]).toEqual([
      'expenses.view',
      'cost-explorer.view',
    ]);
  });

  describe('pure redaction', () => {
    it('withholds movement unit cost and nothing else', () => {
      expect(redactMovementCost(movement)).toEqual({
        ...movement,
        unitCost: null,
      });
      expect(movement.unitCost).toBe(12.5); // never mutates the source
    });
    it('withholds stock-card valuation, keeps quantities', () => {
      const out = redactStockCardCost(card);
      expect(out).toMatchObject({
        onHand: 8,
        reserved: 2,
        available: 6,
        sku: 'SKU',
      });
      expect([out.averageCost, out.lastCost, out.stockValue]).toEqual([
        null,
        null,
        null,
      ]);
    });
  });

  describe.each([
    ['plain inventory.view holder', [] as string[], false, false],
    ['expenses.view holder', ['expenses.view'], false, true],
    ['cost-explorer.view holder', ['cost-explorer.view'], false, true],
    ['super admin', [] as string[], true, true],
  ])('%s', (_label, granted, superAdmin, sees) => {
    it(`movements list ${sees ? 'includes' : 'withholds'} unit cost`, async () => {
      const { controller } = build(granted, superAdmin);
      const rows = (await controller.findAllMovements({}, user)) as Array<{
        unitCost: number | null;
        quantity: number;
      }>;
      expect(rows[0].unitCost).toBe(sees ? 12.5 : null);
      expect(rows[0].quantity).toBe(5);
    });
    it(`a single movement ${sees ? 'includes' : 'withholds'} unit cost`, async () => {
      const { controller } = build(granted, superAdmin);
      const row = (await controller.findOneMovement('m-1', user)) as {
        unitCost: number | null;
      };
      expect(row.unitCost).toBe(sees ? 12.5 : null);
    });
    it(`stock cards ${sees ? 'include' : 'withhold'} valuation`, async () => {
      const { controller } = build(granted, superAdmin);
      const cards = (await controller.getStockCards({}, user)) as Array<{
        stockValue: number | null;
        onHand: number;
      }>;
      expect(cards[0].stockValue).toBe(sees ? 24 : null);
      expect(cards[0].onHand).toBe(8);
      const one = (await controller.getStockCard('p-1', user)) as {
        averageCost: number | null;
      };
      expect(one.averageCost).toBe(sees ? 3 : null);
    });
  });

  // R13 S3 — products / sales documents embedding `product: true`.
  describe('product actual cost (S3)', () => {
    const lastCostUpdate = new Date('2026-10-01T00:00:00Z');
    const product = {
      id: 'p-1',
      name: 'Widget',
      purchasePrice: new Prisma.Decimal('9.5'),
      currentCost: new Prisma.Decimal('7.1234'),
      lastCostUpdate,
      category: { id: 'c-1', name: 'Cat' },
    };
    const order = {
      id: 'so-1',
      grandTotal: new Prisma.Decimal('100'),
      items: [{ id: 'i-1', quantity: 2, product }],
    };

    it('deep redaction nulls currentCost / lastCostUpdate anywhere, keeps the expected purchase price, never mutates', () => {
      const page = { items: [product], total: 1 };
      const out = redactProductCostDeep({ page, order });
      expect(out.page.items[0]).toMatchObject({
        currentCost: null,
        lastCostUpdate: null,
        name: 'Widget',
        category: { id: 'c-1', name: 'Cat' },
      });
      expect(out.page.items[0].purchasePrice).toBe(product.purchasePrice);
      expect(out.order.items[0].product.currentCost).toBeNull();
      expect(out.order.grandTotal).toBe(order.grandTotal);
      expect(product.currentCost.toString()).toBe('7.1234');
      expect(product.lastCostUpdate).toBe(lastCostUpdate);
    });

    describe.each([
      ['products.view only', [] as string[], false, false],
      ['expenses.view holder', ['expenses.view'], false, true],
      ['cost-explorer.view holder', ['cost-explorer.view'], false, true],
      ['super admin', [] as string[], true, true],
    ])('%s', (_label, granted, superAdmin, sees) => {
      it(`the interceptor ${sees ? 'keeps' : 'withholds'} the actual cost`, async () => {
        const permissions = {
          hasPermission: jest.fn((_id: string, name: string) =>
            Promise.resolve(superAdmin || granted.includes(name)),
          ),
        };
        const interceptor = new ProductCostRedactionInterceptor(
          permissions as never,
        );
        const context = {
          switchToHttp: () => ({ getRequest: () => ({ user }) }),
        } as unknown as ExecutionContext;
        const next: CallHandler = { handle: () => of(order) };
        const result = (await lastValueFrom(
          await interceptor.intercept(context, next),
        )) as typeof order;
        const line = result.items[0].product;
        expect(line.currentCost).toEqual(sees ? product.currentCost : null);
        expect(line.lastCostUpdate).toEqual(sees ? lastCostUpdate : null);
        expect(line.purchasePrice).toBe(product.purchasePrice);
      });
    });
  });
});
