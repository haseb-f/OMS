import { ForbiddenException } from '@nestjs/common';
import { PartnerRoleType, PartnerStatus } from '@prisma/client';
import { ALL_PERMISSION_NAMES } from '../permissions/permission-catalog';
import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PartnersController } from './partners.controller';
import type { PartnersService } from './partners.service';
import type { FindPartnersQueryDto } from './dto/find-partners-query.dto';
import {
  PARTNER_CATALOG_READ_PERMISSIONS,
  PARTNER_CATALOG_SCOPES,
  effectiveCatalogRoleFilter,
  projectCatalogRow,
  resolvePartnerCatalogScope,
} from './partner-catalog-scope';

const { CUSTOMER, SUPPLIER, EMPLOYEE, INVESTOR } = PartnerRoleType;

/** A full catalog row as PartnersService.findAll returns it (contacts, profiles, balances). */
function fullRow(id: string, roles: PartnerRoleType[]) {
  return {
    id,
    partnerNumber: `PT-${id}`,
    name: `Partner ${id}`,
    legalName: 'Legal',
    commercialName: 'Brand',
    entityType: 'ORGANIZATION',
    phone: '+201000000000',
    mobile: '+201000000001',
    email: 'someone@example.test',
    website: 'https://example.test',
    taxNumber: 'TAX-1',
    commercialRegistration: 'CR-1',
    address: '1 Street',
    city: 'Cairo',
    notes: 'private note',
    countryId: 'country-1',
    country: { id: 'country-1', code: 'EG', name: 'Egypt' },
    status: PartnerStatus.ACTIVE,
    source: 'MANUAL',
    roles: roles.map((role, i) => ({
      id: `${id}-r${i}`,
      role,
      partnerId: id,
      createdAt: new Date('2026-01-01'),
      createdBy: 'creator',
    })),
    currencyId: 'cur-1',
    currency: {
      id: 'cur-1',
      code: 'EGP',
      name: 'Egyptian Pound',
      exchangeRate: '1',
    },
    customerProfile: {
      id: 'cp',
      creditLimit: '5000',
      paymentTermId: 'pt-1',
      paymentTerm: { id: 'pt-1', code: 'NET30', name: 'Net 30', days: 30 },
      customerGroupId: 'cg-1',
      customerGroup: { id: 'cg-1', code: 'VIP', name: 'VIP' },
      defaultReceivableAccountId: 'acc-ar',
    },
    supplierProfile: { id: 'sp', creditLimit: '9000' },
    employeeProfile: roles.includes(EMPLOYEE)
      ? { id: 'ep', employeeCode: 'EMP-1', userId: 'u-9' }
      : null,
    investorProfile: roles.includes(INVESTOR)
      ? { id: 'ip', nationalId: 'NID-1', residencyId: 'RES-1', iban: 'SA00' }
      : null,
    receivableBalance: 1234.5,
    payableBalance: 99,
  };
}

const DETAIL_KEYS = [
  'phone',
  'mobile',
  'email',
  'website',
  'taxNumber',
  'commercialRegistration',
  'address',
  'city',
  'notes',
  'legalName',
  'customerProfile',
  'supplierProfile',
  'employeeProfile',
  'investorProfile',
  'receivableBalance',
  'payableBalance',
  'country',
  'countryId',
];

const PICKER_KEYS = [
  'commercialName',
  'currency',
  'currencyId',
  'id',
  'name',
  'partnerNumber',
  'roles',
  'status',
];

/** Never part of any catalog row, whatever the caller's scope (SEC-03 H1). */
const NEVER_IN_CATALOG = [
  'investorProfile',
  'employeeProfile',
  'supplierProfile',
  'taxNumber',
  'commercialRegistration',
  'notes',
  'payableBalance',
  'legalName',
  'website',
  'country',
  'source',
  'entityType',
];

