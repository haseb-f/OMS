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
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { UpdatePurchaseInvoiceDto } from './dto/update-purchase-invoice.dto';
import { FindPurchaseInvoicesQueryDto } from './dto/find-purchase-invoices-query.dto';

/**
 * Business operations only: Create, Update, Submit, Approve, Cancel,
 * Confirm (Goods Receipt), Archive, Search, Details. "Convert to Invoice"
 * itself lives on PurchaseOrdersController (the source document), same as
 * Sales' Order→Invoice conversion.
 */
@Controller('purchasing/invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('purchase-invoices')
export class PurchaseInvoicesController {
  constructor(private readonly invoicesService: PurchaseInvoicesService) {}

  @Post()
  create(
    @Body() dto: CreatePurchaseInvoiceDto,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.invoicesService.create(dto, context);
  }

  @Get()
  findAll(@Query() query: FindPurchaseInvoicesQueryDto) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseInvoiceDto) {
    return this.invoicesService.update(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @SkipPermissionCheck()
  submit(@Param('id') id: string) {
    return this.invoicesService.submit(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string) {
    return this.invoicesService.approve(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.cancel(id, user.sub);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.confirm(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.archive(id, user.sub);
  }
}
