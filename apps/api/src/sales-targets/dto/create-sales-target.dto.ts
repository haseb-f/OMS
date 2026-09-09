import { IsEnum, IsNumber, IsOptional, Matches, Min } from 'class-validator';
import { TargetMetric, TargetScopeType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Part Q — Monthly Sales Target, Employee or Team scoped. Exactly one of employeeProfileId/salesTeamId must match `scopeType` — enforced in the service. */
export class CreateSalesTargetDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period!: string;

  @IsEnum(TargetScopeType)
  scopeType!: TargetScopeType;

  @IsOptionalUuid()
  employeeProfileId?: string;

  @IsOptionalUuid()
  salesTeamId?: string;

  @IsEnum(TargetMetric)
  @IsOptional()
  metric?: TargetMetric;

  @IsNumber()
  @Min(0)
  targetAmount!: number;
}
