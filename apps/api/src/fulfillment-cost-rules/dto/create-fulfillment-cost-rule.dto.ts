import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/** ADR-0018 (Order Economics M2.2) — V1 scope: one flat cost per fulfilled Order, no applicability dimensions yet. */
export class CreateFulfillmentCostRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsNumber()
  @Min(0)
  costAmount!: number;

  @IsUUID()
  currencyId!: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string;
}
