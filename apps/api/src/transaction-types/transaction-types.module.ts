import { Module } from '@nestjs/common';
import { TransactionTypesController } from './transaction-types.controller';
import { TransactionTypesService } from './transaction-types.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [TransactionTypesController],
  providers: [TransactionTypesService],
  exports: [TransactionTypesService],
})
export class TransactionTypesModule {}
