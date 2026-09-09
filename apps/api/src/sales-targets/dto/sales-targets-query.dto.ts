import { IsEnum, IsOptional, Matches } from 'class-validator';
import { TargetMetric, TargetScopeType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class SalesTargetsQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  @IsOptional()
  period?: string;

  @IsEnum(TargetScopeType)
  @IsOptional()
  scopeType?: TargetScopeType;

  @IsEnum(TargetMetric)
  @IsOptional()
  metric?: TargetMetric;

  @IsOptionalUuid()
  departmentId?: string;

  @IsOptionalUuid()
  salesTeamId?: string;
}
