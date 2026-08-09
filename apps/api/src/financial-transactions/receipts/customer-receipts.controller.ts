import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FinancialTransactionType } from '@prisma/client';
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
import { FinancialTransactionsService } from '../financial-transactions.service';
import { AllocationInputDto } from '../shared/allocation-input.dto';
import { CreateCustomerReceiptDto } from './dto/create-customer-receipt.dto';
import { UpdateCustomerReceiptDto } from './dto/update-customer-receipt.dto';
import { FindCustomerReceiptsQueryDto } from './dto/find-customer-receipts-query.dto';

const TYPE = FinancialTransactionType.CUSTOMER_RECEIPT;

/** Business operations only: Create, Update, Confirm, Cancel, Archive, Allocate, Unallocate, Search, Open Invoices, Details. */
@Controller('financial-transactions/receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customer-receipts')
export class CustomerReceiptsController {
  constructor(private readonly transactions: FinancialTransactionsService) {}

  @Post()
  create(
    @Body() dto: CreateCustomerReceiptDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.create(TYPE, dto, user.sub, context);
  }

  @Get()
  findAll(@Query() query: FindCustomerReceiptsQueryDto) {
    return this.transactions.findAll(TYPE, query);
  }

  /** Open Sales Invoices for the Allocation Grid / "Pay All Remaining" — must be registered before `:id`. */
  @Get('open-invoices')
  getOpenInvoices(@Query('customerId') customerId: string) {
    return this.transactions.getOpenInvoices(TYPE, customerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactions.findOne(TYPE, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerReceiptDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactions.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.transactions.remove(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.transactions.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.transactions.cancel(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.transactions.archive(id, user.sub);
  }

  @Post(':id/allocate')
  @HttpCode(200)
  @SkipPermissionCheck()
  allocate(
    @Param('id') id: string,
    @Body() dto: AllocationInputDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactions.allocate(id, dto, user.sub);
  }

  @Post(':id/allocations/:allocationId/unallocate')
  @HttpCode(200)
  @SkipPermissionCheck()
  unallocate(
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transactions.unallocate(id, allocationId, user.sub);
  }
}
