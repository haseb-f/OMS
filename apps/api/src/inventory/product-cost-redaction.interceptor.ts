import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { canViewInventoryCost } from './inventory-cost-access';
import { redactProductCostDeep } from './inventory-cost-visibility';

/**
 * R13 S3 — a product's ACTUAL cost (`currentCost` moving average,
 * `lastCostUpdate`) is inventory valuation: a caller without cost visibility
 * (`canViewInventoryCost`, the stock-card rule) gets it `null` wherever the
 * response carries it — the product endpoints themselves and every document
 * whose lines embed the product. Applied per controller with
 * `@UseInterceptors(ProductCostRedactionInterceptor)`; runs after the guards
 * (the caller is authenticated by then).
 */
@Injectable()
export class ProductCostRedactionInterceptor implements NestInterceptor {
  constructor(private readonly permissions: PermissionsResolverService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload }>().user;
    const sees = user
      ? await canViewInventoryCost(this.permissions, user.sub)
      : false;
    return sees
      ? next.handle()
      : next.handle().pipe(map(redactProductCostDeep));
  }
}
