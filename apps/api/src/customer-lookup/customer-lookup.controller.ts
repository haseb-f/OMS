import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CustomerLookupService } from './customer-lookup.service';
import { AdvancedCustomerLookupDto } from './dto/advanced-customer-lookup.dto';

/**
 * Advanced customer lookup (R7). Gated by `customers.lookup_advanced` only —
 * no other permission implies it. Agent users never reach it: this controller
 * has no `@AgentPortal()` opt-in, so `JwtAuthGuard` denies agent tokens by
 * default. POST so the searched phone/name never lands in URLs or access logs.
 */
@Controller('customer-lookup')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('partners')
export class CustomerLookupController {
  constructor(private readonly service: CustomerLookupService) {}

  @Post('advanced')
  @HttpCode(200)
  @PermissionAction('lookup_advanced')
  advanced(
    @Body() dto: AdvancedCustomerLookupDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.lookup(user.sub, dto.query);
  }
}
