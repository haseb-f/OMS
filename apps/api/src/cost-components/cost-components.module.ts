import { Module } from '@nestjs/common';
import { CostComponentsController } from './cost-components.controller';
import { CostComponentsService } from './cost-components.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [CostComponentsController],
  providers: [CostComponentsService],
  exports: [CostComponentsService],
})
export class CostComponentsModule {}
