import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';

export type SalesScopeKind = 'ALL' | 'TEAM' | 'OWN' | 'NONE';

export interface SalesScope {
  kind: SalesScopeKind;
  /** Null means unrestricted. Otherwise the set of owner user ids in scope. */
  ownerIds: string[] | null;
  userId: string;
  isSuperAdmin: boolean;
  canManageLeads: boolean;
  canViewLeads: boolean;
  canViewStoreOrders: boolean;
  canViewShipping: boolean;
  canEditShipping: boolean;
  canViewPaymentEvidence: boolean;
  canManagePaymentEvidence: boolean;
  /**
   * R7 — Store Orders of every owner (browse + open). Only Super Admin, an
   * explicit `crm.leads.manage` grant (without a team) or the explicit
   * `store-orders.view_all` grant. `store-orders.manage` (an action right
   * ordinary sales staff may hold for payment-review/corrections) does NOT
   * widen the scope. Shipping/Finance visibility never sets it.
   */
  canViewAllOrders?: boolean;
  /**
   * R7 — a Team Manager may also see the company's UNASSIGNED internal leads
   * (the pool they distribute from) only with an explicit `crm.leads.manage`.
   */
  canViewTeamUnassigned?: boolean;
}

/**
 * Single authorization resolver for CRM Lead + StoreOrder sales ownership.
 *
 * Round 7 semantics (documented for owner confirmation):
 *  - DEFAULT is OWN: a user who can view leads/orders sees only the records
 *    assigned to them (`salesEmployeeId` / `employeeId`), never agent records.
 *  - Explicit supervisory grants are preserved and are the ONLY way to widen:
 *      Super Admin                       -> everything
 *      `crm.leads.manage` (no team)      -> every lead + order (company-wide)
 *      Sales Team manager                -> own + team members' records;
 *                                           + unassigned internal leads only
 *                                             when ALSO holding `crm.leads.manage`
 *      `store-orders.view_all`           -> every order (not leads)
 *  - `store-orders.manage` is NOT a scope grant (R7 review): it only unlocks
 *    actions (payment-review status, declaration corrections) on orders the
 *    caller can already see.
 *  - `shipping.view` and `finance.view` DO NOT widen the generic lists. They
 *    open, by id, only what the job needs: an order in the Shipping queue
 *    (has a shipment) / an order with payment activity (payment evidence).
 *  - Non-ALL scopes never include agent leads/orders (`agentId` is set).
 */
@Injectable()
export class SalesScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  async resolve(userId: string): Promise<SalesScope> {
    const isSuperAdmin = await this.permissions.isSuperAdmin(userId);
    const [
      canManageLeads,
      canViewLeads,
      canViewStoreOrders,
      canViewShipping,
      canEditShipping,
      canViewFinance,
      canViewSalesReceipts,
      canConfirmSalesReceipts,
      canViewAllStoreOrders,
    ] = await Promise.all([
      this.permissions.hasPermission(userId, 'crm.leads.manage'),
      this.permissions.hasPermission(userId, 'crm.leads.view'),
      this.permissions.hasPermission(userId, 'store-orders.view'),
      this.permissions.hasPermission(userId, 'shipping.view'),
      this.permissions.hasPermission(userId, 'shipping.edit'),
      this.permissions.hasPermission(userId, 'finance.view'),
      this.permissions.hasPermission(userId, 'sales.receipts.view'),
      this.permissions.hasPermission(userId, 'sales.receipts.confirm'),
      // The ONE explicit cross-owner browse grant for Store Orders. Never
      // inferred from `store-orders.manage` (held by ordinary sales staff).
      this.permissions.hasPermission(userId, 'store-orders.view_all'),
    ]);

    const canManagePaymentEvidence =
      isSuperAdmin || canViewFinance || canConfirmSalesReceipts;
    const canViewPaymentEvidence =
      canManagePaymentEvidence ||
      canViewSalesReceipts ||
      canViewLeads ||
      canManageLeads ||
      canViewAllStoreOrders;

    if (isSuperAdmin) {
      return {
        kind: 'ALL',
        ownerIds: null,
        userId,
        isSuperAdmin,
        canManageLeads: true,
        canViewLeads: true,
        canViewStoreOrders: true,
        canViewShipping: true,
        canEditShipping: true,
        canViewPaymentEvidence: true,
        canManagePaymentEvidence: true,
        canViewAllOrders: true,
        canViewTeamUnassigned: true,
      };
    }

