import { SalesInvoicesController } from './sales-invoices.controller';
import {
  redactDocumentLinesCost,
  redactLineCost,
} from '../../inventory/inventory-cost-visibility';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';

const user = { sub: 'u-1' } as JwtPayload;

const kitLine = {
  id: 'i-1',
  quantity: 2,
  unitPrice: '300',
  lineTotal: '600',
  unitCost: '35',
  product: { id: 'kit', name: 'Kit', currentCost: '0', salesPrice: '300' },
  fulfillmentSnapshot: {
    recipeId: 'r-1',
    version: 1,
    components: [
      { productId: 'a', qtyPerKit: 2, unitCost: '10' },
      { productId: 'b', qtyPerKit: 1, unitCost: '15' },
    ],
  },
};
const plainLine = {
  id: 'i-2',
  quantity: 1,
  unitPrice: '50',
  lineTotal: '50',
  unitCost: '7',
  product: { id: 'p', name: 'Plain' },
  fulfillmentSnapshot: null,
};
const invoice = {
  id: 'inv-1',
  grandTotal: '650',
  items: [kitLine, plainLine],
};

function build(granted: string[], superAdmin = false) {
  const service = {
    findOne: jest.fn().mockResolvedValue(invoice),
    findAll: jest.fn().mockResolvedValue({
      items: [invoice],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    confirm: jest.fn().mockResolvedValue(invoice),
  };
  const permissions = {
    hasPermission: jest.fn((_id: string, name: string) =>
      Promise.resolve(superAdmin || granted.includes(name)),
    ),
  };
  return new SalesInvoicesController(service as never, permissions as never);
}

type Line = {
  unitCost: string | null;
  lineTotal: string;
  product: { currentCost?: string | null; name: string };
  fulfillmentSnapshot: {
    components: { productId: string; qtyPerKit: number; unitCost?: string }[];
  } | null;
};

describe('sales invoice cost visibility (same rule as stock cards)', () => {
  describe('pure redaction', () => {
    it('withholds the line cost, the kit component costs and the product average — keeps the rest', () => {
      const out = redactLineCost(kitLine);
      expect(out.unitCost).toBeNull();
      expect(out.product).toEqual({ ...kitLine.product, currentCost: null });
      expect(out.fulfillmentSnapshot).toEqual({
        recipeId: 'r-1',
        version: 1,
        components: [
          { productId: 'a', qtyPerKit: 2 },
          { productId: 'b', qtyPerKit: 1 },
        ],
      });
      expect(out.lineTotal).toBe('600');
      // Never mutates the source.
      expect(kitLine.unitCost).toBe('35');
      expect(kitLine.fulfillmentSnapshot.components[0].unitCost).toBe('10');
    });

    it('leaves a line without snapshot / product cost as is (cost nulled)', () => {
      const out = redactDocumentLinesCost(invoice).items[1];
      expect(out).toEqual({ ...plainLine, unitCost: null });
    });
  });

  describe.each([
    ['sales.invoices.view only', [] as string[], false, false],
    ['expenses.view holder', ['expenses.view'], false, true],
    ['cost-explorer.view holder', ['cost-explorer.view'], false, true],
    ['super admin', [] as string[], true, true],
  ])('%s', (_label, granted, superAdmin, sees) => {
    it(`invoice read ${sees ? 'includes' : 'withholds'} line and component cost`, async () => {
      const controller = build(granted, superAdmin);
      const read = (await controller.findOne('inv-1', user)) as unknown as {
        items: Line[];
      };
      const [kit] = read.items;
      expect(kit.unitCost).toBe(sees ? '35' : null);
      expect(kit.fulfillmentSnapshot!.components[0].unitCost).toBe(
        sees ? '10' : undefined,
      );
      expect(kit.fulfillmentSnapshot!.components[0].qtyPerKit).toBe(2);
      expect(kit.product.currentCost).toBe(sees ? '0' : null);
      expect(kit.lineTotal).toBe('600');
    });

    it(`list and confirm ${sees ? 'include' : 'withhold'} line cost`, async () => {
      const controller = build(granted, superAdmin);
      const page = (await controller.findAll({}, user)) as unknown as {
        items: { items: Line[] }[];
      };
      expect(page.items[0].items[1].unitCost).toBe(sees ? '7' : null);
      const confirmed = (await controller.confirm(
        'inv-1',
        user,
      )) as unknown as { items: Line[] };
      expect(confirmed.items[0].unitCost).toBe(sees ? '35' : null);
    });
  });
});
