import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Investor Engine Milestone 3, Phase 8/9/42 — record payment; amount is validated server-side against outstanding, never trusted from a stale UI value. */
export class CreateDistributionPaymentDto {
  @IsUUID()
  investorDistributionId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  paymentDate!: string;

  @IsUUID()
  financialAccountId!: string;

  @IsOptionalUuid()
  paymentMethodId?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
