import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

/** Part T/U — one achievement-% band. `percentage` for FLAT_PERCENTAGE/ACHIEVEMENT_TIER, `fixedAmount` for FIXED_BONUS — which field applies is determined by the parent Plan's ruleType. */
export class CommissionPlanTierInputDto {
  @IsNumber()
  @Min(0)
  minAchievementPercent!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxAchievementPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  percentage?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  fixedAmount?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
