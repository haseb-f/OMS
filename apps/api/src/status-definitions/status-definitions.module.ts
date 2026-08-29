import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { StatusDefinitionsService } from './status-definitions.service';
import { StatusDefinitionsController } from './status-definitions.controller';

@Module({
  imports: [MasterDataModule],
  controllers: [StatusDefinitionsController],
  providers: [StatusDefinitionsService],
  exports: [StatusDefinitionsService],
})
export class StatusDefinitionsModule {}
