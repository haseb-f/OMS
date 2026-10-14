import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { FinancialTransactionType } from '@prisma/client';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { FinancialTransactionsService } from '../../financial-transactions.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('financial-transactions/payments/:transactionId/activities')
@UseGuards(JwtAuthGuard)
export class SupplierPaymentActivitiesController {
  constructor(private readonly transactions: FinancialTransactionsService) {}

  @Get()
  async findAll(@Param('transactionId') transactionId: string) {
    // R22 F7 — the route's own voucher type only (404 otherwise).
    await this.transactions.assertVoucherOfType(
      FinancialTransactionType.SUPPLIER_PAYMENT,
      transactionId,
    );
    return this.transactions.activityFor(transactionId);
  }
}
