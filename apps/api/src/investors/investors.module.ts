import { Module } from '@nestjs/common';
import { InvestorsController } from './investors.controller';
import { InvestorsService } from './investors.service';
import { PartnersModule } from '../partners/partners.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { InvestorTypesModule } from '../investor-types/investor-types.module';

@Module({
  imports: [PartnersModule, MasterDataModule, InvestorTypesModule],
  controllers: [InvestorsController],
  providers: [InvestorsService],
  exports: [InvestorsService],
})
export class InvestorsModule {}
