import { Module } from '@nestjs/common';
import { ReceivingAccountsController } from './receiving-accounts.controller';
import { ReceivingAccountsService } from './receiving-accounts.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [ReceivingAccountsController],
  providers: [ReceivingAccountsService],
})
export class ReceivingAccountsModule {}