    const shared = {
      userId,
      isSuperAdmin,
      canManageLeads,
      canViewStoreOrders,
      canViewShipping,
      canEditShipping,
      canViewPaymentEvidence,
      canManagePaymentEvidence,
    };

    const managed = await this.prisma.salesTeam.findMany({
      where: { managerId: userId, deletedAt: null, isActive: true },
      select: {
        managerId: true,
        members: { select: { userId: true } },
      },
    });

    if (managed.length > 0) {
      const ownerIds = new Set<string>([userId]);
      for (const team of managed) {
        for (const member of team.members) ownerIds.add(member.userId);
      }
      return {
        ...shared,
        kind: 'TEAM',
        ownerIds: [...ownerIds],
        canViewLeads: true,
        canViewAllOrders: canViewAllStoreOrders,
        canViewTeamUnassigned: canManageLeads,
      };
    }

    if (canManageLeads) {
      return {
        ...shared,
        kind: 'ALL',
        ownerIds: null,
        canViewLeads: true,
        canViewAllOrders: true,
        canViewTeamUnassigned: true,
      };
    }

    if (canViewLeads || canViewStoreOrders) {
      return {
        ...shared,
        kind: 'OWN',
        ownerIds: [userId],
        canViewLeads,
        canViewAllOrders: canViewAllStoreOrders,
        canViewTeamUnassigned: false,
      };
    }