describe('Partner catalog scope map (SEC-01)', () => {
  const known = new Set(ALL_PERMISSION_NAMES);

  it('only names canonical permissions', () => {
    expect(
      PARTNER_CATALOG_READ_PERMISSIONS.filter((name) => !known.has(name)),
    ).toEqual([]);
  });

  it('never grants through a write-authority / approval / posting key', () => {
    const risky =
      /\.(delete|archive|approve|confirm|cancel|post|reverse|void|unpost)$/;
    expect(
      PARTNER_CATALOG_READ_PERMISSIONS.filter((n) => risky.test(n)),
    ).toEqual([]);
  });

  it('every entry scopes to a non-empty role set', () => {
    for (const [name, grant] of Object.entries(PARTNER_CATALOG_SCOPES)) {
      if (grant.roles !== 'ANY')
        expect([name, grant.roles.length > 0]).toEqual([name, true]);
    }
  });

  it('pins the screen-derived scopes', () => {
    const view = (name: string) => PARTNER_CATALOG_SCOPES[name];
    expect(view('partners.view')).toEqual({ roles: 'ANY', detail: true });
    expect(view('sales.orders.create')).toEqual({
      roles: [CUSTOMER],
      detail: true,
    });
    expect(view('store-orders.create')).toEqual({
      roles: [CUSTOMER],
      detail: true,
    });
    expect(view('sales.receipts.create')).toEqual({
      roles: [CUSTOMER],
      detail: false,
    });
    expect(view('purchasing.orders.create')).toEqual({
      roles: [SUPPLIER],
      detail: false,
    });
    expect(view('products.edit')).toEqual({ roles: [SUPPLIER], detail: false });
    expect(view('masterdata.fixed-assets.create')).toEqual({
      roles: [SUPPLIER],
      detail: false,
    });
    expect(view('accounting.bank-transactions.manage')).toEqual({
      roles: [SUPPLIER],
      detail: false,
    });
    expect(view('reports.financial.view')).toEqual({
      roles: [CUSTOMER, SUPPLIER],
      detail: false,
    });
    expect(view('landed-cost.create')).toEqual({ roles: 'ANY', detail: false });
    expect(view('accounting.journal-entries.edit')).toEqual({
      roles: 'ANY',
      detail: false,
    });
  });

  it('only pre-existing document-creation grants (and partners.view) carry detail', () => {
    const detailGrants = Object.entries(PARTNER_CATALOG_SCOPES)
      .filter(([, grant]) => grant.detail)
      .map(([name]) => name)
      .sort();
    expect(detailGrants).toEqual(
      [
        'partners.view',
        'sales.invoices.create',
        'sales.orders.create',
        'sales.quotations.create',
        'sales.returns.create',
        'store-orders.create',
      ].sort(),
    );
  });
});

describe('resolvePartnerCatalogScope / effectiveCatalogRoleFilter', () => {
  it('super admin = ANY with detail', () => {
    expect(resolvePartnerCatalogScope(true, new Set())).toEqual({
      roles: 'ANY',
      detailRoles: 'ANY',
    });
  });

  it('no catalog permission → null (denied)', () => {
    expect(
      resolvePartnerCatalogScope(
        false,
        new Set(['inventory.view', 'hr.employees.view']),
      ),
    ).toBeNull();
  });

  it('unions roles and keeps detail only for detail grants', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['sales.orders.create', 'products.edit']),
    )!;
    expect(scope.roles).toEqual(new Set([CUSTOMER, SUPPLIER]));
    expect(scope.detailRoles).toEqual(new Set([CUSTOMER]));
  });

  it('an ANY grant widens roles but not detail', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['landed-cost.edit', 'sales.receipts.create']),
    )!;
    expect(scope.roles).toBe('ANY');
    expect(scope.detailRoles).toEqual(new Set());
  });

  it('no requested role → restricted to the allowed set', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['products.create']),
    )!;
    expect(effectiveCatalogRoleFilter(undefined, scope)).toEqual([SUPPLIER]);
    expect(effectiveCatalogRoleFilter([], scope)).toEqual([SUPPLIER]);
  });

  it('requested role inside scope passes through', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['reports.financial.view']),
    )!;
    expect(effectiveCatalogRoleFilter([CUSTOMER], scope)).toEqual([CUSTOMER]);
  });

  it('requested role outside scope → 403, even mixed with an allowed role', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['products.create']),
    )!;
    expect(() => effectiveCatalogRoleFilter([CUSTOMER], scope)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      effectiveCatalogRoleFilter([SUPPLIER, CUSTOMER], scope),
    ).toThrow(ForbiddenException);
  });

  it('ANY scope: requested role respected, none = unrestricted', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['landed-cost.create']),
    )!;
    expect(effectiveCatalogRoleFilter([EMPLOYEE], scope)).toEqual([EMPLOYEE]);
    expect(effectiveCatalogRoleFilter(undefined, scope)).toBeUndefined();
  });
});

