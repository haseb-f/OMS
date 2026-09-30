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
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StoreOrdersService } from '../store-orders.service';
import { StoreOrderAmendmentsService } from './store-order-amendments.service';
import {
  AmendmentCommitDto,
  AmendmentPreviewDto,
} from './dto/amend-store-order.dto';

/**
 * Round 5 Spec 1A — guided amendment of a Store Order (`store-orders.amend`):
 * preview the impacts (no writes), then commit with the previewed version,
 * a reason and the acknowledgements.
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrderAmendmentsController {
  constructor(
    private readonly amendments: StoreOrderAmendmentsService,
    private readonly storeOrders: StoreOrdersService,
  ) {}

  @Post(':id/amendments/preview')
  @HttpCode(200)
  @PermissionAction('amend')
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmendmentPreviewDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.amendments.preview(id, dto.changes, { userId: user.sub });
  }

  @Post(':id/amendments')
  @PermissionAction('amend')
  async commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmendmentCommitDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.amendments.commit(id, dto, { userId: user.sub });
    return { ...result, order: await this.storeOrders.findOne(id, user.sub) };
  }

  @Get(':id/amendments')
  @PermissionAction('view')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.amendments.list(id, { userId: user.sub });
  }
}
