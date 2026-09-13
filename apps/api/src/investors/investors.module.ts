import { Module } from '@nestjs/common';
import { InvestorsController } from './investors.controller';
import { InvestorsService } from './investors.service';
import { PartnersModule } from '../partners/partners.module';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [PartnersModule, MasterDataModule],
  controllers: [InvestorsController],
  providers: [InvestorsService],
  exports: [InvestorsService],
})
export class InvestorsModule {}
