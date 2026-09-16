import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AllocationDimension, CostAllocationMethod } from '@prisma/client';

/** M4 (Cost Module completion) — activates a previously schema-only `CostAllocationRule` (ADR-0014) for real Run execution. */
export class CreateCostAllocationRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(CostAllocationMethod)
  method!: CostAllocationMethod;

  @IsEnum(AllocationDimension)
  targetDimension!: AllocationDimension;

  @IsUUID()
  @IsOptional()
  costComponentId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
