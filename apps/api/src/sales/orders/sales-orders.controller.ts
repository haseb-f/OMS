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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import {
  CurrentCompanyContext,
  type CompanyContext,
} from '../../common/decorators/current-company-context.decorator';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { FindSalesOrdersQueryDto } from './dto/find-sales-orders-query.dto';
import { ConvertOrderToInvoiceDto } from './dto/convert-order-to-invoice.dto';

/** Business operations only: Create, Update, Submit, Approve, Confirm (Reserve Inventory), Cancel, Archive, Convert-to-Invoice, Search, Details. */
@Controller('sales/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-orders')
export class SalesOrdersController {
  constructor(private readonly ordersService: SalesOrdersService) {}

  @Post()
  create(
    @Body() dto: CreateSalesOrderDto,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.ordersService.create(dto, context);
  }

  @Get()
  findAll(@Query() query: FindSalesOrdersQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.ordersService.update(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @SkipPermissionCheck()
  submit(@Param('id') id: string) {
    return this.ordersService.submit(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string) {
    return this.ordersService.approve(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.cancel(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.archive(id, user.sub);
  }

  @Post(':id/convert-to-invoice')
  @HttpCode(200)
  @SkipPermissionCheck()
  convertToInvoice(
    @Param('id') id: string,
    @Body() dto: ConvertOrderToInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.convertToInvoice(id, dto, user.sub);
  }
}
