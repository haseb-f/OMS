import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreOrderShipmentsService } from './store-order-shipments.service';
import { StoreOrderShipmentOperationsService } from './store-order-shipment-operations.service';
import { FindShipmentsQueryDto } from './dto/find-shipments-query.dto';
import { BulkUpdateShipmentsDto } from './dto/bulk-update-shipments.dto';

/** Flat, cross-order Shipping list page — `GET /shipping`, not nested under any one Store Order. */
@Controller('shipping')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('shipping')
export class ShippingController {
  constructor(
    private readonly shipmentsService: StoreOrderShipmentsService,
    private readonly operations: StoreOrderShipmentOperationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  findAll(@Query() query: FindShipmentsQueryDto) {
    return this.shipmentsService.findAllFlat(query);
  }

  /** Dynamic shipping-status catalog — database is the source of truth. */
  @Get('statuses')
  async listStatuses() {
    const statuses = await this.prisma.shippingStatus.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return statuses.map((status) => ({
      id: status.id,
      code: status.code,
      label: status.name,
      color: status.color,
      isDefault: status.isDefault,
      isSystem: status.isSystem,
      importable: status.isImportable,
    }));
  }

  /** "Select all matching filters" — bare IDs only, same filter/search as `findAll`. */
  @Get('ids')
  findAllIds(@Query() query: FindShipmentsQueryDto) {
    return this.shipmentsService.findAllFlatIds(query);
  }

  @Post('bulk-update')
  @HttpCode(200)
  @PermissionAction('manage')
  bulkUpdate(
    @Body() dto: BulkUpdateShipmentsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.bulkUpdateStatus(
      dto.shipmentIds,
      dto.targetStatus,
      user.sub,
    );
  }
}
