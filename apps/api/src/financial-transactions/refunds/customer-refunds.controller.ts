import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { FinancialTransactionsService } from '../financial-transactions.service';
import { CreateCustomerRefundDto } from './dto/create-customer-refund.dto';
import { UpdateCustomerRefundDto } from './dto/update-customer-refund.dto';
import { FindCustomerRefundsQueryDto } from './dto/find-customer-refunds-query.dto';
import { RecordStoreOrderRefundDto } from './dto/record-store-order-refund.dto';
import { StoreOrderRefundsService } from './store-order-refunds.service';

const TYPE = FinancialTransactionType.CUSTOMER_REFUND;

/**
 * Customer Refund (رد مبلغ لعميل) — the same FinancialTransaction voucher
 * workflow as Customer Receipts (Create, Update, Confirm, Cancel, Archive,
 * Search, Details) with money flowing out, allocated to posted Sales
 * Returns — or (R15) to a store order's verified, not-invoiced advance —
 * instead of invoices. The allocation is fixed at creation: there is no
 * Allocate/Unallocate on a refund.
 */
@Controller('financial-transactions/refunds')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customer-refunds')
export class CustomerRefundsController {
  constructor(
    private readonly transactions: FinancialTransactionsService,
    private readonly storeOrderRefunds: StoreOrderRefundsService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /** R15 — the customer's store orders (cancelled ones included) with money to refund now. */
  @Get('open-orders')
  getOpenOrders(@Query('partnerId', ParseUUIDPipe) partnerId: string) {
    return this.storeOrderRefunds.openOrders(partnerId);
  }

  /** R15 — refund due / refundable of one store order (prefills "Record refund"). */
  @Get('store-orders/:storeOrderId')
  getOrderRefundable(
    @Param('storeOrderId', ParseUUIDPipe) storeOrderId: string,
  ) {
    return this.storeOrderRefunds.refundable(storeOrderId);
  }

  /**
   * R15 (D15-11) — "Record refund" of a store order: create + confirm + post
   * one Customer Refund for money already returned (no gateway integration).
   * Needs `sales.refunds.create` AND `sales.refunds.confirm`.
   */
  @Post('store-orders/:storeOrderId')
  @HttpCode(200)
  @PermissionAction('confirm')
  async recordOrderRefund(
    @Param('storeOrderId', ParseUUIDPipe) storeOrderId: string,
    @Body() dto: RecordStoreOrderRefundDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    if (
      !(await this.permissions.hasPermission(user.sub, 'sales.refunds.create'))
    ) {
      throw new ForbiddenException(
        'Missing permission "sales.refunds.create".',
      );
    }
    return this.storeOrderRefunds.record(storeOrderId, dto, user.sub, context);
  }

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
