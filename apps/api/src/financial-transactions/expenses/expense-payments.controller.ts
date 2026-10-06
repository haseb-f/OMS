import {
  BadRequestException,
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
import { CreateExpensePaymentDto } from './dto/create-expense-payment.dto';
import { UpdateExpensePaymentDto } from './dto/update-expense-payment.dto';
import { FindExpensePaymentsQueryDto } from './dto/find-expense-payments-query.dto';

const TYPE = FinancialTransactionType.EXPENSE_PAYMENT;
/** Open purchase invoices are supplier-payment data — reading them also needs the Supplier Payments view right. */
const SUPPLIER_PAYMENTS_VIEW = 'purchasing.payments.view';

/**
 * Expense vouchers — the Expenses screen (R13 owner decision 2; the legacy
 * postless `Expense` CRUD was consolidated into this). Reuses
 * `FinancialTransactionsService` unchanged in shape: Draft (no posting) →
 * Confirm & post (Posting Engine: Dr expense account / Cr paid-from
 * account, idempotent) → Cancel (reversal entry, locked periods refused).
 * Never a second voucher / posting engine.
 */
@Controller('financial-transactions/expense-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('expense-payments')
export class ExpensePaymentsController {
  constructor(
    private readonly transactions: FinancialTransactionsService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateExpensePaymentDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.create(TYPE, dto, user.sub, context);
  }

  /** "Confirm & post" on a new form — create + confirm + post atomically, idempotent by key. */
  @Post('confirmed')
  @PermissionAction('confirm')
  createConfirmed(
    @Body() dto: CreateExpensePaymentDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.createConfirmed(TYPE, dto, user.sub, context);
  }

  @Get()
  findAll(@Query() query: FindExpensePaymentsQueryDto) {
    return this.transactions.findAll(TYPE, query);
  }

  /** Per-currency totals of the same filtered list (reversed vouchers excluded). */
  @Get('totals')
  totals(@Query() query: FindExpensePaymentsQueryDto) {
    return this.transactions.totalsByCurrency(TYPE, query);
  }

  /**
   * Open (unpaid / partially paid) confirmed purchase invoices of the
   * chosen counterparty — so the user pays the invoice with a Supplier
   * Payment instead of expensing an invoiced cost a second time. Requires
   * `purchasing.payments.view` on top of the expense-voucher view right
   * (403 otherwise — the web then hides the "Pay invoice instead" panel).
   */
  @Get('open-invoices')
  async openInvoices(
    @CurrentUser() user: JwtPayload,
    @Query('partnerId', new ParseUUIDPipe({ optional: true }))
    partnerId?: string,
  ) {
    if (
      !(await this.permissions.hasPermission(user.sub, SUPPLIER_PAYMENTS_VIEW))
    ) {
      throw new ForbiddenException(
        `Missing permission "${SUPPLIER_PAYMENTS_VIEW}".`,
      );
    }
    if (!partnerId) {
      throw new BadRequestException('partnerId is required.');
    }
    return this.transactions.getOpenInvoices(
      FinancialTransactionType.SUPPLIER_PAYMENT,
      partnerId,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactions.findOne(TYPE, id);
  }

  @Get(':id/activities')
  async activities(@Param('id') id: string) {
    await this.transactions.findOne(TYPE, id);
    return this.transactions.activityFor(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateExpensePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.transactions.findOne(TYPE, id);
    return this.transactions.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    await this.transactions.findOne(TYPE, id);
    return this.transactions.remove(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  async confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.transactions.findOne(TYPE, id);
    return this.transactions.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.transactions.findOne(TYPE, id);
    return this.transactions.cancel(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  async archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.transactions.findOne(TYPE, id);
    return this.transactions.archive(id, user.sub);
  }
}
