import { Module } from '@nestjs/common';
import { InvestorTypesController } from './investor-types.controller';
import { InvestorTypesService } from './investor-types.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [InvestorTypesController],
  providers: [InvestorTypesService],
  exports: [InvestorTypesService],
})
export class InvestorTypesModule {}
