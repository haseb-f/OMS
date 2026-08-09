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
import { PurchaseQuotationsService } from './purchase-quotations.service';
import { CreatePurchaseQuotationDto } from './dto/create-purchase-quotation.dto';
import { UpdatePurchaseQuotationDto } from './dto/update-purchase-quotation.dto';
import { FindPurchaseQuotationsQueryDto } from './dto/find-purchase-quotations-query.dto';
import { PurchaseOrdersService } from '../../purchase-orders/purchase-orders.service';

/** Business operations only: Create, Update, Submit, Approve, Cancel, Archive, Convert-to-Order, Search, Details. */
@Controller('purchasing/quotations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('purchase-quotations')
export class PurchaseQuotationsController {
  constructor(
    private readonly quotationsService: PurchaseQuotationsService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
  ) {}

  @Post()
  create(
    @Body() dto: CreatePurchaseQuotationDto,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.quotationsService.create(dto, context);
  }

  @Get()
  findAll(@Query() query: FindPurchaseQuotationsQueryDto) {
    return this.quotationsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotationsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseQuotationDto) {
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

  /** No body required — the whole quotation converts as-is (see PurchaseOrdersService.createFromQuotation). */
  @Post(':id/convert-to-order')
  @HttpCode(200)
  @SkipPermissionCheck()
  convertToOrder(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchaseOrdersService.createFromQuotation(id, user.sub);
  }
}
