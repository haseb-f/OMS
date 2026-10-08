import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { StoreOrderReturnsService } from './store-order-returns.service';
import {
  ReceiveStoreOrderReturnDto,
  RequestStoreOrderReturnDto,
} from './dto/store-order-return.dto';

/**
 * R15 (D15-10) — returns of a store order's delivered goods. Viewing needs
 * `store-orders.view`; requesting a return `sales.returns.create`; receiving
 * and inspecting (stock + credit note) `sales.returns.confirm`.
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrderReturnsController {
  constructor(private readonly returns: StoreOrderReturnsService) {}

  @Get(':id/returns')
  @PermissionAction('view')
  overview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.returns.overview(id, user.sub);
  }

  @Post(':id/returns')
  @PermissionModule('sales-returns')
  @PermissionAction('create')
  request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestStoreOrderReturnDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.returns.request(id, dto, user.sub);
  }

  @Post(':id/returns/:returnId/receive')
  @HttpCode(200)
  @PermissionModule('sales-returns')
  @PermissionAction('confirm')
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('returnId', ParseUUIDPipe) returnId: string,
    @Body() dto: ReceiveStoreOrderReturnDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.returns.receive(id, returnId, dto, user.sub);
  }
}
