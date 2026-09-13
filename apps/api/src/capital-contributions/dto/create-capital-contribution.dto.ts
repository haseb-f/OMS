import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Investor Engine Milestone 1, Phase 12 — one traceable funding movement against a Subscription. */
export class CreateCapitalContributionDto {
  @IsUUID()
  subscriptionId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  contributionDate!: string;

  @IsOptionalUuid()
  paymentMethodId?: string;

  @IsOptionalUuid()
  financialAccountId?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
