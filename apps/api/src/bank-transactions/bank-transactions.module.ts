import { Module } from '@nestjs/common';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [BankTransactionsController],
  providers: [BankTransactionsService],
  exports: [BankTransactionsService],
})
export class BankTransactionsModule {}
