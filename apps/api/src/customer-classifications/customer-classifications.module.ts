import { Module } from '@nestjs/common';
import { CustomerClassificationsController } from './customer-classifications.controller';
import { CustomerClassificationsService } from './customer-classifications.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [CustomerClassificationsController],
  providers: [CustomerClassificationsService],
  exports: [CustomerClassificationsService],
})
export class CustomerClassificationsModule {}
