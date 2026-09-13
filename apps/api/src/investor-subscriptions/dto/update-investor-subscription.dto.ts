import { IsNumber, Min } from 'class-validator';

/** Committed amount is the only field an Investor Subscription can edit directly — `fundedAmount`/`participationPercent`/`status` stay backend-derived (Phase 11/13/30). */
export class UpdateInvestorSubscriptionDto {
  @IsNumber()
  @Min(0.01)
  committedAmount!: number;
}
