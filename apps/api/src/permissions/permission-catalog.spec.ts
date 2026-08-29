import {
  ALL_PERMISSION_NAMES,
  PERMISSION_CATALOG,
  groupPermissionCatalog,
  withImpliedSectionPermissions,
} from './permission-catalog';

describe('withImpliedSectionPermissions', () => {
  it('expands store-orders.view into the Sales section gate using the canonical name', () => {
    const expanded = withImpliedSectionPermissions(['store-orders.view']);
    expect(expanded).toEqual(
      expect.arrayContaining(['store-orders.view', 'sales.view']),
    );
  });

  it('expands partners.view into both sales.view and purchasing.view', () => {
    const expanded = withImpliedSectionPermissions(['partners.view']);
    expect(expanded).toEqual(
      expect.arrayContaining([
        'partners.view',
        'sales.view',
        'purchasing.view',
      ]),
    );
  });

  it('does not treat an underscore alias as the canonical store-orders permission', () => {
    const expanded = withImpliedSectionPermissions(['store_orders.view']);
    expect(expanded).toEqual(['store_orders.view']);
    expect(ALL_PERMISSION_NAMES).toContain('store-orders.view');
    expect(ALL_PERMISSION_NAMES).not.toContain('store_orders.view');
  });

  it('leaves an empty grant list empty', () => {
    expect(withImpliedSectionPermissions([])).toEqual([]);
  });
});

describe('Sales catalog grouping', () => {
  it('categorizes Store Orders under Sales with unchanged action names', () => {
    const storeOrders = PERMISSION_CATALOG.find(
      (module) => module.key === 'store-orders',
    );
    expect(storeOrders?.sectionKey).toBe('sales');
    expect(storeOrders?.sectionLabelKey).toBe('permissions.sections.sales');
    expect(storeOrders?.actions.map((action) => action.name)).toEqual(
      expect.arrayContaining([
        'store-orders.view',
        'store-orders.create',
        'store-orders.edit',
        'store-orders.archive',
      ]),
    );
  });

  it('exposes Store Orders inside the Sales Permission Matrix group', () => {
    const groups = groupPermissionCatalog();
    const sales = groups.find((group) => group.sectionKey === 'sales');
    expect(sales?.sectionLabelKey).toBe('permissions.sections.sales');
    expect(sales?.modules.map((module) => module.key)).toEqual([
      'sales-quotations',
      'sales-orders',
      'store-orders',
      'sales-invoices',
      'sales-returns',
    ]);
    expect(
      groups.some(
        (group) =>
          group.sectionKey === null &&
          group.modules.some((module) => module.key === 'store-orders'),
      ),
    ).toBe(false);
  });

  it('does not treat sales.view as a grantable matrix row', () => {
    expect(ALL_PERMISSION_NAMES).not.toContain('sales.view');
    expect(
      PERMISSION_CATALOG.some((module) =>
        module.actions.some((action) => action.name === 'sales.view'),
      ),
    ).toBe(false);
  });
});
