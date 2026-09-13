import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { OpportunityProductInputDto } from './opportunity-product-input.dto';

/** Investor Engine Milestone 1, Phase 5/24 — compact 2-3 section create flow. Target Capital is never accepted here — always server-computed from `products` (Phase 7). */
export class CreateInvestmentOpportunityDto {
  @IsString()
  nameAr!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  currencyId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsNumber()
  @Min(0.01)
  @Max(100)
  investorNetProfitSharePercent!: number;

  @ValidateNested({ each: true })
  @Type(() => OpportunityProductInputDto)
  @ArrayMinSize(1)
  products!: OpportunityProductInputDto[];
}
