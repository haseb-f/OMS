import { Module } from '@nestjs/common';
import { JobTitlesController } from './job-titles.controller';
import { JobTitlesService } from './job-titles.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PermissionAdministrationModule } from '../permissions/permission-administration.module';

@Module({
  imports: [MasterDataModule, NumberingModule, PermissionAdministrationModule],
  controllers: [JobTitlesController],
  providers: [JobTitlesService],
  exports: [JobTitlesService],
})
export class JobTitlesModule {}
