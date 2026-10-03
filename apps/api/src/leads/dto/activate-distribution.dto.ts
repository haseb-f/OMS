import { IsEnum } from 'class-validator';
import { LeadDistributionMode } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class ActivateDistributionDto {
  @IsEnum(LeadDistributionMode)
  mode!: LeadDistributionMode;

  @IsOptionalUuid()
  teamId?: string;

  @IsOptionalUuid()
  departmentId?: string;
}

/**
 * R6 — body of `activate-continuous` / `activate-24h` (optional). Omitted
 * scope fields keep the active policy's scope, so re-confirming never
 * silently widens a team-scoped policy to the whole company; `null` asks
 * for company-wide explicitly; a uuid scopes to that team / department.
 */
export class ActivateAutoDistributionDto {
  @IsOptionalUuid()
  teamId?: string | null;

  @IsOptionalUuid()
  departmentId?: string | null;
}
