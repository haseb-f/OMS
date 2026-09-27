import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionsResolverService } from './permissions-resolver.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  withAuthorizationImpliedPermissions,
  withImpliedSectionPermissions,
} from './permission-catalog';
import { PartnersController } from '../partners/partners.controller';
import { ProductsController } from '../products/products.controller';
import { ChartOfAccountsController } from '../chart-of-accounts/chart-of-accounts.controller';
import { CustomerGroupsController } from '../customer-groups/customer-groups.controller';
import { WarehousesController } from '../warehouses/warehouses.controller';
import { InventoryController } from '../inventory/inventory.controller';
import { SalesOrdersController } from '../sales/orders/sales-orders.controller';
import { resolvePartnerCatalogScope } from '../partners/partner-catalog-scope';
import { filterByAccess } from '../../../web/src/navigation/build-navigation-tree';
import { navigationConfig } from '../../../web/src/navigation/navigation.config';

/**
 * SEC-03 — regression coverage for the authorization half of the security
 * review: H2 (un-permissioned restore / mutating routes) and H4 (a
 * cross-module implied section key must never authorize data access), each
 * with an ALLOWED and a DENIED case, run through the real PermissionsGuard
 * and the real PermissionsResolverService (Prisma mocked).
 */

type Handler = (...args: never[]) => unknown;

/** The route handler function itself (the metadata target), without detaching a bound method. */
function handlerOf(controller: { prototype: object }, method: string): Handler {
  return Object.getOwnPropertyDescriptor(controller.prototype, method)!
    .value as Handler;
}

function contextFor(
  controller: abstract new (...args: never[]) => unknown,
  handler: Handler,
  method: string,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ method, user: { sub: 'user-1' } }),
    }),
  } as unknown as ExecutionContext;
}

function resolverWithStoredGrants(stored: string[], superAdmin = false) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ isSuperAdmin: superAdmin }),
    },
    userPermission: {
      findMany: jest
        .fn()
        .mockResolvedValue(stored.map((name) => ({ permission: { name } }))),
    },
  };
  return new PermissionsResolverService(prisma as unknown as PrismaService);
}

