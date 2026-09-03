import { Module } from '@nestjs/common';
import { SalesTeamsController } from './sales-teams.controller';
import { SalesTeamsService } from './sales-teams.service';
import { DepartmentsModule } from '../departments/departments.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [DepartmentsModule, NumberingModule],
  controllers: [SalesTeamsController],
  providers: [SalesTeamsService],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
