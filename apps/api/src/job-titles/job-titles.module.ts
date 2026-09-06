import { Module } from '@nestjs/common';
import { JobTitlesController } from './job-titles.controller';
import { JobTitlesService } from './job-titles.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [JobTitlesController],
  providers: [JobTitlesService],
  exports: [JobTitlesService],
})
export class JobTitlesModule {}
