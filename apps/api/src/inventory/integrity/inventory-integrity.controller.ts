import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { canViewInventoryCost } from '../inventory-cost-access';
import { INVENTORY_COST_PERMISSIONS } from '../inventory-cost-visibility';
import { InventoryIntegrityService } from './inventory-integrity.service';
import { IntegrityQueryDto } from './dto/integrity-query.dto';

/**
 * R13 — `GET /inventory/integrity` (api-contract §5): invariants I1–I7.
 * Read-only. Needs `inventory.view` (PermissionsGuard, class-level module)
 * AND the inventory cost-visibility right used by the stock cards
 * (`INVENTORY_COST_PERMISSIONS`) — the report carries valuation and GL
 * figures, so quantities-only users are refused (403), not redacted.
 */
@Controller('inventory/integrity')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('inventory')
export class InventoryIntegrityController {
  constructor(
    private readonly integrity: InventoryIntegrityService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  @Get()
  async run(
    @Query() query: IntegrityQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!(await canViewInventoryCost(this.permissions, user.sub))) {
      throw new ForbiddenException({
        code: 'INVENTORY_INTEGRITY_FORBIDDEN',
        message: `The integrity report shows valuation and GL figures — it needs one of: ${INVENTORY_COST_PERMISSIONS.join(', ')}.`,
      });
    }
    return this.integrity.run({
      productIds: query.productIds,
      warehouseId: query.warehouseId,
    });
  }
}
