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
import { SalesQuotationsService } from './sales-quotations.service';
import { CreateSalesQuotationDto } from './dto/create-sales-quotation.dto';
import { UpdateSalesQuotationDto } from './dto/update-sales-quotation.dto';
import { FindSalesQuotationsQueryDto } from './dto/find-sales-quotations-query.dto';
import { SalesOrdersService } from '../orders/sales-orders.service';
import { ConvertQuotationToOrderDto } from '../orders/dto/convert-quotation-to-order.dto';

/** Business operations only: Create, Update, Submit, Approve, Cancel, Archive, Convert-to-Order, Search, Details. */
@Controller('sales/quotations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-quotations')
export class SalesQuotationsController {
  constructor(
    private readonly quotationsService: SalesQuotationsService,
    private readonly ordersService: SalesOrdersService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateSalesQuotationDto,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.quotationsService.create(dto, context);
  }

  @Get()
  findAll(@Query() query: FindSalesQuotationsQueryDto) {
    return this.quotationsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotationsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalesQuotationDto) {
    return this.quotationsService.update(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @SkipPermissionCheck()
  submit(@Param('id') id: string) {
    return this.quotationsService.submit(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string) {
    return this.quotationsService.approve(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.quotationsService.cancel(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.quotationsService.archive(id, user.sub);
  }

  @Post(':id/convert-to-order')
  @HttpCode(200)
  @SkipPermissionCheck()
  convertToOrder(
    @Param('id') id: string,
    @Body() dto: ConvertQuotationToOrderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.createFromQuotation(id, dto, user.sub);
  }
}
