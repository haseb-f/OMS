import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CostAnalyticsScopeDto } from './cost-analytics-scope.dto';

export const PROFITABILITY_DIMENSIONS = [
  'PRODUCT',
  'ORDER',
  'CUSTOMER',
  'EMPLOYEE',
  'CHANNEL',
  'COUNTRY',
  'PERIOD',
] as const;
export type ProfitabilityDimension = (typeof PROFITABILITY_DIMENSIONS)[number];

export class ProfitabilityQueryDto extends CostAnalyticsScopeDto {
  @IsIn(PROFITABILITY_DIMENSIONS)
  dimension!: ProfitabilityDimension;

  /** Only used when `dimension` is `PERIOD`. */
  @IsIn(['day', 'week', 'month'])
  @IsOptional()
  periodGranularity?: 'day' | 'week' | 'month' = 'month';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number = 50;
}
