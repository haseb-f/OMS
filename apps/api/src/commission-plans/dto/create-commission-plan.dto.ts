import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CommissionBasis, CommissionRuleType } from '@prisma/client';
import { CommissionPlanTierInputDto } from './commission-plan-tier-input.dto';

/** Part T — a Commission Plan (FLAT_PERCENTAGE / ACHIEVEMENT_TIER / FIXED_BONUS) with its tiers. */
export class CreateCommissionPlanDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(CommissionBasis)
  @IsOptional()
  basis?: CommissionBasis;

  @IsEnum(CommissionRuleType)
  ruleType!: CommissionRuleType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommissionPlanTierInputDto)
  tiers!: CommissionPlanTierInputDto[];
}
