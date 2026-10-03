import { NotFoundException } from '@nestjs/common';
import { SalesScopeService, type SalesScope } from './sales-scope.service';
import { LegacySalesOrderScopeGuard } from '../sales-orders/legacy-sales-order-scope.guard';
import { SalesOrderDocumentScopeGuard } from '../sales/orders/sales-order-document-scope.guard';

const base: SalesScope = {
  kind: 'OWN',
  ownerIds: ['u1'],
  userId: 'u1',
  isSuperAdmin: false,
  canManageLeads: false,
  canViewLeads: true,
  canViewStoreOrders: true,
  canViewShipping: false,
  canEditShipping: false,
  canViewPaymentEvidence: true,
  canManagePaymentEvidence: false,
  canViewAllOrders: false,
  canViewTeamUnassigned: false,
};

const service = new SalesScopeService({} as never, {} as never);

describe('SalesScopeService where-builders (R7 semantics)', () => {
  it('OWN: own internal records only (agent records excluded)', () => {
    expect(service.leadWhere(base)).toEqual({
      agentId: null,
      salesEmployeeId: { in: ['u1'] },
    });
    expect(service.storeOrderWhere(base)).toEqual({
      agentId: null,
      employeeId: { in: ['u1'] },
    });
  });

  it('TEAM without crm.leads.manage: no unassigned pool; with it: unassigned INTERNAL only', () => {
    const team: SalesScope = { ...base, kind: 'TEAM', ownerIds: ['u1', 'u2'] };
    expect(service.leadWhere(team)).toEqual({
      agentId: null,
      salesEmployeeId: { in: ['u1', 'u2'] },
    });
    expect(
      service.leadWhere({
        ...team,
        canManageLeads: true,
        canViewTeamUnassigned: true,
      }),
    ).toEqual({
      agentId: null,
      OR: [
        { salesEmployeeId: { in: ['u1', 'u2'] } },
        { salesEmployeeId: null },
      ],
    });
  });

  it('shipping.view and finance never widen the generic order list', () => {
    const shipping: SalesScope = { ...base, canViewShipping: true };
    const finance: SalesScope = { ...base, canManagePaymentEvidence: true };
    expect(service.storeOrderWhere(shipping)).toEqual(
      service.storeOrderWhere(base),
    );
    expect(service.storeOrderWhere(finance)).toEqual(
      service.storeOrderWhere(base),
    );
  });

  it('by-id adds only the job-need branches (queue / payment activity)', () => {
    const shipping = service.storeOrderAccessWhere({
      ...base,
      canViewShipping: true,
    });
    expect(shipping).toEqual({
      OR: [
        { agentId: null, employeeId: { in: ['u1'] } },
        { shipments: { some: {} } },
      ],
    });
    const finance = service.storeOrderAccessWhere({
      ...base,
      canManagePaymentEvidence: true,
    });
    expect(finance).toEqual({
      OR: [
        { agentId: null, employeeId: { in: ['u1'] } },
        { payments: { some: {} } },
      ],
    });
  });

  it('only explicit grants give company-wide order access', () => {
    expect(
      service.storeOrderWhere({ ...base, canViewAllOrders: true }),
    ).toEqual({});
    expect(
      service.storeOrderWhere({ ...base, kind: 'ALL', ownerIds: null }),
    ).toEqual({});
    expect(
      service.storeOrderWhere({ ...base, kind: 'NONE', ownerIds: [] }),
    ).toEqual({ id: { in: [] } });
  });

  it('agent leads are never accessible by an own/team scope', () => {
    expect(
      service.canAccessLead(base, { salesEmployeeId: 'u1', agentId: 'ag' }),
    ).toBe(false);
    expect(
      service.canAccessLead(base, { salesEmployeeId: 'u1', agentId: null }),
    ).toBe(true);
    expect(
      service.canAccessLead(
        { ...base, kind: 'ALL', ownerIds: null },
        { salesEmployeeId: null, agentId: 'ag' },
      ),
    ).toBe(true);
  });

  it('sales/orders documents: own-created by default, full register for supervisors/finance', () => {
    expect(service.salesDocumentWhere(base, false)).toEqual({
      createdBy: { in: ['u1'] },
    });
    expect(service.salesDocumentWhere(base, true)).toEqual({});
    expect(
      service.salesDocumentWhere(
        { ...base, kind: 'NONE', ownerIds: [] },
        false,
      ),
    ).toEqual({ createdBy: { in: ['u1'] } });
  });

  it('legacy sales-orders: own owner, all for shipping/supervisors', () => {
    expect(service.legacySalesOrderWhere(base)).toEqual({
      salesEmployeeId: { in: ['u1'] },
    });
    expect(
      service.legacySalesOrderWhere({ ...base, canViewShipping: true }),
    ).toEqual({});
  });
});

describe('LegacySalesOrderScopeGuard', () => {
  const ctx = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as never;

  const build = (found: boolean, scope: SalesScope = base) => {
    const prisma = {
      salesOrder: { findFirst: jest.fn(() => (found ? { id: 'o1' } : null)) },
      lead: { findFirst: jest.fn(() => null) },
    };
    const scopes = {
      resolve: jest.fn(() => scope),
      legacySalesOrderWhere: jest.fn(() => ({
        salesEmployeeId: { in: ['u1'] },
      })),
      assertLeadAccess: jest.fn(),
    };
    return {
      guard: new LegacySalesOrderScopeGuard(prisma as never, scopes as never),
      prisma,
    };
  };

  it('404s an order outside the caller’s scope, including sub-resource routes', async () => {
    const { guard } = build(false);
    for (const params of [{ id: 'o2' }, { salesOrderId: 'o2' }]) {
      await expect(
        guard.canActivate(ctx({ user: { sub: 'u1' }, params, method: 'GET' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('lets an in-scope order through', async () => {
    const { guard, prisma } = build(true);
    await expect(
      guard.canActivate(
        ctx({ user: { sub: 'u1' }, params: { id: 'o1' }, method: 'GET' }),
      ),
    ).resolves.toBe(true);
    expect(prisma.salesOrder.findFirst).toHaveBeenCalledTimes(1);
  });

  it('refuses the list to a user with no sales or shipping visibility', async () => {
    const { guard } = build(true, { ...base, kind: 'NONE', ownerIds: [] });
    await expect(
      guard.canActivate(
        ctx({ user: { sub: 'u1' }, params: {}, method: 'GET' }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('SalesOrderDocumentScopeGuard', () => {
  const ctx = (request: object) =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;

  const build = (found: boolean) => {
    const prisma = {
      salesOrderDocument: {
        findFirst: jest.fn(() => (found ? { id: 'd1' } : null)),
      },
    };
    const scopes = {
      salesDocumentWhereForUser: jest.fn(() => ({ createdBy: { in: ['u1'] } })),
    };
    return {
      guard: new SalesOrderDocumentScopeGuard(prisma as never, scopes as never),
      prisma,
    };
  };

  it('404s a document the caller did not create (and is not supervising)', async () => {
    const { guard, prisma } = build(false);
    await expect(
      guard.canActivate(ctx({ user: { sub: 'u1' }, params: { id: 'd9' } })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.salesOrderDocument.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 'd9' }, { createdBy: { in: ['u1'] } }] },
      select: { id: true },
    });
  });

  it('passes in-scope documents and id-less (list) routes', async () => {
    const { guard } = build(true);
    await expect(
      guard.canActivate(ctx({ user: { sub: 'u1' }, params: { id: 'd1' } })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx({ user: { sub: 'u1' }, params: {} })),
    ).resolves.toBe(true);
  });
});
