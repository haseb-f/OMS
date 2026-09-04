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
}

/**
 * Single authorization resolver for CRM Lead + StoreOrder sales ownership.
 * Team Managers are scoped to teams they manage even if they also hold
 * `crm.leads.manage`. Super Admin always sees everything.
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
    ] = await Promise.all([
      this.permissions.hasPermission(userId, 'crm.leads.manage'),
      this.permissions.hasPermission(userId, 'crm.leads.view'),
      this.permissions.hasPermission(userId, 'store-orders.view'),
      this.permissions.hasPermission(userId, 'shipping.view'),
      this.permissions.hasPermission(userId, 'shipping.edit'),
    ]);

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
      };
    }

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
        kind: 'TEAM',
        ownerIds: [...ownerIds],
        userId,
        isSuperAdmin,
        canManageLeads: canManageLeads || true,
        canViewLeads: true,
        canViewStoreOrders,
        canViewShipping,
        canEditShipping,
      };
    }

    if (canManageLeads) {
      return {
        kind: 'ALL',
        ownerIds: null,
        userId,
        isSuperAdmin,
        canManageLeads,
        canViewLeads: true,
        canViewStoreOrders,
        canViewShipping,
        canEditShipping,
      };
    }

    if (canViewLeads || canViewStoreOrders) {
      return {
        kind: 'OWN',
        ownerIds: [userId],
        userId,
        isSuperAdmin,
        canManageLeads,
        canViewLeads,
        canViewStoreOrders,
        canViewShipping,
        canEditShipping,
      };
    }

    return {
      kind: canViewShipping ? 'NONE' : 'NONE',
      ownerIds: [],
      userId,
      isSuperAdmin,
      canManageLeads,
      canViewLeads,
      canViewStoreOrders,
      canViewShipping,
      canEditShipping,
    };
  }

  leadWhere(scope: SalesScope): Prisma.LeadWhereInput {
    if (scope.kind === 'ALL') return {};
    if (scope.kind === 'NONE' || !scope.ownerIds?.length) {
      return { id: { in: [] } };
    }
    if (scope.kind === 'TEAM') {
      return {
        OR: [
          { salesEmployeeId: { in: scope.ownerIds } },
          { salesEmployeeId: null },
        ],
      };
    }
    return { salesEmployeeId: { in: scope.ownerIds } };
  }

  storeOrderWhere(scope: SalesScope): Prisma.StoreOrderWhereInput {
    if (scope.canViewShipping) return {};
    if (scope.kind === 'ALL') return {};
    if (scope.kind === 'NONE' || !scope.ownerIds?.length) {
      return { id: { in: [] } };
    }
    return { employeeId: { in: scope.ownerIds } };
  }

  canAccessLead(
    scope: SalesScope,
    lead: { salesEmployeeId: string | null },
  ): boolean {
    if (scope.kind === 'ALL') return true;
    if (!lead.salesEmployeeId) {
      return scope.kind === 'TEAM';
    }
    return scope.ownerIds?.includes(lead.salesEmployeeId) ?? false;
  }

  canAccessStoreOrder(
    scope: SalesScope,
    order: { employeeId: string | null },
  ): boolean {
    if (scope.canViewShipping || scope.kind === 'ALL') return true;
    if (!order.employeeId) return scope.kind === 'TEAM' || scope.canManageLeads;
    return scope.ownerIds?.includes(order.employeeId) ?? false;
  }

  assertLeadAccess(
    scope: SalesScope,
    lead: { id: string; salesEmployeeId: string | null } | null,
  ) {
    if (!lead) throw new NotFoundException('Lead not found');
    if (!this.canAccessLead(scope, lead)) {
      throw new NotFoundException('Lead not found');
    }
  }

  assertStoreOrderAccess(
    scope: SalesScope,
    order: { id: string; employeeId: string | null } | null,
  ) {
    if (!order) throw new NotFoundException('Store Order not found');
    if (!this.canAccessStoreOrder(scope, order)) {
      throw new NotFoundException('Store Order not found');
    }
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
}
