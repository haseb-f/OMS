import { IsNumber, IsUUID, Min } from 'class-validator';

/** Investor Engine Milestone 1, Phase 9 — Investors subscribe to Opportunities, never directly to Products. */
export class CreateInvestorSubscriptionDto {
  @IsUUID()
  investorId!: string;

  @IsUUID()
  opportunityId!: string;

  @IsNumber()
  @Min(0.01)
  committedAmount!: number;
}
