import { InventoryController } from './inventory.controller';
import {
  INVENTORY_COST_PERMISSIONS,
  redactMovementCost,
  redactStockCardCost,
} from './inventory-cost-visibility';
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
    hasPermission: jest.fn(
      async (_id: string, name: string) => superAdmin || granted.includes(name),
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
      const rows = (await controller.findAllMovements(
        {} as never,
        user,
      )) as Array<{
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
      const cards = (await controller.getStockCards(user)) as Array<{
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
});