async function guardAllows(
  stored: string[],
  controller: abstract new (...args: never[]) => unknown,
  handler: Handler,
  method: string,
): Promise<boolean> {
  const guard = new PermissionsGuard(
    new Reflector(),
    resolverWithStoredGrants(stored),
  );
  try {
    return await guard.canActivate(contextFor(controller, handler, method));
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('SEC-03 H2 — restore and other mutating routes are permissioned', () => {
  const cases: [
    string,
    abstract new (...args: never[]) => unknown,
    Handler,
    string,
  ][] = [
    [
      'partners.archive',
      PartnersController,
      handlerOf(PartnersController, 'restore'),
      'POST /partners/:id/restore',
    ],
    [
      'products.archive',
      ProductsController,
      handlerOf(ProductsController, 'restore'),
      'POST /products/:id/restore',
    ],
    [
      'accounting.chart-of-accounts.delete',
      ChartOfAccountsController,
      handlerOf(ChartOfAccountsController, 'restore'),
      'POST /chart-of-accounts/:id/restore',
    ],
  ];

  it.each(cases)(
    'denies %s-less callers and allows holders (%s)',
    async (permission, controller, handler) => {
      expect(
        await guardAllows(
          ['partners.view', 'products.view'],
          controller,
          handler,
          'POST',
        ),
      ).toBe(false);
      expect(await guardAllows([permission], controller, handler, 'POST')).toBe(
        true,
      );
    },
  );

  it('product attachments need products.edit', async () => {
    const handler = handlerOf(ProductsController, 'attach');
    expect(
      await guardAllows(['products.view'], ProductsController, handler, 'POST'),
    ).toBe(false);
    expect(
      await guardAllows(['products.edit'], ProductsController, handler, 'POST'),
    ).toBe(true);
  });

  it('inventory valuation method change needs settings.manage', async () => {
    const handler = handlerOf(InventoryController, 'updateValuationSettings');
    expect(
      await guardAllows(
        ['inventory.view'],
        InventoryController,
        handler,
        'PATCH',
      ),
    ).toBe(false);
    expect(
      await guardAllows(
        ['settings.manage'],
        InventoryController,
        handler,
        'PATCH',
      ),
    ).toBe(true);
  });

  it('sales order → invoice conversion needs sales.invoices.create, not just order rights', async () => {
    const handler = handlerOf(SalesOrdersController, 'convertToInvoice');
    expect(
      await guardAllows(
        ['sales.orders.view', 'sales.orders.edit'],
        SalesOrdersController,
        handler,
        'POST',
      ),
    ).toBe(false);
    expect(
      await guardAllows(
        ['sales.invoices.create'],
        SalesOrdersController,
        handler,
        'POST',
      ),
    ).toBe(true);
  });

  it('document submit needs the module edit key', async () => {
    const handler = handlerOf(SalesOrdersController, 'submit');
    expect(
      await guardAllows(
        ['sales.orders.view'],
        SalesOrdersController,
        handler,
        'POST',
      ),
    ).toBe(false);
    expect(
      await guardAllows(
        ['sales.orders.edit'],
        SalesOrdersController,
        handler,
        'POST',
      ),
    ).toBe(true);
  });
});

/**
 * Static audit: a mutating route (POST/PATCH/PUT/DELETE) may opt out of the
 * permission check only with a reviewed reason listed here. Adding a new
 * `@SkipPermissionCheck()` on a write route fails this test until it is
 * justified.
 */
const REVIEWED_MUTATING_SKIPS: Record<string, string> = {
  'payments/payments.controller.ts POST :id/attachments/from-staging':
    'Sales Agents attach payment proof after report-payment without Finance confirm; AttachmentsService.attachStagingToPayment asserts the evidence scope (assertCanMutateReceipts).',
  'payments/payments.controller.ts POST :id/attachments/upload':
    'Same payment-proof upload path; AttachmentsService.uploadForPayment asserts the evidence scope and stores the file against the caller.',
  'payments/payments.controller.ts POST :id/attachments/:attachmentId/archive':
    'AttachmentsService.archivePaymentAttachment resolves the sales scope and asserts the evidence scope before archiving.',
  'payments/payments.controller.ts POST :id/attachments':
    'Payment-proof metadata attach (legacy JSON path) — controller asserts AttachmentsService.assertCanMutatePaymentEvidence and forces uploadedById to the caller.',
  'payments/payments.controller.ts POST :id/notes':
    'Payment note — controller asserts AttachmentsService.assertCanMutatePaymentEvidence and forces the author to the caller.',
  'store-orders/store-orders.controller.ts POST :id/payment-declaration':
    'Any-of store-orders.edit / store-orders.manage / sales.receipts.create — StoreOrderPaymentDeclarationService.resolveActor throws 403 otherwise, and findOne applies the order visibility scope.',
  'store-orders/store-orders.controller.ts POST :id/pickup/:code':
    'Any-of store-orders.edit / shipping.edit — the controller checks PICKUP_PERMISSIONS and throws 403 before transitionPickup.',
};

function mutatingSkips(): string[] {
  const root = path.join(__dirname, '..');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.controller.ts')) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        let block: string[] = [];
        for (const raw of fs.readFileSync(full, 'utf8').split('\n')) {
          const line = raw.trim();
          if (line.startsWith('@')) {
            block.push(line);
            continue;
          }
          if (block.some((d) => d.startsWith('@SkipPermissionCheck'))) {
            for (const d of block) {
              const match =
                /^@(Post|Patch|Put|Delete)\('([^']*)'\)/.exec(d) ??
                /^@(Post|Patch|Put|Delete)\(\)/.exec(d);
              if (match)
                found.push(
                  `${rel} ${match[1].toUpperCase()} ${match[2] ?? ''}`.trim(),
                );
            }
          }
          if (
            line &&
            !line.startsWith('*') &&
            !line.startsWith('/') &&
            !line.startsWith('//')
          )
            block = [];
        }
      }
    }
  };
  walk(root);
  return found;
}

describe('SEC-03 H2 — @SkipPermissionCheck audit on write routes', () => {
  it('every mutating skip is a reviewed exception', () => {
    const unreviewed = mutatingSkips().filter(
      (key) => !REVIEWED_MUTATING_SKIPS[key],
    );
    expect(unreviewed).toEqual([]);
  });
});

