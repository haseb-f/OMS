import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CustomerHistoryService } from './customer-history.service';

/**
 * Round 14 (W4) — customer history and the repeat-customer numbers. Internal
 * only: no `@AgentPortal()` opt-in, so `JwtAuthGuard` denies agent tokens.
 * The Customers pages are governed by the `partners` permission module (one
 * canonical counterparty registry), so "customers.view" is `partners.view`.
 */
@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('partners')
export class CustomerHistoryController {
  constructor(private readonly service: CustomerHistoryService) {}

  @Get(':partnerId/history')
  @PermissionAction('view')
  history(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.history(user.sub, partnerId);
  }

  /** `partners.view`, or scope over one of the customer's orders/leads — checked in the service. */
  @Get(':partnerId/order-stats')
  @SkipPermissionCheck()
  orderStats(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.orderStats(user.sub, partnerId);
  }
}