describe('projectCatalogRow', () => {
  it('picker-only callers get exactly the picker fields', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['sales.receipts.create']),
    )!;
    const projected = projectCatalogRow(fullRow('a', [CUSTOMER]), scope);
    expect(Object.keys(projected).sort()).toEqual(
      [
        'commercialName',
        'currency',
        'currencyId',
        'id',
        'name',
        'partnerNumber',
        'roles',
        'status',
      ].sort(),
    );
    for (const key of DETAIL_KEYS) expect(projected).not.toHaveProperty(key);
    expect(projected.currency).toEqual({
      id: 'cur-1',
      code: 'EGP',
      name: 'Egyptian Pound',
    });
    expect(projected.roles[0]).toEqual({
      id: 'a-r0',
      role: CUSTOMER,
      createdAt: new Date('2026-01-01'),
    });
  });

  it('detail-authorized callers get the explicit CUSTOMER detail block only (SEC-03 H1)', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['sales.invoices.create']),
    )!;
    const projected = projectCatalogRow(fullRow('b', [CUSTOMER]), scope);
    expect(Object.keys(projected).sort()).toEqual(
      [
        ...PICKER_KEYS,
        'address',
        'city',
        'countryId',
        'customerProfile',
        'email',
        'mobile',
        'phone',
        'receivableBalance',
      ].sort(),
    );
    expect(projected.customerProfile).toEqual({
      id: 'cp',
      paymentTermId: 'pt-1',
      paymentTerm: { id: 'pt-1', code: 'NET30', name: 'Net 30', days: 30 },
      creditLimit: '5000',
    });
    expect(projected.receivableBalance).toBe(1234.5);
    for (const key of NEVER_IN_CATALOG)
      expect(projected).not.toHaveProperty(key);
  });

  it('never leaks investor / employee / tax / notes / payable, even for a detail-authorized customer that is also an investor and employee', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['store-orders.create']),
    )!;
    const projected = projectCatalogRow(
      fullRow('x', [CUSTOMER, INVESTOR, EMPLOYEE, SUPPLIER]),
      scope,
    );
    expect(projected).toHaveProperty('phone');
    for (const key of NEVER_IN_CATALOG)
      expect(projected).not.toHaveProperty(key);
    expect(JSON.stringify(projected)).not.toMatch(
      /NID-1|RES-1|SA00|EMP-1|TAX-1|private note/,
    );
  });

  it('super admin / partners.view catalog rows are still the explicit projection', () => {
    for (const scope of [
      resolvePartnerCatalogScope(true, new Set())!,
      resolvePartnerCatalogScope(false, new Set(['partners.view']))!,
    ]) {
      const projected = projectCatalogRow(
        fullRow('y', [CUSTOMER, INVESTOR]),
        scope,
      );
      expect(projected).toHaveProperty('receivableBalance');
      for (const key of NEVER_IN_CATALOG)
        expect(projected).not.toHaveProperty(key);
      expect(projected.roles.map((r) => r.role)).toEqual([CUSTOMER, INVESTOR]);
    }
  });

  it('detail is per role: a customer-detail grant does not reveal a supplier-only row', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['sales.orders.create', 'products.edit']),
    )!;
    expect(
      projectCatalogRow(fullRow('s', [SUPPLIER]), scope),
    ).not.toHaveProperty('phone');
    expect(
      projectCatalogRow(fullRow('c', [CUSTOMER, SUPPLIER]), scope),
    ).toHaveProperty('phone');
  });

  it('a supplier picker never gets a supplier detail block (no screen reads one)', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['purchasing.orders.create']),
    )!;
    const projected = projectCatalogRow(fullRow('s2', [SUPPLIER]), scope);
    expect(Object.keys(projected).sort()).toEqual([...PICKER_KEYS].sort());
  });

  it('roles are narrowed to the caller scope (SEC-03 L4)', () => {
    const scope = resolvePartnerCatalogScope(
      false,
      new Set(['sales.receipts.create']),
    )!;
    const projected = projectCatalogRow(
      fullRow('r', [CUSTOMER, EMPLOYEE, INVESTOR]),
      scope,
    );
    expect(projected.roles.map((r) => r.role)).toEqual([CUSTOMER]);
  });
});

