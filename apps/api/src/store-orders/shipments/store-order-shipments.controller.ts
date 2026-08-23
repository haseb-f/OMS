import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { StoreOrderShipmentOperationsService } from './store-order-shipment-operations.service';
import { AssignShippingCompanyDto } from './dto/assign-shipping-company.dto';
import { AddTrackingNumberDto } from './dto/add-tracking-number.dto';
import { SetLabelDto } from './dto/set-label.dto';
import { AddShippingCostDto } from './dto/add-shipping-cost.dto';
import {
  AddShipmentNotesDto,
  resolveShipmentNotes,
} from './dto/add-shipment-notes.dto';

/**
 * Per-order shipment operations — copies the exact operational shape of
 * the legacy `sales-orders/shipments` controller, but for the Store Orders
 * pipeline's 6 usable ShipmentStatus values.
 */
@Controller('store-orders/:storeOrderId/shipments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('shipping')
export class StoreOrderShipmentsController {
  constructor(
    private readonly operations: StoreOrderShipmentOperationsService,
  ) {}

  @Get()
  findAll(@Param('storeOrderId') storeOrderId: string) {
    return this.operations.findAllForOrder(storeOrderId);
  }

  @Post('shipping-company')
  @HttpCode(200)
  @PermissionAction('edit')
  assignShippingCompany(
    @Param('storeOrderId') storeOrderId: string,
    @Body() dto: AssignShippingCompanyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.assignShippingCompany(
      storeOrderId,
      dto.shippingCompanyId,
      user.sub,
    );
  }

  @Post('tracking-number')
  @HttpCode(200)
  @PermissionAction('edit')
  addTrackingNumber(
    @Param('storeOrderId') storeOrderId: string,
    @Body() dto: AddTrackingNumberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.addTrackingNumber(
      storeOrderId,
      dto.trackingNumber,
      user.sub,
    );
  }

  @Post('label')
  @PermissionAction('edit')
  setLabel(
    @Param('storeOrderId') storeOrderId: string,
    @Body() dto: SetLabelDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.setLabel(storeOrderId, dto.fileUrl, user.sub);
  }

  @Post('ship')
  @HttpCode(200)
  @PermissionAction('edit')
  markShipped(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.markShipped(storeOrderId, user.sub);
  }

  @Post('out-for-delivery')
  @HttpCode(200)
  @PermissionAction('edit')
  markOutForDelivery(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.markOutForDelivery(storeOrderId, user.sub);
  }

  @Post('deliver')
  @HttpCode(200)
  @PermissionAction('edit')
  markDelivered(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.markDelivered(storeOrderId, user.sub);
  }

  @Post('delivery-failed')
  @HttpCode(200)
  @PermissionAction('edit')
  markDeliveryFailed(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.markDeliveryFailed(storeOrderId, user.sub);
  }

  @Post('needs-reshipment')
  @HttpCode(200)
  @PermissionAction('edit')
  markNeedsReshipment(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.markNeedsReshipment(storeOrderId, user.sub);
  }

  @Post('reship')
  @PermissionAction('manage')
  createReshipment(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.createReshipment(storeOrderId, user.sub);
  }

  @Post('shipping-cost')
  @HttpCode(200)
  @PermissionAction('edit')
  addShippingCost(
    @Param('storeOrderId') storeOrderId: string,
    @Body() dto: AddShippingCostDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.addShippingCost(
      storeOrderId,
      {
        baseShippingCost: dto.baseShippingCost ?? dto.shippingCost,
        additionalShippingCost: dto.additionalShippingCost,
        costPaidBy: dto.costPaidBy ?? 'CUSTOMER',
        notes: dto.notes,
      },
      user.sub,
    );
  }

  @Post('notes')
  @PermissionAction('edit')
  addNotes(
    @Param('storeOrderId') storeOrderId: string,
    @Body() dto: AddShipmentNotesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.addNotes(
      storeOrderId,
      resolveShipmentNotes(dto),
      user.sub,
    );
  }
}
