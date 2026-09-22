import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FinancialTransactionType } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import {
  CurrentCompanyContext,
  type CompanyContext,
} from '../../common/decorators/current-company-context.decorator';
import { FinancialTransactionsService } from '../financial-transactions.service';
import { CreateCustomerRefundDto } from './dto/create-customer-refund.dto';
import { UpdateCustomerRefundDto } from './dto/update-customer-refund.dto';
import { FindCustomerRefundsQueryDto } from './dto/find-customer-refunds-query.dto';

const TYPE = FinancialTransactionType.CUSTOMER_REFUND;

/**
 * Customer Refund (رد مبلغ لعميل) — the same FinancialTransaction voucher
 * workflow as Customer Receipts (Create, Update, Confirm, Cancel, Archive,
 * Search, Details) with money flowing out, allocated to posted Sales
 * Returns instead of invoices. The allocation is fixed at creation: there
 * is no Allocate/Unallocate on a refund.
 */
@Controller('financial-transactions/refunds')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customer-refunds')
export class CustomerRefundsController {
  constructor(private readonly transactions: FinancialTransactionsService) {}

  @Post()
  create(
    @Body() dto: CreateCustomerRefundDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.create(TYPE, dto, user.sub, context);
  }

  /** Create + Confirm + Post in ONE database transaction — nothing is left behind if posting fails. */
  @Post('confirmed')
  @PermissionAction('confirm')
  createConfirmed(
    @Body() dto: CreateCustomerRefundDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.createConfirmed(TYPE, dto, user.sub, context);
  }

  @Get()
  findAll(@Query() query: FindCustomerRefundsQueryDto) {
    return this.transactions.findAll(TYPE, query);
  }

  /** Posted Sales Returns of this customer that still have money to refund — registered before `:id`. */
  @Get('open-returns')
  getOpenReturns(@Query('partnerId', ParseUUIDPipe) partnerId: string) {
    return this.transactions.listRefundableReturns(partnerId);
  }

  /** Refundable position of one Sales Return — prefills the Refund action. */
  @Get('refundable/:salesReturnId')
  getRefundable(@Param('salesReturnId', ParseUUIDPipe) salesReturnId: string) {
    return this.transactions.getRefundableReturn(salesReturnId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactions.findOne(TYPE, id);
  }

  @Get(':id/activities')
  activities(@Param('id') id: string) {
    return this.transactions.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerRefundDto,
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
}
