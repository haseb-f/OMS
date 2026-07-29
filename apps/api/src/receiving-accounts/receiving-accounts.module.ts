import { Module } from '@nestjs/common';
import { ReceivingAccountsController } from './receiving-accounts.controller';
import { ReceivingAccountsService } from './receiving-accounts.service';

@Module({
  controllers: [ReceivingAccountsController],
  providers: [ReceivingAccountsService],
})
export class ReceivingAccountsModule {}
