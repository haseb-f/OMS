import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * M3 (Cost Module completion) — the common order-side scope every Cost
 * Analytics endpoint accepts. All filters are optional; an unfiltered
 * request scopes to every non-deleted Store Order. `costCenterId` only
 * affects the Operating Expenses side (read from GL) — Store Orders carry
 * no Cost Center of their own (see `CostAnalyticsService`'s own comment).
 */
export class CostAnalyticsScopeDto {
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @IsOptionalUuid()
  partnerId?: string;

  @IsOptionalUuid()
  employeeId?: string;

  @IsString()
  @IsOptional()
  sourceChannel?: string;

  @IsOptionalUuid()
  countryId?: string;

  /** Scopes the Operating Expenses (GL) side only. */
  @IsOptionalUuid()
  costCenterId?: string;
}
