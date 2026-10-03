import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';

/**
 * R7 — a `sales/orders` document addressed by id (`:id` routes) opens only if
 * it is inside the caller's owner scope (404 otherwise). Runs after
 * `JwtAuthGuard` + `PermissionsGuard`; list/ids routes are scoped by the
 * controller through `SalesScopeService.salesDocumentWhereForUser`.
 */
@Injectable()
export class SalesOrderDocumentScopeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const params = request.params as Record<string, string | undefined>;
    const id = params.id;
    // Static routes ('ids', 'bulk-archive') carry no document id here.
    if (!id || id === 'ids' || id === 'bulk-archive') return true;
    const userId = request.user?.sub;
    if (!userId) throw new NotFoundException('Sales Order not found');
    const where = await this.salesScope.salesDocumentWhereForUser(userId);
    const found = await this.prisma.salesOrderDocument.findFirst({
      where: { AND: [{ id }, where] },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Sales Order not found');
    return true;
  }
}
