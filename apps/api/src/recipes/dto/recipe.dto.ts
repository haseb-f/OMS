import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsDecimalString } from '../../common/decorators/decimal-string.decorator';

/** Column scales: quantities Decimal(18,6), costs Decimal(14,4). */
export const RECIPE_QUANTITY = {
  maxDecimals: 6,
  maxIntegerDigits: 12,
  positive: true,
} as const;
const RECIPE_COST = { maxDecimals: 4, maxIntegerDigits: 10 } as const;

export class RecipeLineDto {
  @IsUUID()
  componentProductId!: string;

  /** Quantity per recipe run, in `unitId`. */
  @IsDecimalString(RECIPE_QUANTITY)
  quantity!: string;

  @IsUUID()
  unitId!: string;
}

class RecipeBodyDto {
  /** Finished units one run yields (≥ 1 for ASSEMBLED, exactly 1 for KIT — checked at activation). */
  @IsOptional()
  @IsDecimalString(RECIPE_QUANTITY)
  outputQuantity?: string;

  @IsOptional()
  @IsDecimalString(RECIPE_COST)
  directCostEstimate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** `lines` replaces every line of the version. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  lines?: RecipeLineDto[];
}

export class CreateRecipeDto extends RecipeBodyDto {
  /** Start the new DRAFT from an existing version (omitted fields are copied from it). */
  @IsOptional()
  @IsUUID()
  copyFromRecipeId?: string;
}

export class UpdateRecipeDto extends RecipeBodyDto {}

export class RecipeCostEstimateQueryDto {
  /** Estimate a specific version (any status); default: the ACTIVE recipe. */
  @IsOptional()
  @IsUUID()
  recipeId?: string;
}

export class KitAvailabilityQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
