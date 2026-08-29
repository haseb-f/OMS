import {
  filterByAccess,
  filterNavigationByAuth,
} from '../../../web/src/navigation/build-navigation-tree';
import { navigationConfig } from '../../../web/src/navigation/navigation.config';
import { documentRowAccess } from '../../../web/src/components/shared/data-table/document-row-access';
import type { NavigationItem } from '../../../web/src/types/navigation';

const fixture: NavigationItem[] = [
  { id: 'dashboard', titleKey: 'nav.dashboard', route: '/' },
  { id: 'sales', titleKey: 'nav.sales', permissions: ['sales.view'] },
  {
    id: 'store-orders-list',
    titleKey: 'nav.storeOrdersList',
    parent: 'sales',
    route: '/store-orders',
    permissions: ['store-orders.view'],
  },
  {
    id: 'sales-quotations',
    titleKey: 'nav.salesQuotations',
    parent: 'sales',
    route: '/sales/quotations',
    permissions: ['sales.quotations.view'],
  },
  {
    id: 'finance',
    titleKey: 'nav.finance',
    permissions: ['finance.view'],
  },
  {
    id: 'finance-ungated-child',
    titleKey: 'nav.financeJournalEntries',
    parent: 'finance',
    route: '/finance/receiving-accounts',
  },
];

describe('filterByAccess', () => {
  it('keeps the full navigation for a super admin', () => {
    const visible = filterByAccess(navigationConfig, [], true);
    expect(visible).toHaveLength(navigationConfig.length);
  });

  it('shows Store Orders when the user only has store-orders.view', () => {
    const ids = filterByAccess(fixture, ['store-orders.view']).map(
      (item) => item.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining(['dashboard', 'sales', 'store-orders-list']),
    );
    expect(ids).not.toContain('sales-quotations');
    expect(ids).not.toContain('finance');
    expect(ids).not.toContain('finance-ungated-child');
  });

  it('hides Store Orders when store-orders.view is missing', () => {
    const ids = filterByAccess(fixture, ['partners.view']).map(
      (item) => item.id,
    );
    expect(ids).not.toContain('store-orders-list');
  });

  it('keeps only ungated base navigation when the user has zero module permissions', () => {
    const ids = filterByAccess(fixture, []).map((item) => item.id);
    expect(ids).toEqual(['dashboard']);
  });

  it('shows ungated finance children only after the section is authorized', () => {
    const hidden = filterByAccess(fixture, ['store-orders.view']).map(
      (item) => item.id,
    );
    expect(hidden).not.toContain('finance-ungated-child');

    const visible = filterByAccess(fixture, ['finance.view']).map(
      (item) => item.id,
    );
    expect(visible).toEqual(
      expect.arrayContaining(['dashboard', 'finance', 'finance-ungated-child']),
    );
    expect(visible).not.toContain('store-orders-list');
  });

  it('does not treat an underscore alias as store-orders.view', () => {
    const ids = filterByAccess(fixture, ['store_orders.view']).map(
      (item) => item.id,
    );
    expect(ids).toEqual(['dashboard']);
  });

  it('shows Sales without Store Orders when only partners.view is granted', () => {
    const ids = filterByAccess(navigationConfig, ['partners.view']).map(
      (item) => item.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        'dashboard',
        'sales',
        'sales-customers',
        'master-data-customer-groups',
      ]),
    );
    expect(ids).not.toContain('store-orders-list');
    expect(ids).not.toContain('sales-quotations');
  });

  it('places Store Orders under Sales after Orders and before Invoices', () => {
    const salesChildren = navigationConfig
      .filter((item) => item.parent === 'sales')
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((item) => item.id);
    expect(salesChildren).toEqual([
      'sales-customers',
      'master-data-customer-groups',
      'sales-quotations',
      'sales-orders',
      'store-orders-list',
      'store-orders-import',
      'store-orders-needs-review',
      'sales-invoices',
      'sales-returns',
    ]);
    expect(
      navigationConfig.some(
        (item) => item.id === 'store-orders' && !item.parent,
      ),
    ).toBe(false);
  });

  it('reveals Store Orders from the real navigation config without sales.view', () => {
    const ids = filterByAccess(navigationConfig, ['store-orders.view']).map(
      (item) => item.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        'dashboard',
        'sales',
        'store-orders-list',
        'store-orders-import',
        'store-orders-needs-review',
      ]),
    );
    expect(ids).not.toContain('sales-quotations');
    expect(ids).not.toContain('crm');
    expect(ids).not.toContain('finance');
    expect(ids).not.toContain('settings');
    expect(ids).not.toContain('expenses');
    expect(ids).not.toContain('reports');
    expect(ids).not.toContain('master-data');
  });
});

describe('filterNavigationByAuth loading state', () => {
  it('does not collapse to Dashboard-only while permissions are still loading', () => {
    const visible = filterNavigationByAuth(fixture, [], {
      accessReady: false,
    });
    expect(visible).toEqual(fixture);
    expect(visible.map((item) => item.id)).not.toEqual(['dashboard']);
  });

  it('filters only after authentication has resolved', () => {
    const visible = filterNavigationByAuth(fixture, [], {
      accessReady: true,
    });
    expect(visible.map((item) => item.id)).toEqual(['dashboard']);
  });
});

describe('documentRowAccess', () => {
  it('keeps the page/view action while hiding edit when only view is granted', () => {
    const access = documentRowAccess(
      (permission) => permission === 'store-orders.view',
      'store-orders',
    );
    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(false);
    expect(access.canArchive).toBe(false);
  });
});