describe('PartnersController.catalog()', () => {
  const user = { sub: 'user-1' } as JwtPayload;

  function build(opts: { superAdmin?: boolean; grants: string[] }) {
    const findAll = jest.fn((query: FindPartnersQueryDto) =>
      Promise.resolve({
        items: [fullRow('c1', [CUSTOMER]), fullRow('s1', [SUPPLIER])].filter(
          (row) =>
            !query.role ||
            row.roles.some((assignment) =>
              query.role!.includes(assignment.role),
            ),
        ),
        total: 2,
        page: 1,
        pageSize: 20,
      }),
    );
    const permissions = {
      isSuperAdmin: jest.fn(() => Promise.resolve(opts.superAdmin ?? false)),
      getPermissions: jest.fn(() => Promise.resolve(new Set(opts.grants))),
    };
    const controller = new PartnersController(
      { findAll } as unknown as PartnersService,
      permissions as unknown as PermissionsResolverService,
    );
    return { controller, findAll };
  }

  it('picker-only caller cannot search contact columns (no phone/email ownership oracle)', async () => {
    const { controller, findAll } = build({
      grants: ['sales.receipts.create'],
    });
    await controller.catalog({ role: [CUSTOMER], search: '+2010' }, user);
    expect(findAll).toHaveBeenCalledWith(expect.anything(), {
      identitySearchOnly: true,
    });
  });

  it('detail-authorized caller keeps contact search', async () => {
    const { controller, findAll } = build({ grants: ['sales.orders.create'] });
    await controller.catalog({ role: [CUSTOMER], search: '+2010' }, user);
    expect(findAll).toHaveBeenCalledWith(expect.anything(), {
      identitySearchOnly: false,
    });
  });

  it('mixed scope without a role filter: contact search off unless detail covers every role', async () => {
    const { controller, findAll } = build({
      grants: ['sales.orders.create', 'purchasing.payments.create'],
    });
    await controller.catalog({ search: 'x' }, user);
    expect(findAll).toHaveBeenCalledWith(expect.anything(), {
      identitySearchOnly: true,
    });
  });

  it('denies a caller with no catalog permission (403)', async () => {
    const { controller, findAll } = build({ grants: ['inventory.view'] });
    await expect(controller.catalog({}, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findAll).not.toHaveBeenCalled();
  });

  it('supplier-only caller requesting CUSTOMER → 403, service never queried', async () => {
    const { controller, findAll } = build({ grants: ['products.edit'] });
    await expect(
      controller.catalog({ role: [CUSTOMER] }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findAll).not.toHaveBeenCalled();
  });

  it('ids= lookup is scoped: a supplier-only grant cannot fetch a customer by id', async () => {
    const { controller, findAll } = build({ grants: ['products.edit'] });
    const result = await controller.catalog({ ids: ['c1', 's1'] }, user);
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ['c1', 's1'],
        role: [SUPPLIER],
        status: [PartnerStatus.ACTIVE],
      }),
      { identitySearchOnly: true },
    );
    expect(result.items.map((row) => row.id)).toEqual(['s1']);
    expect(result.items[0]).not.toHaveProperty('payableBalance');
  });

  it('finance receipts grant: CUSTOMER catalog is picker-only', async () => {
    const { controller } = build({ grants: ['sales.receipts.create'] });
    const result = await controller.catalog({ role: [CUSTOMER] }, user);
    expect(result.items).toHaveLength(1);
    for (const key of DETAIL_KEYS)
      expect(result.items[0]).not.toHaveProperty(key);
  });

  it('sales document creator keeps customer detail', async () => {
    const { controller } = build({ grants: ['sales.orders.create'] });
    const result = await controller.catalog({ role: [CUSTOMER] }, user);
    expect(result.items[0]).toHaveProperty('receivableBalance', 1234.5);
    expect(result.items[0]).toHaveProperty('customerProfile');
  });

  it('super admin: any role, explicit detail, status forced ACTIVE, archived + sort knobs neutralized (L1/L2)', async () => {
    const { controller, findAll } = build({ superAdmin: true, grants: [] });
    const result = await controller.catalog(
      {
        status: [PartnerStatus.INACTIVE],
        includeArchived: true,
        sortBy: 'taxNumber',
      },
      user,
    );
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        role: undefined,
        status: [PartnerStatus.ACTIVE],
        includeArchived: false,
        sortBy: undefined,
      }),
      { identitySearchOnly: false },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toHaveProperty('phone');
    // Supplier-only row: no screen reads supplier detail from the catalog.
    expect(result.items[1]).not.toHaveProperty('phone');
    for (const row of result.items)
      for (const key of NEVER_IN_CATALOG) expect(row).not.toHaveProperty(key);
  });

  it('a picker-only caller cannot widen the catalog to archived rows (L1)', async () => {
    const { controller, findAll } = build({ grants: ['products.edit'] });
    await controller.catalog({ includeArchived: true }, user);
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: false }),
      expect.anything(),
    );
  });

  it('an identity sortBy passes through to the service (L2)', async () => {
    const { controller, findAll } = build({ grants: ['sales.orders.create'] });
    await controller.catalog(
      { role: [CUSTOMER], sortBy: 'partnerNumber' },
      user,
    );
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'partnerNumber' }),
      expect.anything(),
    );
  });
});
