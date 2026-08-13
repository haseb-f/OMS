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
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import {
  CurrentCompanyContext,
  type CompanyContext,
} from '../../common/decorators/current-company-context.decorator';
import { FinancialTransactionsService } from '../financial-transactions.service';
import { CreateExpensePaymentDto } from './dto/create-expense-payment.dto';
import { UpdateExpensePaymentDto } from './dto/update-expense-payment.dto';
import { FindFinancialTransactionsQueryDto } from '../shared/find-financial-transactions-query.dto';

const TYPE = FinancialTransactionType.EXPENSE_PAYMENT;

/**
 * "Payment Voucher" for a Cash Flow outgoing transaction classified as an
 * Expense (spec section 11) — reuses `FinancialTransactionsService`
 * unchanged (same Draft -> Confirm -> Cancel workflow, same Posting Engine
 * call on Confirm) with a party-less DTO (`expenseAccountId` instead of
 * `supplierId`). Never a second voucher/posting engine.
 */
@Controller('financial-transactions/expense-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('expense-payments')
export class ExpensePaymentsController {
  constructor(private readonly transactions: FinancialTransactionsService) {}

  @Post()
  create(
    @Body() dto: CreateExpensePaymentDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.create(TYPE, dto, user.sub, context);
  }

  @Get()
  findAll(@Query() query: FindFinancialTransactionsQueryDto) {
    return this.transactions.findAll(TYPE, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactions.findOne(TYPE, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpensePaymentDto,
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
