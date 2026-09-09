import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Part K — one item's raw evaluator input. Which field is read depends on
 * the item's itemTypeSnapshot (validated in the service, since the shape
 * is polymorphic per item type — a single flat DTO keeps the wizard-style
 * per-row scoring UI simple rather than four separate endpoints).
 */
export class ScoreKpiItemDto {
  /** YES_NO */
  @IsBoolean()
  @IsOptional()
  yesNo?: boolean;

  /** PERCENTAGE */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  percentage?: number;

  /** RATING_1_TO_5 */
  @IsIn([1, 2, 3, 4, 5])
  @IsOptional()
  rating?: number;

  /** DROPDOWN — must match one of the item's configured dropdownOptions labels */
  @IsString()
  @IsOptional()
  dropdownLabel?: string;

  /** Required when the resulting normalizedScore is below 50 (Part P). */
  @IsString()
  @IsOptional()
  comment?: string;
}
