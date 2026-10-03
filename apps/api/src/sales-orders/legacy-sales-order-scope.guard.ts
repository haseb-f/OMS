import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/**
 * R7 — owner scope for the legacy `sales-orders` family (lead-converted Sales
 * Orders and their notes / activities / attachments / shipments / history).
 * These routes only had `JwtAuthGuard`: any signed-in internal user could list
 * or open every order. Now, after `JwtAuthGuard`:
 *  - a route addressing one order opens only an order in the caller's scope
 *    (404 otherwise — existence is not disclosed);
 *  - creating one needs a Lead the caller can access;
 *  - the list route needs sales/shipping visibility (the service scopes rows).
 * Agent tokens never get here (`JwtAuthGuard` denies them by default).
 */
@Injectable()
export class LegacySalesOrderScopeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const userId = request.user?.sub;
    if (!userId) throw new ForbiddenException();
    const scope = await this.salesScope.resolve(userId);

    const params = request.params as Record<string, string | undefined>;
    const orderId = params.id ?? params.salesOrderId;
    if (orderId) {
      const found = await this.prisma.salesOrder.findFirst({
        where: {
          AND: [
            { id: orderId, deletedAt: null },
            this.salesScope.legacySalesOrderWhere(scope),
          ],
        },
        select: { id: true },
      });
      if (!found) throw new NotFoundException('Sales Order not found');
      return true;
    }

    if (request.method === 'POST') {
      const body = request.body as { leadId?: string } | undefined;
      const lead = body?.leadId
        ? await this.prisma.lead.findFirst({
            where: { id: body.leadId, deletedAt: null },
            select: { id: true, salesEmployeeId: true, agentId: true },
          })
        : null;
      // Unknown lead falls through to the service's own validation error;
      // an existing lead the caller cannot access is a 404.
      if (lead) this.salesScope.assertLeadAccess(scope, lead);
      return true;
    }

    if (scope.kind === 'NONE' && !scope.canViewShipping) {
      throw new ForbiddenException('You are not allowed to view Sales Orders.');
    }
    return true;
  }
}
