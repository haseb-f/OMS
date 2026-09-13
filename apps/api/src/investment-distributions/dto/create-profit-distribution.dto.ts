import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

/** Investor Engine Milestone 3, Phase 3/6 — must be tied to an APPROVED Profit Calculation; never distributes Estimated Profit. */
export class CreateProfitDistributionDto {
  @IsUUID()
  profitCalculationId!: string;

  @IsDateString()
  @IsOptional()
  periodStart?: string;

  @IsDateString()
  @IsOptional()
  periodEnd?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
