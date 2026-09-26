import { ALL_PERMISSION_NAMES } from './permission-catalog';
import { PARTNER_CATALOG_READ_PERMISSIONS } from '../partners/partners.controller';
import { PRODUCT_CATALOG_READ_PERMISSIONS } from '../products/products.controller';

/**
 * GET /partners/catalog and GET /products/catalog are read-only picker
 * endpoints gated by an allow-list of "this user builds a screen that embeds
 * the picker" permissions. A typo'd name there silently locks the picker out
 * (403 rendered as an empty dropdown), so every entry must be a real
 * canonical permission, and the flows known to embed a picker must be listed.
 */
describe('Picker catalog read permissions', () => {
  const known = new Set(ALL_PERMISSION_NAMES);

  it.each([
    ['partners', PARTNER_CATALOG_READ_PERMISSIONS],
    ['products', PRODUCT_CATALOG_READ_PERMISSIONS],
  ])('%s catalog allow-list only names canonical permissions', (_, list) => {
    expect(list.filter((name) => !known.has(name))).toEqual([]);
    expect(new Set(list).size).toBe(list.length);
  });

  it('partner picker is reachable from Finance money-movement and statement screens', () => {
    expect(PARTNER_CATALOG_READ_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'sales.receipts.create',
        'purchasing.payments.create',
        'sales.refunds.create',
        'reports.financial.view',
        'accounting.bank-transactions.manage',
        'landed-cost.create',
        'masterdata.fixed-assets.create',
      ]),
    );
  });

  it('product picker is reachable from the cost screens', () => {
    expect(PRODUCT_CATALOG_READ_PERMISSIONS).toEqual(
      expect.arrayContaining(['expenses.view', 'cost-explorer.view']),
    );
  });

  it('no allow-list entry is a destructive/approval authority', () => {
    const risky = /\.(archive|delete|approve|confirm|cancel|post|reverse)$/;
    expect(
      [
        ...PARTNER_CATALOG_READ_PERMISSIONS,
        ...PRODUCT_CATALOG_READ_PERMISSIONS,
      ].filter((name) => risky.test(name)),
    ).toEqual([]);
  });
});
