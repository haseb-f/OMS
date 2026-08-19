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
import { SHIPPING_STATUS_CATALOG } from '../../shipping/shipping-status.catalog';
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
  ) {}

  @Get()
  findAll(@Query() query: FindShipmentsQueryDto) {
    return this.shipmentsService.findAllFlat(query);
  }

  /** Canonical shipping-status vocabulary — closed catalog, not a CRUD table. */
  @Get('statuses')
  listStatuses() {
    return SHIPPING_STATUS_CATALOG.map((status) => ({
      code: status.code,
      label: status.label,
      isDefault: status.isDefault,
      isSystem: status.isSystem,
      importable: status.importable,
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
