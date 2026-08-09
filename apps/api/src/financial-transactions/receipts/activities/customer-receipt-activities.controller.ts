import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { FinancialTransactionsService } from '../../financial-transactions.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('financial-transactions/receipts/:transactionId/activities')
@UseGuards(JwtAuthGuard)
export class CustomerReceiptActivitiesController {
  constructor(private readonly transactions: FinancialTransactionsService) {}

  @Get()
  findAll(@Param('transactionId') transactionId: string) {
    return this.transactions.activityFor(transactionId);
  }
}
