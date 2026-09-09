import { IsEnum, IsOptional, Matches } from 'class-validator';
import { KpiEvaluationStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class KpiEvaluationsQueryDto {
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