    return {
      ...shared,
      kind: 'NONE',
      ownerIds: [],
      canViewLeads,
      canViewAllOrders: canViewAllStoreOrders,
      canViewTeamUnassigned: false,
    };
  }

  leadWhere(scope: SalesScope): Prisma.LeadWhereInput {
    if (scope.kind === 'ALL') return {};
    if (scope.kind === 'NONE' || !scope.ownerIds?.length) {
      return { id: { in: [] } };
    }
    const owned: Prisma.LeadWhereInput = {
      salesEmployeeId: { in: scope.ownerIds },
    };
    if (scope.kind === 'TEAM' && scope.canViewTeamUnassigned) {
      return {
        agentId: null,
        OR: [owned, { salesEmployeeId: null }],
      };
    }
    // Internal leads only — an agent's lead is never in an own/team scope.
    return { agentId: null, ...owned };
  }

  /** List/summary/search/export scope for Store Orders. */
  storeOrderWhere(scope: SalesScope): Prisma.StoreOrderWhereInput {
    if (scope.kind === 'ALL' || scope.canViewAllOrders) return {};
    if (scope.kind === 'NONE' || !scope.ownerIds?.length) {
      return { id: { in: [] } };
    }
    return { agentId: null, employeeId: { in: scope.ownerIds } };
  }

  /**
   * By-id / direct-URL rule for Store Orders. The list scope, plus the two
   * narrow job-need grants: Shipping staff may open an order that is in the
   * Shipping queue (has a shipment), payment-evidence managers an order that
   * carries payment activity. Never "any order by id".
   */
  storeOrderAccessWhere(scope: SalesScope): Prisma.StoreOrderWhereInput {
    const base = this.storeOrderWhere(scope);
    if (scope.kind === 'ALL' || scope.canViewAllOrders) return base;
    const extra: Prisma.StoreOrderWhereInput[] = [base];
    if (scope.canViewShipping) {
      extra.push({ shipments: { some: {} } });
    }
    if (scope.canManagePaymentEvidence) {
      extra.push({ payments: { some: {} } });
    }
    if (scope.kind === 'TEAM' && scope.canManageLeads) {
      extra.push({ employeeId: null, agentId: null });
    }
    return extra.length === 1 ? base : { OR: extra };
  }

  canAccessLead(
    scope: SalesScope,
    lead: { salesEmployeeId: string | null; agentId?: string | null },
  ): boolean {
    if (scope.kind === 'ALL') return true;
    if (lead.agentId) return false;
    if (!lead.salesEmployeeId) {
      return scope.kind === 'TEAM' && !!scope.canViewTeamUnassigned;
    }
    return scope.ownerIds?.includes(lead.salesEmployeeId) ?? false;
  }

  assertLeadAccess(
    scope: SalesScope,
    lead: {
      id: string;
      salesEmployeeId: string | null;
      agentId?: string | null;
    } | null,
  ) {
    if (!lead) throw new NotFoundException('Lead not found');
    if (!this.canAccessLead(scope, lead)) {
      throw new NotFoundException('Lead not found');
    }
  }

  /**
   * The single by-id gate for Store Orders: resolves only an order the caller
   * may open, or throws 404 (never 403 — existence is not disclosed).
   */
  async assertStoreOrderAccessById(
    scope: SalesScope,
    id: string,
  ): Promise<void> {
    const found = await this.prisma.storeOrder.findFirst({
      where: {
        AND: [{ id, deletedAt: null }, this.storeOrderAccessWhere(scope)],
      },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Store Order not found');
  }

  /**
   * Convenience for sub-resource controllers (activities, shipments,
   * economics, …): resolves the caller and applies the single by-id gate, so
   * no route under `/store-orders/:id/*` can disclose an order the caller
   * cannot open (R7 review finding: activities/shipments were unscoped).
   */
  async assertCanOpenStoreOrder(userId: string, id: string): Promise<void> {
    const scope = await this.resolve(userId);
    await this.assertStoreOrderAccessById(scope, id);
  }

  /** Legacy `sales-orders` (lead-converted SalesOrder) visibility. */
  legacySalesOrderWhere(scope: SalesScope): Prisma.SalesOrderWhereInput {
    if (
      scope.kind === 'ALL' ||
      scope.canViewAllOrders ||
      scope.canViewShipping
    ) {
      return {};
    }
    if (scope.kind === 'NONE' || !scope.ownerIds?.length) {
      return { id: { in: [] } };
    }
    return { salesEmployeeId: { in: scope.ownerIds } };
  }

  /**
   * `sales/orders` documents carry no sales owner, only `createdBy`. Default
   * is "documents I (or my team) created"; Super Admin / company-wide
   * supervisors and Finance (`finance.view`) keep the full register.
   */
  salesDocumentWhere(
    scope: SalesScope,
    canViewFinance: boolean,
  ): Prisma.SalesOrderDocumentWhereInput {
    if (scope.kind === 'ALL' || scope.canViewAllOrders || canViewFinance) {
      return {};
    }
    const owners = scope.ownerIds?.length ? scope.ownerIds : [scope.userId];
    return { createdBy: { in: owners } };
  }

  /**
   * Async form for HTTP layers: resolves the caller's scope and whether they
   * hold a document-supervision permission (finance.view, or approve/confirm
   * on sales orders — they act on other people's documents by design).
   */
  async salesDocumentWhereForUser(
    userId: string,
  ): Promise<Prisma.SalesOrderDocumentWhereInput> {
    const [scope, finance, approve, confirm] = await Promise.all([
      this.resolve(userId),
      this.permissions.hasPermission(userId, 'finance.view'),
      this.permissions.hasPermission(userId, 'sales.orders.approve'),
      this.permissions.hasPermission(userId, 'sales.orders.confirm'),
    ]);
    return this.salesDocumentWhere(scope, finance || approve || confirm);
  }

  /** Manual assign/reassign — Agents (OWN) and Shipping (NONE) are denied. */
  assertCanAssign(scope: SalesScope) {
    if (scope.kind === 'ALL' || scope.kind === 'TEAM') return;
    throw new ForbiddenException('You are not allowed to assign Leads.');
  }

  canAssignLeads(scope: SalesScope): boolean {
    return scope.kind === 'ALL' || scope.kind === 'TEAM';
  }

  canSetOrderOwner(scope: SalesScope, targetEmployeeId: string): boolean {
    if (scope.kind === 'ALL') return true;
    if (scope.kind === 'TEAM') {
      return scope.ownerIds?.includes(targetEmployeeId) ?? false;
    }
    return targetEmployeeId === scope.userId;
  }

  /**
   * Payment receipts are financial evidence. Shipping visibility of an
   * Order does not grant receipt access.
   */
  canAccessPaymentEvidence(
    scope: SalesScope,
    order: { employeeId: string | null },
  ): boolean {
    if (!scope.canViewPaymentEvidence) return false;
    if (
      scope.canManagePaymentEvidence ||
      scope.kind === 'ALL' ||
      scope.canViewAllOrders
    ) {
      return true;
    }
    if (!order.employeeId) {
      return scope.kind === 'TEAM' || scope.canManageLeads;
    }
    return scope.ownerIds?.includes(order.employeeId) ?? false;
  }

  assertPaymentEvidenceAccess(
    scope: SalesScope,
    order: { id: string; employeeId: string | null } | null,
  ) {
    if (!order) throw new NotFoundException('Store Order not found');
    if (!this.canAccessPaymentEvidence(scope, order)) {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
    }
  }
}
