import {
  ALL_PERMISSION_NAMES,
  withImpliedSectionPermissions,
} from './permission-catalog';

describe('withImpliedSectionPermissions', () => {
  it('expands store-orders.view into the Sales section gate using the canonical name', () => {
    const expanded = withImpliedSectionPermissions(['store-orders.view']);
    expect(expanded).toEqual(
      expect.arrayContaining(['store-orders.view', 'sales.view']),
    );
  });

  it('expands sales.customers.view into sales.view', () => {
    const expanded = withImpliedSectionPermissions(['sales.customers.view']);
    expect(expanded).toEqual(
      expect.arrayContaining(['sales.customers.view', 'sales.view']),
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
