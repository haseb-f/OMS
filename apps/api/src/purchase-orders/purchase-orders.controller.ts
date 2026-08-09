import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import {
  CurrentCompanyContext,
  type CompanyContext,
} from '../common/decorators/current-company-context.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';
import { ConvertPurchaseOrderToInvoiceDto } from './dto/convert-purchase-order-to-invoice.dto';

/** Business operations only: Create, Update, Approve, Cancel, Close, Archive, Convert-to-Invoice, Search, Details, Timeline. */
@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.purchaseOrdersService.create(dto, context);
  }

  @Get()
  findAll(@Query() query: FindPurchaseOrdersQueryDto) {
    return this.purchaseOrdersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrdersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseOrdersService.update(id, dto, user.sub);
  }

  @Post(':id/approve')
  @PermissionAction('approve')
  approve(@Param('id') id: string) {
    return this.purchaseOrdersService.approve(id);
  }

  @Post(':id/cancel')
  @PermissionAction('cancel')
  cancel(@Param('id') id: string) {
    return this.purchaseOrdersService.cancel(id);
  }

  @Post(':id/close')
  @SkipPermissionCheck()
  close(@Param('id') id: string) {
    return this.purchaseOrdersService.close(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchaseOrdersService.archive(id, user.sub);
  }

  /** Every PO line converts as-is (Goods Receipt) — only a destination warehouse is asked for. */
  @Post(':id/convert-to-invoice')
  @HttpCode(200)
  @SkipPermissionCheck()
  convertToInvoice(
    @Param('id') id: string,
    @Body() dto: ConvertPurchaseOrderToInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseOrdersService.convertToInvoice(id, dto, user.sub);
  }
}
