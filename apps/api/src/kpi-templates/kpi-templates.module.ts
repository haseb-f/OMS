import { Module } from '@nestjs/common';
import { KpiTemplatesController } from './kpi-templates.controller';
import { KpiTemplatesService } from './kpi-templates.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [KpiTemplatesController],
  providers: [KpiTemplatesService],
  exports: [KpiTemplatesService],
})
export class KpiTemplatesModule {}