describe('SEC-03 H4 — implied section keys never authorize data access', () => {
  const groupOnly = ['masterdata.customer-groups.view'];

  it('the navigation expansion still names partners.view, the authorization set does not', () => {
    expect(withImpliedSectionPermissions(groupOnly)).toContain('partners.view');
    const auth = withAuthorizationImpliedPermissions(groupOnly);
    expect(auth).not.toContain('partners.view');
    expect(auth).toContain('sales.view'); // coarse section gate, not a catalog permission
  });

  it('warehouses / units grants do not authorize products.view', () => {
    const auth = withAuthorizationImpliedPermissions([
      'masterdata.warehouses.view',
      'masterdata.units.view',
      'masterdata.warehouse-locations.view',
    ]);
    expect(auth).not.toContain('products.view');
  });

  it('same-module implications still authorize (products.create → products.view, physical-count.create → inventory.view, store-orders.edit → generate_invoice)', () => {
    const auth = withAuthorizationImpliedPermissions([
      'products.create',
      'inventory.physical-count.create',
      'store-orders.edit',
    ]);
    expect(auth).toEqual(
      expect.arrayContaining([
        'products.view',
        'inventory.view',
        'store-orders.view',
        'store-orders.generate_invoice',
        'sales.view',
      ]),
    );
  });

  it('resolver: a Customer Group grant does not yield partners.view (and /auth/me serves the same set)', async () => {
    const resolver = resolverWithStoredGrants(groupOnly);
    const granted = await resolver.getPermissions('user-1');
    expect(granted.has('partners.view')).toBe(false);
    expect(granted.has('masterdata.customer-groups.view')).toBe(true);
    expect(await resolver.hasPermission('user-1', 'partners.view')).toBe(false);
  });

  it('DENIED: GET /partners with only the Customer Group grant', async () => {
    expect(
      await guardAllows(
        groupOnly,
        PartnersController,
        handlerOf(PartnersController, 'findAll'),
        'GET',
      ),
    ).toBe(false);
  });

  it('DENIED: the partner picker catalog with only the Customer Group grant', async () => {
    const granted =
      await resolverWithStoredGrants(groupOnly).getPermissions('user-1');
    expect(resolvePartnerCatalogScope(false, granted)).toBeNull();
  });

  it('ALLOWED: GET /customer-groups with the Customer Group grant', async () => {
    expect(
      await guardAllows(
        groupOnly,
        CustomerGroupsController,
        handlerOf(CustomerGroupsController, 'findAll'),
        'GET',
      ),
    ).toBe(true);
  });

  it('ALLOWED: GET /partners with an explicit partners.view', async () => {
    expect(
      await guardAllows(
        ['partners.view'],
        PartnersController,
        handlerOf(PartnersController, 'findAll'),
        'GET',
      ),
    ).toBe(true);
  });

  it('DENIED: GET /products with only a Warehouses grant; ALLOWED: GET /warehouses', async () => {
    const stored = ['masterdata.warehouses.view'];
    expect(
      await guardAllows(
        stored,
        ProductsController,
        handlerOf(ProductsController, 'findAll'),
        'GET',
      ),
    ).toBe(false);
    expect(
      await guardAllows(
        stored,
        WarehousesController,
        handlerOf(WarehousesController, 'findAll'),
        'GET',
      ),
    ).toBe(true);
  });

  it('nav: the Customer Group page and its Sales section stay visible from the authorization set alone', async () => {
    const granted = [
      ...(await resolverWithStoredGrants(groupOnly).getPermissions('user-1')),
    ];
    const ids = filterByAccess(navigationConfig, granted).map(
      (item) => item.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining(['sales', 'master-data-customer-groups']),
    );
    expect(ids).not.toContain('sales-customers');
  });

  it('nav: a Warehouses grant shows Warehouses, not the Products list', async () => {
    const granted = [
      ...(await resolverWithStoredGrants([
        'masterdata.warehouses.view',
      ]).getPermissions('user-1')),
    ];
    const ids = filterByAccess(navigationConfig, granted).map(
      (item) => item.id,
    );
    expect(ids).toContain('master-data-warehouses');
    expect(ids).not.toContain('products-list');
  });
});
