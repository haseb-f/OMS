import { ForbiddenException } from '@nestjs/common';
import { SalesScopeService, type SalesScope } from './sales-scope.service';

function scope(partial: Partial<SalesScope>): SalesScope {
  return {
    kind: 'NONE',
    ownerIds: [],
    userId: 'agent-a',
    isSuperAdmin: false,
    canManageLeads: false,
    canViewLeads: false,
    canViewStoreOrders: false,
    canViewShipping: false,
    canEditShipping: false,
    canViewPaymentEvidence: false,
    canManagePaymentEvidence: false,
    ...partial,
  };
}

describe('SalesScopeService payment evidence', () => {
  const service = new SalesScopeService({} as never, {} as never);
  const orderA = { id: 'order-a', employeeId: 'agent-a' };
  const orderB = { id: 'order-b', employeeId: 'agent-b' };

  it('allows an agent to view their own receipt and denies another agent', () => {
    const agent = scope({
      kind: 'OWN',
      ownerIds: ['agent-a'],
      canViewLeads: true,
      canViewPaymentEvidence: true,
    });
    expect(service.canAccessPaymentEvidence(agent, orderA)).toBe(true);
    expect(service.canAccessPaymentEvidence(agent, orderB)).toBe(false);
  });

  it('allows a team manager within the team', () => {
    const manager = scope({
      kind: 'TEAM',
      ownerIds: ['agent-a', 'manager'],
      userId: 'manager',
      canViewLeads: true,
      canViewPaymentEvidence: true,
    });
    expect(service.canAccessPaymentEvidence(manager, orderA)).toBe(true);
    expect(service.canAccessPaymentEvidence(manager, orderB)).toBe(false);
  });

  it('denies shipping-only users even when they can fulfill the order', () => {
    const shipping = scope({
      kind: 'NONE',
      canViewShipping: true,
      canEditShipping: true,
      canViewStoreOrders: true,
      canViewPaymentEvidence: false,
    });
    expect(service.canAccessPaymentEvidence(shipping, orderA)).toBe(false);
    expect(() => service.assertPaymentEvidenceAccess(shipping, orderA)).toThrow(
      ForbiddenException,
    );
  });

  it('allows finance/admin to view any receipt', () => {
    const finance = scope({
      kind: 'NONE',
      canViewPaymentEvidence: true,
      canManagePaymentEvidence: true,
    });
    expect(service.canAccessPaymentEvidence(finance, orderB)).toBe(true);
  });
});
