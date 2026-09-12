import { IsEnum, IsOptional, Matches } from 'class-validator';
import { KpiEvaluationStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds page/pageSize/sortBy/sortOrder (the same contract every list endpoint uses) — this list was previously unbounded. */
export class KpiEvaluationsQueryDto extends MasterDataQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  @IsOptional()
  period?: string;

  @IsOptionalUuid()
  departmentId?: string;

  @IsOptionalUuid()
  salesTeamId?: string;

  @IsOptionalUuid()
  employeeProfileId?: string;

  @IsEnum(KpiEvaluationStatus)
  @IsOptional()
  status?: KpiEvaluationStatus;
}
