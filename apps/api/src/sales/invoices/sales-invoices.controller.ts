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
import { SalesInvoicesService } from './sales-invoices.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { UpdateSalesInvoiceDto } from './dto/update-sales-invoice.dto';
import { FindSalesInvoicesQueryDto } from './dto/find-sales-invoices-query.dto';

/** Business operations only: Create, Update, Submit, Approve, Confirm (Reduce Inventory), Cancel, Archive, Search, Details. */
@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-invoices')
export class SalesInvoicesController {
  constructor(private readonly invoicesService: SalesInvoicesService) {}

  @Post()
  create(
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.invoicesService.create(dto, context);
  }

  @Get()
  findAll(@Query() query: FindSalesInvoicesQueryDto) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(id);
  }

  @Get(':id/posting-preview')
  buildPostingPreview(@Param('id') id: string) {
    return this.invoicesService.buildPostingPreview(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalesInvoiceDto) {
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

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.cancel(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.archive(id, user.sub);
  }
}
