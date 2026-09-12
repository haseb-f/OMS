import { IsEnum, IsOptional } from 'class-validator';
import { PayrollRunStatus } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds page/pageSize/sortBy/sortOrder — this list was previously unbounded (a plain `findMany` with no filters at all). */
export class PayrollRunsQueryDto extends MasterDataQueryDto {
  @IsEnum(PayrollRunStatus)
  @IsOptional()
  status?: PayrollRunStatus;
}
