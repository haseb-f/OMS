import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CashFlowDirection } from '@prisma/client';
import { BankTransactionsService } from './bank-transactions.service';
import { CashFlowReconciliationService } from './cash-flow-reconciliation.service';
import { FindBankTransactionsQueryDto } from './dto/find-bank-transactions-query.dto';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { ConfirmStoreOrderPaymentDto } from './dto/confirm-store-order-payment.dto';
import { ConfirmInvoiceAllocationDto } from './dto/confirm-invoice-allocation.dto';
import { ClassifyOutgoingDto } from './dto/classify-outgoing.dto';
import { ConfirmExpenseVoucherDto } from './dto/confirm-expense-voucher.dto';
import { BulkCashFlowIdsDto } from './dto/bulk-cash-flow-ids.dto';
import { BulkClassifyOutgoingDto } from './dto/bulk-classify-outgoing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import {
  CurrentCompanyContext,
  type CompanyContext,
} from '../common/decorators/current-company-context.decorator';

/**
 * Cash Flow — Bank Transaction review + reconciliation (Part 10, extended
 * per the Cash Flow module spec). Every write action here is gated behind
 * `accounting.bank-transactions.manage` — the same single permission that
 * already covered "reviewing and reconciling bank transactions" before
 * this module, never a new permission auto-granted (spec section 21).
 */
@Controller('bank-transactions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('bank-transactions')
export class BankTransactionsController {
  constructor(
    private readonly bankTransactions: BankTransactionsService,
    private readonly reconciliation: CashFlowReconciliationService,
  ) {}

  @Get()
  findAll(@Query() query: FindBankTransactionsQueryDto) {
    return this.bankTransactions.findAll(query);
  }

  @Get('status-counts')
  statusCounts(@Query('direction') direction?: CashFlowDirection) {
    return this.bankTransactions.statusCounts(direction);
  }

  @Get('cash-flow-summary')
  summary() {
    return this.reconciliation.getSummary();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bankTransactions.findOne(id);
  }

  /** Legacy COD Payment match — Part 10, unchanged. */
  @Post('run-matching')
  @PermissionAction('manage')
  runMatching() {
    return this.bankTransactions.runMatching();
  }

  @Post(':id/confirm-match')
  @PermissionAction('manage')
  confirmMatch(
    @Param('id') id: string,
    @Body() dto: ConfirmMatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bankTransactions.confirmMatch(id, dto, user.sub);
  }

  // --- Incoming (spec sections 5-8) ---

  @Post(':id/suggest-incoming')
  @PermissionAction('manage')
  suggestIncoming(@Param('id') id: string) {
    return this.reconciliation.suggestIncoming(id);
  }

  @Post(':id/confirm-store-order-payment')
  @PermissionAction('manage')
  confirmStoreOrderPayment(
    @Param('id') id: string,
    @Body() dto: ConfirmStoreOrderPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reconciliation.confirmStoreOrderPayment(id, dto, user.sub);
  }

  @Post(':id/confirm-sales-invoice-receipt')
  @PermissionAction('manage')
  confirmSalesInvoiceReceipt(
    @Param('id') id: string,
    @Body() dto: ConfirmInvoiceAllocationDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.reconciliation.confirmSalesInvoiceReceipt(
      id,
      dto,
      user.sub,
      context,
    );
  }

  // --- Outgoing (spec sections 9-12) ---

  @Post(':id/classify-outgoing')
  @PermissionAction('manage')
  classifyOutgoing(@Param('id') id: string, @Body() dto: ClassifyOutgoingDto) {
    return this.reconciliation.classifyOutgoing(id, dto);
  }

  @Post(':id/suggest-outgoing')
  @PermissionAction('manage')
  suggestOutgoing(@Param('id') id: string) {
    return this.reconciliation.suggestOutgoing(id);
  }

  @Post(':id/confirm-purchase-invoice-payment')
  @PermissionAction('manage')
  confirmPurchaseInvoicePayment(
    @Param('id') id: string,
    @Body() dto: ConfirmInvoiceAllocationDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.reconciliation.confirmPurchaseInvoicePayment(
      id,
      dto,
      user.sub,
      context,
    );
  }

  @Post(':id/confirm-expense-voucher')
  @PermissionAction('manage')
  confirmExpenseVoucher(
    @Param('id') id: string,
    @Body() dto: ConfirmExpenseVoucherDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.reconciliation.confirmExpenseVoucher(
      id,
      dto,
      user.sub,
      context,
    );
  }

  // --- Bulk (spec section 17) ---

  @Post('bulk/confirm-expense-vouchers')
  @PermissionAction('manage')
  bulkConfirmExpenseVouchers(
    @Body() dto: BulkCashFlowIdsDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.reconciliation.bulkConfirmExpenseVouchers(
      dto.ids,
      user.sub,
      context,
    );
  }

  @Post('bulk/classify-outgoing')
  @PermissionAction('manage')
  bulkClassifyOutgoing(@Body() dto: BulkClassifyOutgoingDto) {
    const { ids, ...classify } = dto;
    return this.reconciliation.bulkClassifyOutgoing(ids, classify);
  }
}
